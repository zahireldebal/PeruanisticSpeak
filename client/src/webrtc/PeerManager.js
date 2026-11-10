/**
 * PeerManager: Coordinates multi-peer WebRTC connections (Mesh topology).
 * Direct voice and screen transmission between gamers without intermediary SFU costs.
 */
class PeerManager {
  constructor(signalingClient, audioManager, screenShareManager) {
    this.signaling = signalingClient;
    this.audio = audioManager;
    this.screen = screenShareManager;

    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.remoteAudioElements = new Map(); // peerId -> HTMLAudioElement
    this.remoteScreenStreams = new Map(); // peerId -> MediaStream
    this.peerStates = new Map(); // peerId -> { username, isSharingScreen, isMuted, isDeafened, isSpeaking }

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
    // Signaling events
    this.signaling.on('room-users', (peers, roomId) => {
      console.log(`[PeerManager] Joined room "${roomId}" with ${peers.length} active peers.`);
      for (const peer of peers) {
        this.peerStates.set(peer.peerId, { ...peer });
        // Initiate offer to existing peers (we are the joiner)
        this.createPeerConnection(peer.peerId, true);
      }
      this.emit('peers-updated', Array.from(this.peerStates.values()));
    });

    this.signaling.on('user-joined', (message) => {
      console.log(`[PeerManager] Peer joined: ${message.username} (${message.peerId})`);
      this.peerStates.set(message.peerId, {
        peerId: message.peerId,
        username: message.username,
        isSharingScreen: false,
        isMuted: false,
        isDeafened: false,
        isSpeaking: false
      });
      // We wait for the joiner to send us an offer
      this.createPeerConnection(message.peerId, false);
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

    this.signaling.on('user-left', (peerId) => {
      console.log(`[PeerManager] Peer left: ${peerId}`);
      this.closePeer(peerId);
      this.peerStates.delete(peerId);
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
      // Mute all remote audio elements if local user is deafened
      for (const audioEl of this.remoteAudioElements.values()) {
        audioEl.muted = isDeafened;
      }
      this.emit('local-state-change', { isDeafened });
    });

    // Screen share events
    this.screen.on('started', (stream, videoTrack) => {
      this.signaling.sendScreenState(true);
      this.addScreenTrackToAllPeers(videoTrack, stream);
      this.emit('local-screen-started', stream);
    });

    this.screen.on('stopped', () => {
      this.signaling.sendScreenState(false);
      this.removeScreenTrackFromAllPeers();
      this.emit('local-screen-stopped');
    });
  }

  createPeerConnection(peerId, isInitiator) {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId);
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, pc);

    // Add local audio track if available
    if (this.audio.localStream) {
      for (const track of this.audio.localStream.getTracks()) {
        pc.addTrack(track, this.audio.localStream);
      }
    }

    // Add screen track if currently sharing
    if (this.screen.isSharing && this.screen.videoTrack) {
      const sender = pc.addTrack(this.screen.videoTrack, this.screen.screenStream);
      this.optimizeVideoBitrate(sender);
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
      const stream = event.streams[0];

      if (track.kind === 'audio') {
        this.handleRemoteAudioTrack(peerId, stream);
      } else if (track.kind === 'video') {
        this.handleRemoteVideoTrack(peerId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[PeerManager] Peer ${peerId} connection state: ${pc.connectionState}`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closePeer(peerId);
      }
    };

    // If initiator, create and send SDP offer
    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.signaling.sendOffer(peerId, pc.localDescription);
        } catch (err) {
          console.error(`[PeerManager] Failed to create offer for ${peerId}:`, err);
        }
      };
    }

    return pc;
  }

  async handleOffer(senderPeerId, sdp) {
    let pc = this.peerConnections.get(senderPeerId);
    if (!pc) {
      pc = this.createPeerConnection(senderPeerId, false);
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling.sendAnswer(senderPeerId, pc.localDescription);
    } catch (err) {
      console.error(`[PeerManager] Error handling offer from ${senderPeerId}:`, err);
    }
  }

  async handleAnswer(senderPeerId, sdp) {
    const pc = this.peerConnections.get(senderPeerId);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (err) {
        console.error(`[PeerManager] Error setting remote description from answer:`, err);
      }
    }
  }

  async handleIceCandidate(senderPeerId, candidate) {
    const pc = this.peerConnections.get(senderPeerId);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error(`[PeerManager] Failed to add ICE candidate:`, err);
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
    console.log(`[PeerManager] Attached remote audio for peer ${peerId}`);
  }

  handleRemoteVideoTrack(peerId, stream) {
    this.remoteScreenStreams.set(peerId, stream);
    console.log(`[PeerManager] Received remote screen stream from peer ${peerId}`);
    this.emit('remote-screen-added', peerId, stream);

    stream.getVideoTracks()[0].onended = () => {
      this.remoteScreenStreams.delete(peerId);
      this.emit('remote-screen-removed', peerId);
    };
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

  addScreenTrackToAllPeers(videoTrack, stream) {
    for (const [peerId, pc] of this.peerConnections.entries()) {
      try {
        const sender = pc.addTrack(videoTrack, stream);
        this.optimizeVideoBitrate(sender);
        // Renegotiate
        pc.createOffer().then((offer) => {
          pc.setLocalDescription(offer);
          this.signaling.sendOffer(peerId, offer);
        });
      } catch (err) {
        console.error(`[PeerManager] Failed to add screen track to peer ${peerId}:`, err);
      }
    }
  }

  removeScreenTrackFromAllPeers() {
    for (const [peerId, pc] of this.peerConnections.entries()) {
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'video') {
          pc.removeTrack(sender);
        }
      }
      // Renegotiate
      pc.createOffer().then((offer) => {
        pc.setLocalDescription(offer);
        this.signaling.sendOffer(peerId, offer);
      });
    }
  }

  closePeer(peerId) {
    if (this.peerConnections.has(peerId)) {
      const pc = this.peerConnections.get(peerId);
      pc.close();
      this.peerConnections.delete(peerId);
    }

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
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PeerManager;
}

