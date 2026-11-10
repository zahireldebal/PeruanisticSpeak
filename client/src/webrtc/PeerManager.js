/**
 * PeerManager: Coordinates multi-peer WebRTC connections (Mesh topology).
 * Implements standard Perfect Negotiation (RFC 8829) to support up to 10+ simultaneous
 * gamers with zero glare, instant screen stream recovery, and low latency.
 */
class PeerManager {
  constructor(signalingClient, audioManager, screenShareManager) {
    this.signaling = signalingClient;
    this.audio = audioManager;
    this.screen = screenShareManager;

    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.peerMeta = new Map(); // peerId -> { isPolite, makingOffer, ignoreOffer, iceQueue }
    this.remoteAudioElements = new Map(); // peerId -> HTMLAudioElement
    this.remoteScreenStreams = new Map(); // peerId -> MediaStream
    this.peerStates = new Map(); // peerId -> { username, avatar, isSharingScreen, isMuted, isDeafened, isSpeaking }
    this.screenViewers = new Map(); // viewerPeerId -> viewerUsername

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    this.listeners = new Map();
    this.setupListeners();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[PeerManager] Listener error on ${event}:`, err);
        }
      }
    }
  }

  setupListeners() {
    // Signaling room participants received
    this.signaling.on('room-users', (peers, roomId) => {
      console.log(`[PeerManager] Joined room "${roomId}" with ${peers.length} active peers.`);
      for (const peer of peers) {
        this.peerStates.set(peer.peerId, { ...peer });
        // Create connection for existing peer
        const pc = this.createPeerConnection(peer.peerId);

        // If the existing peer is sharing screen, request renegotiation so video track is offered
        if (peer.isSharingScreen) {
          this.signaling.sendRequestRenegotiate(peer.peerId);
        }
      }
      this.emit('peers-updated', Array.from(this.peerStates.values()));
    });

    // New participant joined the room
    this.signaling.on('user-joined', (message) => {
      console.log(`[PeerManager] Peer joined: ${message.username} (${message.peerId})`);
      this.peerStates.set(message.peerId, {
        peerId: message.peerId,
        username: message.username,
        avatar: message.avatar || null,
        isSharingScreen: false,
        isMuted: false,
        isDeafened: false,
        isSpeaking: false
      });
      this.createPeerConnection(message.peerId);
      this.emit('peers-updated', Array.from(this.peerStates.values()));
    });

    this.signaling.on('offer', async (senderPeerId, sdp) => {
      await this.handleOffer(senderPeerId, sdp);
    });

    this.signaling.on('answer', async (senderPeerId, sdp) => {
      await this.handleAnswer(senderPeerId, sdp);
    });

    this.signaling.on('ice-candidate', async (senderPeerId, candidate) => {
      await this.handleIceCandidate(senderPeerId, candidate);
    });

    // Remote peer requested screen renegotiation
    this.signaling.on('request-renegotiate', async (senderPeerId) => {
      console.log(`[PeerManager] Received renegotiation request from ${senderPeerId}`);
      const pc = this.peerConnections.get(senderPeerId);
      if (pc && this.screen.isSharing && this.screen.videoTrack) {
        try {
          const senders = pc.getSenders();
          const hasVideoSender = senders.some(s => s.track && s.track.kind === 'video');
          if (!hasVideoSender) {
            const sender = pc.addTrack(this.screen.videoTrack, this.screen.screenStream);
            this.optimizeVideoBitrate(sender);
            if (this.screen.audioTrack) {
              pc.addTrack(this.screen.audioTrack, this.screen.screenStream);
            }
          }
        } catch (err) {
          console.warn('[PeerManager] Failed to re-add screen tracks:', err);
        }
      }
    });

    // Viewer joined or left our screen transmission
    this.signaling.on('viewer-update', (viewerPeerId, viewerUsername, isWatching) => {
      if (isWatching) {
        const isNew = !this.screenViewers.has(viewerPeerId);
        this.screenViewers.set(viewerPeerId, viewerUsername);
        if (isNew) {
          this.emit('viewer-joined', viewerUsername);
        }
      } else {
        this.screenViewers.delete(viewerPeerId);
      }
      this.emit('viewers-changed', Array.from(this.screenViewers.values()));
    });

    this.signaling.on('user-left', (peerId) => {
      console.log(`[PeerManager] Peer left: ${peerId}`);
      this.closePeer(peerId);
      this.peerStates.delete(peerId);
      this.screenViewers.delete(peerId);
      this.emit('viewers-changed', Array.from(this.screenViewers.values()));
      this.emit('peers-updated', Array.from(this.peerStates.values()));
    });

    this.signaling.on('peer-screen-state', (peerId, isSharingScreen) => {
      const state = this.peerStates.get(peerId);
      if (state) {
        state.isSharingScreen = isSharingScreen;
        this.emit('peers-updated', Array.from(this.peerStates.values()));
      }
      if (!isSharingScreen) {
        this.remoteScreenStreams.delete(peerId);
        this.emit('remote-screen-removed', peerId);
      }
    });

    this.signaling.on('peer-state', (stateMsg) => {
      const state = this.peerStates.get(stateMsg.peerId);
      if (state) {
        if (typeof stateMsg.isMuted === 'boolean') state.isMuted = stateMsg.isMuted;
        if (typeof stateMsg.isDeafened === 'boolean') state.isDeafened = stateMsg.isDeafened;
        if (typeof stateMsg.isSpeaking === 'boolean') state.isSpeaking = stateMsg.isSpeaking;
        if (stateMsg.avatar) state.avatar = stateMsg.avatar;
        this.emit('peers-updated', Array.from(this.peerStates.values()));
      }
    });

    // Audio events
    this.audio.on('speaking-change', (isSpeaking) => {
      this.signaling.sendUserState({ isSpeaking });
      this.emit('local-state-change', { isSpeaking });
    });

    this.audio.on('mute-change', (isMuted) => {
      this.signaling.sendUserState({ isMuted });
      this.emit('local-state-change', { isMuted });
    });

    this.audio.on('deafen-change', (isDeafened) => {
      this.signaling.sendUserState({ isDeafened });
      for (const audioEl of this.remoteAudioElements.values()) {
        audioEl.muted = isDeafened;
      }
      this.emit('local-state-change', { isDeafened });
    });

    // Screen share events
    this.screen.on('started', (stream, videoTrack, audioTrack) => {
      this.signaling.sendScreenState(true);
      this.addScreenTrackToAllPeers(videoTrack, audioTrack, stream);
      this.emit('local-screen-started', stream);
    });

    this.screen.on('stopped', () => {
      this.signaling.sendScreenState(false);
      this.removeScreenTrackFromAllPeers();
      this.screenViewers.clear();
      this.emit('viewers-changed', []);
      this.emit('local-screen-stopped');
    });
  }

  createPeerConnection(peerId) {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId);
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, pc);

    // Perfect Negotiation metadata: deterministic role based on peerId comparison
    const isPolite = (this.signaling.peerId || '') < peerId;
    const meta = {
      isPolite,
      makingOffer: false,
      ignoreOffer: false,
      iceQueue: []
    };
    this.peerMeta.set(peerId, meta);

    // Pre-add a video transceiver as 'recvonly' so initial SDP always carries an m=video line.
    // This allows incoming video to be received even if the remote peer starts sharing later!
    try {
      pc.addTransceiver('video', { direction: 'recvonly' });
    } catch (_) {}

    // Add local mic audio track
    if (this.audio.localStream) {
      for (const track of this.audio.localStream.getAudioTracks()) {
        pc.addTrack(track, this.audio.localStream);
      }
    }

    // Add screen track if currently sharing
    if (this.screen.isSharing && this.screen.videoTrack) {
      const sender = pc.addTrack(this.screen.videoTrack, this.screen.screenStream);
      this.optimizeVideoBitrate(sender);
      if (this.screen.audioTrack) {
        pc.addTrack(this.screen.audioTrack, this.screen.screenStream);
      }
    }

    // Send local ICE candidates to peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(peerId, event.candidate);
      }
    };

    // Receive remote tracks (audio and screen video)
    pc.ontrack = (event) => {
      const track = event.track;
      const stream = event.streams[0] || new MediaStream([track]);

      if (track.kind === 'audio') {
        this.handleRemoteAudioTrack(peerId, stream);
      } else if (track.kind === 'video') {
        this.handleRemoteVideoTrack(peerId, stream);
        this.signaling.sendWatchingScreen(peerId, true);
      }
    };

    // Connection state monitor for zombie connection cleanup
    pc.onconnectionstatechange = () => {
      console.log(`[PeerManager] Peer ${peerId} connection state: ${pc.connectionState}`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(peerId);
        this.emit('peers-updated', Array.from(this.peerStates.values()));
      }
    };

    // Perfect Negotiation onnegotiationneeded
    pc.onnegotiationneeded = async () => {
      try {
        meta.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        this.signaling.sendOffer(peerId, pc.localDescription);
      } catch (err) {
        console.error(`[PeerManager] Negotiation error with ${peerId}:`, err);
      } finally {
        meta.makingOffer = false;
      }
    };

    return pc;
  }

  async handleOffer(senderPeerId, sdp) {
    let pc = this.peerConnections.get(senderPeerId);
    if (!pc) {
      pc = this.createPeerConnection(senderPeerId);
    }
    const meta = this.peerMeta.get(senderPeerId);

    try {
      const offerCollision = (meta.makingOffer || pc.signalingState !== 'stable');
      meta.ignoreOffer = !meta.isPolite && offerCollision;

      if (meta.ignoreOffer) {
        console.log(`[PeerManager] Offer collision with polite rule: impolite peer ${this.signaling.peerId} ignoring offer from ${senderPeerId}`);
        return;
      }

      if (offerCollision && meta.isPolite) {
        await Promise.all([
          pc.setLocalDescription({ type: 'rollback' }),
          pc.setRemoteDescription(new RTCSessionDescription(sdp))
        ]);
      } else {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }

      // Flush queued candidates
      while (meta.iceQueue.length > 0) {
        const cand = meta.iceQueue.shift();
        try {
          await pc.addIceCandidate(cand);
        } catch (_) {}
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling.sendAnswer(senderPeerId, pc.localDescription);
    } catch (err) {
      console.error(`[PeerManager] Error handling offer from ${senderPeerId}:`, err);
    }
  }

  async handleAnswer(senderPeerId, sdp) {
    const pc = this.peerConnections.get(senderPeerId);
    const meta = this.peerMeta.get(senderPeerId);
    if (pc && meta) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        while (meta.iceQueue.length > 0) {
          const cand = meta.iceQueue.shift();
          try {
            await pc.addIceCandidate(cand);
          } catch (_) {}
        }
      } catch (err) {
        console.error(`[PeerManager] Error setting remote description from answer:`, err);
      }
    }
  }

  async handleIceCandidate(senderPeerId, candidate) {
    const pc = this.peerConnections.get(senderPeerId);
    const meta = this.peerMeta.get(senderPeerId);
    if (pc && meta) {
      const rtcCandidate = new RTCIceCandidate(candidate);
      if (pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(rtcCandidate);
        } catch (err) {
          console.error(`[PeerManager] Failed to add ICE candidate:`, err);
        }
      } else {
        meta.iceQueue.push(rtcCandidate);
      }
    }
  }

  handleRemoteAudioTrack(peerId, stream) {
    let audioEl = this.remoteAudioElements.get(peerId);
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.autoplay = true;
      audioEl.muted = this.audio.isDeafened;
      this.remoteAudioElements.set(peerId, audioEl);
    }
    audioEl.srcObject = stream;
    audioEl.play().catch(e => console.warn('[PeerManager] Audio play note:', e));
    console.log(`[PeerManager] Attached remote audio for peer ${peerId}`);
  }

  handleRemoteVideoTrack(peerId, stream) {
    this.remoteScreenStreams.set(peerId, stream);
    console.log(`[PeerManager] Received remote screen stream from peer ${peerId}`);
    this.emit('remote-screen-added', peerId, stream);

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        this.remoteScreenStreams.delete(peerId);
        this.signaling.sendWatchingScreen(peerId, false);
        this.emit('remote-screen-removed', peerId);
      };
    }
  }

  optimizeVideoBitrate(sender) {
    if (!sender || !sender.setParameters) return;
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }
      // 3.5 Mbps for smooth 30fps screen share without game lag
      parameters.encodings[0].maxBitrate = 3500000;
      parameters.encodings[0].maxFramerate = 30;
      sender.setParameters(parameters);
    } catch (err) {
      console.warn('[PeerManager] Bitrate optimization note:', err.message);
    }
  }

  addScreenTrackToAllPeers(videoTrack, audioTrack, stream) {
    for (const [peerId, pc] of this.peerConnections.entries()) {
      try {
        const sender = pc.addTrack(videoTrack, stream);
        this.optimizeVideoBitrate(sender);
        if (audioTrack) {
          pc.addTrack(audioTrack, stream);
        }
      } catch (err) {
        console.error(`[PeerManager] Failed to add screen track to peer ${peerId}:`, err);
      }
    }
  }

  removeScreenTrackFromAllPeers() {
    for (const [peerId, pc] of this.peerConnections.entries()) {
      try {
        const senders = pc.getSenders();
        for (const sender of senders) {
          if (sender.track && (sender.track.kind === 'video' || sender.track.label.includes('desktop'))) {
            pc.removeTrack(sender);
          }
        }
      } catch (err) {
        console.error(`[PeerManager] Error removing screen track from ${peerId}:`, err);
      }
    }
  }

  closePeer(peerId) {
    if (this.peerConnections.has(peerId)) {
      const pc = this.peerConnections.get(peerId);
      try { pc.close(); } catch (_) {}
      this.peerConnections.delete(peerId);
    }

    this.peerMeta.delete(peerId);

    if (this.remoteAudioElements.has(peerId)) {
      const audioEl = this.remoteAudioElements.get(peerId);
      audioEl.srcObject = null;
      this.remoteAudioElements.delete(peerId);
    }

    if (this.remoteScreenStreams.has(peerId)) {
      this.remoteScreenStreams.delete(peerId);
      this.emit('remote-screen-removed', peerId);
    }
  }

  destroy() {
    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeer(peerId);
    }
    this.peerStates.clear();
    this.screenViewers.clear();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PeerManager;
}
