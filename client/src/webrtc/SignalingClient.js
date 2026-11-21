/**
 * SignalingClient: WebSocket connection manager for PeruanisticSPEAK.
 * Handles room signaling, SDP exchange, ICE candidates and state broadcasts.
 */
class SignalingClient {
  constructor(url) {
    this.url = url || 'ws://localhost:3001';
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.manualClose = false;
    this.isConnected = false;
    this.currentRoom = null;
    this.peerId = null;
    this.username = 'Gamer';
    this.avatar = null;
    // Identifies this app run: lets the server resume our seat after a short socket drop
    this.sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);

    // Latency probe (application-level ping, shown in the UI)
    this.pingInterval = null;
    this.pendingPingAt = null;
    this.lastRtt = null;
    this.serverAnswersPing = false; // older servers ignore 'ping': never treat that as a dead socket

    // Reconnect immediately when the OS reports the network is back
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', () => {
        if (!this.isConnected && !this.manualClose) {
          this.reconnectAttempts = 0;
          clearTimeout(this.reconnectTimeout);
          this.connect();
        }
      });
    }
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
          console.error(`[SignalingClient] Error in listener for "${event}":`, err);
        }
      }
    }
  }

  connect(url) {
    this.manualClose = false;
    if (url && url !== this.url) {
      // Server changed: drop the old socket and connect to the new one
      this.url = url;
      if (this.ws) {
        const old = this.ws;
        this.ws = null;
        old.onclose = null;
        try { old.close(); } catch (_) {}
        this.handleSocketClosed();
      }
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('[SignalingClient] Connected to server at', this.url);
        this.startPing();

        // Rejoin room if we reconnected (the only place that re-joins: joining twice made the
        // server announce us as leaving/joining twice and reset everyone's connections)
        const isRejoin = !!(this.currentRoom && this.peerId);
        if (isRejoin) {
          this.joinRoom(this.currentRoom, this.peerId, this.username, this.avatar);
        }
        this.emit('connected', { rejoined: isRejoin });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          console.error('[SignalingClient] Failed to parse incoming message:', err);
        }
      };

      this.ws.onclose = () => {
        this.handleSocketClosed();
        if (!this.manualClose) this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('[SignalingClient] Connection error:', err);
        this.emit('error', err);
      };
    } catch (err) {
      console.error('[SignalingClient] Failed to instantiate WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  handleSocketClosed() {
    const wasConnected = this.isConnected;
    this.isConnected = false;
    this.stopPing();
    if (wasConnected || this.reconnectAttempts === 0) this.emit('disconnected');
    this.emit('ping', null);
  }

  // Keeps retrying forever (Render free instances can take ~1 min to wake up)
  scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      console.log(`[SignalingClient] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect();
    }, delay);
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  joinRoom(roomId, peerId, username, avatar = null) {
    this.currentRoom = roomId;
    this.peerId = peerId;
    if (username) this.username = username;
    if (avatar !== undefined) this.avatar = avatar;

    this.send({
      type: 'join',
      roomId,
      peerId,
      sessionId: this.sessionId,
      username: this.username,
      avatar: this.avatar
    });
  }

  // ---------------------------------------------------------------
  // Latency: ping every PING_INTERVAL_MS; emits 'ping' with ms, or with the time already
  // waited (> PING_TIMEOUT_MS) while a reply is overdue, or null when disconnected.
  // ---------------------------------------------------------------
  startPing() {
    this.stopPing();
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tick = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.pendingPingAt !== null) {
        if (!this.serverAnswersPing) {
          // Server never answered a ping (older version): just retry, no timeout logic
          this.pendingPingAt = null;
          return;
        }
        const waited = now() - this.pendingPingAt;
        if (waited > SignalingClient.PING_TIMEOUT_MS) {
          this.emit('ping', Math.round(waited), true);
        }
        if (waited < SignalingClient.STALE_SOCKET_MS) return;
        // No reply for a long time: the socket is dead even if it was never closed
        console.warn('[SignalingClient] Server not answering, reconnecting...');
        this.pendingPingAt = null;
        const dead = this.ws;
        try { dead.close(); } catch (_) {}
        if (dead.onclose) dead.onclose();
        dead.onclose = null;
        return;
      }
      this.pendingPingAt = now();
      this.send({ type: 'ping', t: this.pendingPingAt });
    };
    tick();
    this.pingInterval = setInterval(tick, SignalingClient.PING_INTERVAL_MS);
  }

  stopPing() {
    clearInterval(this.pingInterval);
    this.pingInterval = null;
    this.pendingPingAt = null;
  }

  handlePong(message) {
    if (this.pendingPingAt === null || message.t !== this.pendingPingAt) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.lastRtt = Math.round(now - this.pendingPingAt);
    this.pendingPingAt = null;
    this.serverAnswersPing = true;
    this.emit('ping', this.lastRtt, false);
  }

  sendOffer(targetPeerId, sdp) {
    this.send({
      type: 'offer',
      targetPeerId,
      sdp
    });
  }

  sendAnswer(targetPeerId, sdp) {
    this.send({
      type: 'answer',
      targetPeerId,
      sdp
    });
  }

  sendIceCandidate(targetPeerId, candidate) {
    this.send({
      type: 'ice-candidate',
      targetPeerId,
      candidate
    });
  }

  sendRequestRenegotiate(targetPeerId) {
    this.send({
      type: 'request-renegotiate',
      targetPeerId
    });
  }

  sendWatchingScreen(targetPeerId, isWatching = true) {
    this.send({
      type: 'watching-screen',
      targetPeerId,
      isWatching
    });
  }

  sendScreenState(isSharingScreen) {
    this.send({
      type: 'screen-state',
      isSharingScreen
    });
  }

  sendUserState({ isMuted, isDeafened, isSpeaking, avatar }) {
    this.send({
      type: 'user-state',
      isMuted,
      isDeafened,
      isSpeaking,
      avatar
    });
  }

  sendChatMessage(text, image = null, roomId = null, identity = null) {
    const room = roomId || this.currentRoom || 'general';
    if (!text && !image) return;
    const payload = {
      type: 'chat-message',
      roomId: room,
      text,
      image
    };
    // Identity is only used by the server when we are not in a voice room
    if (identity) {
      payload.peerId = identity.peerId;
      payload.username = identity.username;
      payload.avatar = identity.avatar || null;
    }
    this.send(payload);
  }

  leaveRoom() {
    this.send({ type: 'leave' });
    this.currentRoom = null;
  }

  handleMessage(message) {
    switch (message.type) {
      case 'server-state':
        this.emit('server-state', message.rooms);
        break;
      case 'room-users':
        this.emit('room-users', message.peers, message.roomId, !!message.resumed);
        break;
      case 'pong':
        this.handlePong(message);
        break;
      case 'ice-config':
        this.emit('ice-config', message.iceServers || []);
        break;
      case 'user-joined':
        this.emit('user-joined', message);
        break;
      case 'user-left':
        this.emit('user-left', message.peerId);
        break;
      case 'offer':
        this.emit('offer', message.senderPeerId, message.sdp);
        break;
      case 'answer':
        this.emit('answer', message.senderPeerId, message.sdp);
        break;
      case 'ice-candidate':
        this.emit('ice-candidate', message.senderPeerId, message.candidate);
        break;
      case 'request-renegotiate':
        this.emit('request-renegotiate', message.senderPeerId);
        break;
      case 'viewer-update':
        this.emit('viewer-update', message.viewerPeerId, message.viewerUsername, message.isWatching);
        break;
      case 'peer-screen-state':
        this.emit('peer-screen-state', message.peerId, message.isSharingScreen);
        break;
      case 'peer-state':
        this.emit('peer-state', message);
        break;
      case 'chat-message':
        this.emit('chat-message', message);
        break;
      case 'chat-history':
        this.emit('chat-history', message.channels || {});
        break;
      case 'error':
        this.emit('server-error', message);
        break;
      default:
        console.warn('[SignalingClient] Unhandled message:', message);
    }
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimeout);
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

SignalingClient.PING_INTERVAL_MS = 2000;
SignalingClient.PING_TIMEOUT_MS = 5000;
SignalingClient.STALE_SOCKET_MS = 15000;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SignalingClient;
}
