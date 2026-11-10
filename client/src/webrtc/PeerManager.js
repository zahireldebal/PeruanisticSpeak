/**
 * PeerManager: Coordinates multi-peer WebRTC connections (Mesh topology).
 * Implements W3C Perfect Negotiation with per-peer serialized signaling, fixed
 * transceivers (mic / screen video / screen audio) reused via replaceTrack, and
 * automatic connection recovery (ICE restart, then full rebuild).
 */
class PeerManager {
  constructor(signalingClient, audioManager, screenShareManager) {
    this.signaling = signalingClient;
    this.audio = audioManager;
    this.screen = screenShareManager;

    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.peerMeta = new Map(); // peerId -> negotiation + transceiver metadata
    this.remoteAudioElements = new Map(); // peerId -> HTMLAudioElement (voice only)
    this.remoteScreenStreams = new Map(); // peerId -> MediaStream
    this.peerStates = new Map(); // peerId -> { username, avatar, isSharingScreen, isMuted, isDeafened, isSpeaking }
    this.screenViewers = new Map(); // viewerPeerId -> viewerUsername
    this.signalQueues = new Map(); // peerId -> Promise (serialized signaling work)
    this.peerVolumes = PeerManager.loadVolumes(); // peerId -> 0..100 (persisted per device)

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
    // Signaling room participants received (we just joined / re-joined)
    this.signaling.on('room-users', (peers, roomId) => {
      console.log(`[PeerManager] Joined room "${roomId}" with ${peers.length} active peers.`);
      for (const peer of peers) {
        this.peerStates.set(peer.peerId, { ...peer });
        // The server just told every other member that we (re)joined, so they are building a
        // fresh connection to us. Drop any stale one we still hold so both sides start clean.
        this.resetPeer(peer.peerId, { initiator: true });

        // If the existing peer is sharing screen, ask them to (re)attach the video track
        if (peer.isSharingScreen) {
          this.signaling.sendRequestRenegotiate(peer.peerId);
        }
      }
      this.emit('peers-updated', Array.from(this.peerStates.values()));
    });

    // New participant joined the room (or re-joined after a signaling reconnect)
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
      this.resetPeer(message.peerId, { initiator: false });
      this.emit('peers-updated', Array.from(this.peerStates.values()));
    });

    // All signaling for a given peer is processed strictly in order (offer -> ICE -> answer...)
    this.signaling.on('offer', (senderPeerId, sdp) => {
      return this.enqueue(senderPeerId, () => this.handleOffer(senderPeerId, sdp));
    });

    this.signaling.on('answer', (senderPeerId, sdp) => {
      return this.enqueue(senderPeerId, () => this.handleAnswer(senderPeerId, sdp));
    });

    this.signaling.on('ice-candidate', (senderPeerId, candidate) => {
      return this.enqueue(senderPeerId, () => this.handleIceCandidate(senderPeerId, candidate));
    });

    // Remote peer asked us to (re)attach our screen tracks
    this.signaling.on('request-renegotiate', (senderPeerId) => {
      console.log(`[PeerManager] Received renegotiation request from ${senderPeerId}`);
      if (this.peerConnections.has(senderPeerId) && this.screen.isSharing && this.screen.videoTrack) {
        this.attachScreenToPeer(senderPeerId);
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

    // Microphone (re)initialized: new device picked, or the first init finished after peers
    // were already connected. Swap the new track into every connection (no renegotiation).
    this.audio.on('ready', () => {
      for (const peerId of this.peerConnections.keys()) {
        this.attachMicToPeer(peerId);
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
    this.screen.on('started', (stream) => {
      this.signaling.sendScreenState(true);
      this.addScreenTrackToAllPeers();
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

  /**
   * Serialize async signaling work per peer so an offer, its ICE candidates and later
   * renegotiations never interleave (a major source of broken audio with 3+ users).
   */
  enqueue(peerId, task) {
    const prev = this.signalQueues.get(peerId) || Promise.resolve();
    const next = prev.then(task).catch((err) => {
      console.error(`[PeerManager] Signaling task error for ${peerId}:`, err);
    });
    this.signalQueues.set(peerId, next);
    next.then(() => {
      if (this.signalQueues.get(peerId) === next) this.signalQueues.delete(peerId);
    });
    return next;
  }

  /** Close any existing connection to peerId and build a fresh one. */
  resetPeer(peerId, options = {}) {
    if (this.peerConnections.has(peerId)) {
      console.log(`[PeerManager] Resetting stale connection to ${peerId}`);
      this.closePeer(peerId);
    }
    return this.createPeerConnection(peerId, options);
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.initiator=true] false = wait for the remote's first offer before
   *   sending ours. Only one side opening a fresh connection avoids the initial offer glare,
   *   whose rollback can leave Chromium's ICE gathering stalled (no candidates, never connects).
   */
  createPeerConnection(peerId, options = {}) {
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
      isSettingRemoteAnswerPending: false,
      iceQueue: [],
      micTransceiver: null,
      videoTransceiver: null,
      screenAudioTransceiver: null,
      recoveryTimer: null,
      connectTimer: null,
      holdTimer: null,
      holdOffers: options.initiator === false,
      pendingNegotiation: false,
      negotiate: null,
      iceRestarts: 0
    };
    this.peerMeta.set(peerId, meta);

    // Our microphone always travels on one dedicated transceiver. It exists even before the
    // mic is ready, so the track can be swapped in later with replaceTrack().
    meta.micTransceiver = pc.addTransceiver(this.audio.audioTrack || 'audio', {
      direction: 'sendrecv',
      streams: this.audio.localStream ? [this.audio.localStream] : []
    });

    // Screen video travels on one reusable transceiver (inactive until we share). Reusing it
    // avoids piling up a new m-line every time a stream starts/stops.
    meta.videoTransceiver = pc.addTransceiver('video', { direction: 'inactive' });

    // Attach screen if currently sharing
    if (this.screen.isSharing && this.screen.videoTrack) {
      this.attachScreenToPeer(peerId);
    }

    // Send local ICE candidates to peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(peerId, event.candidate);
      }
    };

    // Receive remote tracks (mic audio, screen video, screen audio)
    pc.ontrack = (event) => {
      if (this.peerConnections.get(peerId) !== pc) return;
      const track = event.track;
      const stream = event.streams[0] || null;

      if (track.kind === 'audio') {
        // Screen audio shares its MediaStream with the screen video track and is played by the
        // screen <video> element. Only the mic goes to the per-peer voice <audio> element;
        // otherwise screen audio would replace the streamer's voice.
        if (stream && stream.getVideoTracks().length > 0) {
          console.log(`[PeerManager] Received screen audio from peer ${peerId}`);
          return;
        }
        this.handleRemoteAudioTrack(peerId, track);
      } else if (track.kind === 'video') {
        this.handleRemoteVideoTrack(peerId, stream || new MediaStream([track]));
        this.signaling.sendWatchingScreen(peerId, true);
      }
    };

    // Connection health: recover instead of dropping the peer forever
    pc.onconnectionstatechange = () => {
      if (this.peerConnections.get(peerId) !== pc) return;
      console.log(`[PeerManager] Peer ${peerId} connection state: ${pc.connectionState}`);
      this.handleConnectionState(peerId, pc, meta);
    };

    // Perfect Negotiation (W3C): parameterless setLocalDescription() builds the right
    // description for the current signaling state.
    meta.negotiate = async () => {
      if (this.peerConnections.get(peerId) !== pc) return;
      if (meta.holdOffers) {
        // Waiting for the newcomer's first offer; we will offer right after answering it
        meta.pendingNegotiation = true;
        return;
      }
      try {
        meta.makingOffer = true;
        await pc.setLocalDescription();
        this.signaling.sendOffer(peerId, pc.localDescription);
      } catch (err) {
        console.error(`[PeerManager] Negotiation error with ${peerId}:`, err);
      } finally {
        meta.makingOffer = false;
      }
    };
    pc.onnegotiationneeded = () => meta.negotiate();

    if (meta.holdOffers) {
      // Safety net: if the newcomer's offer never arrives, negotiate ourselves
      meta.holdTimer = setTimeout(() => this.releaseOfferHold(peerId, meta), PeerManager.OFFER_HOLD_MS);
    }

    // Re-apply bitrate / fps limits once each negotiation settles
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable' && meta.videoTransceiver && meta.videoTransceiver.sender.track) {
        this.optimizeVideoBitrate(meta.videoTransceiver.sender);
      }
    };

    // Watchdog: a connection that never reaches "connected" gets an ICE restart, then a rebuild
    this.armConnectWatchdog(peerId, pc, meta);

    return pc;
  }

  releaseOfferHold(peerId, meta) {
    clearTimeout(meta.holdTimer);
    meta.holdTimer = null;
    if (!meta.holdOffers) return;
    meta.holdOffers = false;
    if (meta.pendingNegotiation) {
      meta.pendingNegotiation = false;
      meta.negotiate();
    }
  }

  armConnectWatchdog(peerId, pc, meta) {
    clearTimeout(meta.connectTimer);
    meta.connectTimer = setTimeout(() => {
      if (this.peerConnections.get(peerId) !== pc || pc.connectionState === 'connected') return;
      if (meta.iceRestarts < PeerManager.MAX_ICE_RESTARTS) {
        console.warn(`[PeerManager] ${peerId} still "${pc.connectionState}" after ${PeerManager.CONNECT_TIMEOUT_MS} ms, restarting ICE`);
        this.restartIce(peerId, pc, meta);
        this.armConnectWatchdog(peerId, pc, meta);
      } else {
        this.hardReset(peerId);
      }
    }, PeerManager.CONNECT_TIMEOUT_MS);
  }

  handleConnectionState(peerId, pc, meta) {
    const state = pc.connectionState;
    if (state === 'connected') {
      clearTimeout(meta.recoveryTimer);
      clearTimeout(meta.connectTimer);
      meta.recoveryTimer = null;
      meta.connectTimer = null;
      meta.iceRestarts = 0;
      return;
    }

    if (state === 'disconnected') {
      // Usually transient (Wi-Fi blip, CPU spike). Give it a moment, then restart ICE.
      clearTimeout(meta.recoveryTimer);
      meta.recoveryTimer = setTimeout(() => {
        if (this.peerConnections.get(peerId) === pc && pc.connectionState === 'disconnected') {
          this.restartIce(peerId, pc, meta);
        }
      }, PeerManager.DISCONNECT_GRACE_MS);
      return;
    }

    if (state === 'failed') {
      clearTimeout(meta.recoveryTimer);
      if (meta.iceRestarts < PeerManager.MAX_ICE_RESTARTS) {
        this.restartIce(peerId, pc, meta);
        // If the ICE restart does not bring it back, rebuild the connection from scratch.
        meta.recoveryTimer = setTimeout(() => {
          if (this.peerConnections.get(peerId) === pc && pc.connectionState !== 'connected') {
            this.hardReset(peerId);
          }
        }, PeerManager.FAILED_RESET_MS);
      } else {
        this.hardReset(peerId);
      }
    }
  }

  restartIce(peerId, pc, meta) {
    meta.iceRestarts++;
    console.log(`[PeerManager] Restarting ICE with ${peerId} (attempt ${meta.iceRestarts})`);
    try {
      pc.restartIce();
    } catch (err) {
      console.warn('[PeerManager] restartIce failed:', err);
    }
  }

  hardReset(peerId) {
    if (!this.peerStates.has(peerId)) {
      this.closePeer(peerId);
      this.emit('peers-updated', Array.from(this.peerStates.values()));
      return;
    }
    const meta = this.peerMeta.get(peerId);
    // Only the impolite side rebuilds; the polite side rebuilds when it receives the new
    // (incompatible) offer. Avoids both sides tearing down each other's fresh connection.
    if (meta && meta.isPolite) return;
    console.warn(`[PeerManager] Rebuilding connection to ${peerId}`);
    this.resetPeer(peerId, { initiator: true });
  }

  async handleOffer(senderPeerId, sdp, isRetry = false) {
    let pc = this.peerConnections.get(senderPeerId);
    if (!pc) {
      pc = this.createPeerConnection(senderPeerId, { initiator: false });
    }
    const meta = this.peerMeta.get(senderPeerId);

    const readyForOffer = !meta.makingOffer &&
      (pc.signalingState === 'stable' || meta.isSettingRemoteAnswerPending);
    const offerCollision = !readyForOffer;
    meta.ignoreOffer = !meta.isPolite && offerCollision;

    if (meta.ignoreOffer) {
      console.log(`[PeerManager] Offer collision: impolite peer ignoring offer from ${senderPeerId}`);
      return;
    }

    try {
      // Polite peer: setRemoteDescription performs the implicit rollback on collision
      await pc.setRemoteDescription(sdp);
    } catch (err) {
      // An offer we cannot apply means the remote rebuilt its connection (reload, hard reset).
      // Rebuild ours once and apply the offer on a fresh connection.
      if (!isRetry && this.peerStates.has(senderPeerId)) {
        console.warn(`[PeerManager] Incompatible offer from ${senderPeerId}, rebuilding connection:`, err.message);
        this.closePeer(senderPeerId);
        this.createPeerConnection(senderPeerId, { initiator: false });
        return this.handleOffer(senderPeerId, sdp, true);
      }
      console.error(`[PeerManager] Error handling offer from ${senderPeerId}:`, err);
      return;
    }

    await this.flushIceQueue(pc, meta);

    try {
      await pc.setLocalDescription();
      this.signaling.sendAnswer(senderPeerId, pc.localDescription);
    } catch (err) {
      console.error(`[PeerManager] Error answering offer from ${senderPeerId}:`, err);
    }

    // First offer from the newcomer answered: now we may send our own (mic, screen...)
    if (meta.holdOffers) this.releaseOfferHold(senderPeerId, meta);
  }

  async handleAnswer(senderPeerId, sdp) {
    const pc = this.peerConnections.get(senderPeerId);
    const meta = this.peerMeta.get(senderPeerId);
    if (!pc || !meta) return;

    // A late answer to an offer we already rolled back (glare) must be dropped
    if (pc.signalingState !== 'have-local-offer') {
      console.log(`[PeerManager] Ignoring answer from ${senderPeerId} in state ${pc.signalingState}`);
      return;
    }

    try {
      meta.isSettingRemoteAnswerPending = true;
      await pc.setRemoteDescription(sdp);
    } catch (err) {
      console.error(`[PeerManager] Error setting remote description from answer:`, err);
    } finally {
      meta.isSettingRemoteAnswerPending = false;
    }
    await this.flushIceQueue(pc, meta);
  }

  async flushIceQueue(pc, meta) {
    while (meta.iceQueue.length > 0) {
      const cand = meta.iceQueue.shift();
      try {
        await pc.addIceCandidate(cand);
      } catch (_) {}
    }
  }

  async handleIceCandidate(senderPeerId, candidate) {
    const pc = this.peerConnections.get(senderPeerId);
    const meta = this.peerMeta.get(senderPeerId);
    if (!pc || !meta) return;

    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      meta.iceQueue.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      // Candidates belonging to an offer we deliberately ignored are expected to fail
      if (!meta.ignoreOffer) {
        console.warn(`[PeerManager] Failed to add ICE candidate from ${senderPeerId}:`, err.message);
      }
    }
  }

  handleRemoteAudioTrack(peerId, track) {
    let audioEl = this.remoteAudioElements.get(peerId);
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.autoplay = true;
      this.remoteAudioElements.set(peerId, audioEl);
    }
    audioEl.muted = this.audio.isDeafened;
    audioEl.volume = this.getPeerVolume(peerId) / 100;
    audioEl.srcObject = new MediaStream([track]);
    audioEl.play().catch(e => console.warn('[PeerManager] Audio play note:', e));
    console.log(`[PeerManager] Attached remote voice for peer ${peerId}`);
  }

  handleRemoteVideoTrack(peerId, stream) {
    this.remoteScreenStreams.set(peerId, stream);
    console.log(`[PeerManager] Received remote screen stream from peer ${peerId}`);
    this.emit('remote-screen-added', peerId, stream);

    const onGone = () => {
      if (this.remoteScreenStreams.get(peerId) !== stream) return;
      this.remoteScreenStreams.delete(peerId);
      this.signaling.sendWatchingScreen(peerId, false);
      this.emit('remote-screen-removed', peerId);
    };
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = onGone;
    }
    // Remote stopped sending (transceiver went inactive): the track leaves the stream
    stream.onremovetrack = (ev) => {
      if (ev.track && ev.track.kind === 'video') onGone();
    };
  }

  /** Per-user voice volume, 0-100 (default 100). Persisted in localStorage by peerId. */
  getPeerVolume(peerId) {
    const v = this.peerVolumes.get(peerId);
    return typeof v === 'number' ? v : 100;
  }

  setPeerVolume(peerId, percent) {
    const v = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (v === 100) {
      this.peerVolumes.delete(peerId);
    } else {
      this.peerVolumes.set(peerId, v);
    }
    const audioEl = this.remoteAudioElements.get(peerId);
    if (audioEl) audioEl.volume = v / 100;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('ps_user_volumes', JSON.stringify(Object.fromEntries(this.peerVolumes)));
      }
    } catch (_) {}
    this.emit('volume-change', peerId, v);
    return v;
  }

  static loadVolumes() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = JSON.parse(localStorage.getItem('ps_user_volumes') || '{}');
        return new Map(Object.entries(raw).filter(([, v]) => typeof v === 'number'));
      }
    } catch (_) {}
    return new Map();
  }

  attachMicToPeer(peerId) {
    const meta = this.peerMeta.get(peerId);
    if (!meta || !meta.micTransceiver) return;
    const track = this.audio.audioTrack || null;
    const sender = meta.micTransceiver.sender;
    if (sender.track === track) return;
    sender.replaceTrack(track).catch((err) => {
      console.warn(`[PeerManager] Failed to swap mic track for ${peerId}:`, err);
    });
  }

  attachScreenToPeer(peerId) {
    const pc = this.peerConnections.get(peerId);
    const meta = this.peerMeta.get(peerId);
    const videoTrack = this.screen.videoTrack;
    if (!pc || !meta || !videoTrack) return;
    const stream = this.screen.screenStream;
    const audioTrack = this.screen.audioTrack;

    try {
      const vt = meta.videoTransceiver;
      if (vt.sender.track !== videoTrack) {
        vt.sender.replaceTrack(videoTrack)
          .then(() => this.optimizeVideoBitrate(vt.sender))
          .catch((err) => console.warn(`[PeerManager] Failed to attach screen video for ${peerId}:`, err));
      }
      // Same stream id on video + screen audio lets the receiver tell screen audio from mic
      if (stream && vt.sender.setStreams) vt.sender.setStreams(stream);
      if (vt.direction !== 'sendonly') vt.direction = 'sendonly';

      if (audioTrack) {
        if (!meta.screenAudioTransceiver) {
          meta.screenAudioTransceiver = pc.addTransceiver(audioTrack, {
            direction: 'sendonly',
            streams: stream ? [stream] : []
          });
        } else {
          const at = meta.screenAudioTransceiver;
          if (at.sender.track !== audioTrack) {
            at.sender.replaceTrack(audioTrack)
              .catch((err) => console.warn(`[PeerManager] Failed to attach screen audio for ${peerId}:`, err));
          }
          if (stream && at.sender.setStreams) at.sender.setStreams(stream);
          if (at.direction !== 'sendonly') at.direction = 'sendonly';
        }
      }
    } catch (err) {
      console.error(`[PeerManager] Failed to add screen tracks to peer ${peerId}:`, err);
    }
  }

  detachScreenFromPeer(peerId) {
    const meta = this.peerMeta.get(peerId);
    if (!meta) return;
    for (const t of [meta.videoTransceiver, meta.screenAudioTransceiver]) {
      if (!t) continue;
      try {
        t.sender.replaceTrack(null).catch(() => {});
        if (t.direction !== 'inactive') t.direction = 'inactive';
      } catch (err) {
        console.error(`[PeerManager] Error removing screen track from ${peerId}:`, err);
      }
    }
  }

  async optimizeVideoBitrate(sender) {
    if (!sender || !sender.setParameters) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) return;
      const { maxBitrate, maxFramerate } = PeerManager.getScreenEncoding(this.screen);
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].maxFramerate = maxFramerate;
      await sender.setParameters(params);
    } catch (err) {
      console.warn('[PeerManager] Bitrate optimization note:', err.message);
    }
  }

  /** maxBitrate / maxFramerate for the current screen preset (30fps: 3.5 Mbps, 60fps: up to 6 Mbps). */
  static getScreenEncoding(screen) {
    const preset = (screen && screen.currentPreset) || '720p';
    const fps = (screen && screen.currentFps) === 60 ? 60 : 30;
    const SSM = screen && screen.constructor;
    if (SSM && typeof SSM.getEncodingParams === 'function') return SSM.getEncodingParams(preset, fps);
    return fps === 60
      ? { maxBitrate: preset === '1080p' ? 6000000 : 4500000, maxFramerate: 60 }
      : { maxBitrate: 3500000, maxFramerate: 30 };
  }

  addScreenTrackToAllPeers() {
    for (const peerId of this.peerConnections.keys()) {
      this.attachScreenToPeer(peerId);
    }
  }

  removeScreenTrackFromAllPeers() {
    for (const peerId of this.peerConnections.keys()) {
      this.detachScreenFromPeer(peerId);
    }
  }

  closePeer(peerId) {
    const meta = this.peerMeta.get(peerId);
    if (meta) {
      clearTimeout(meta.recoveryTimer);
      clearTimeout(meta.connectTimer);
      clearTimeout(meta.holdTimer);
    }

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

PeerManager.DISCONNECT_GRACE_MS = 4000;
PeerManager.FAILED_RESET_MS = 12000;
PeerManager.MAX_ICE_RESTARTS = 3;
PeerManager.OFFER_HOLD_MS = 3000;
PeerManager.CONNECT_TIMEOUT_MS = 10000;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PeerManager;
}
