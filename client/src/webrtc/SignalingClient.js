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
    this.maxReconnectAttempts = 10;
    this.reconnectTimeout = null;
    this.isConnected = false;
    this.currentRoom = null;
    this.peerId = null;
    this.username = 'Gamer';
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
    if (url) this.url = url;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('[SignalingClient] Connected to server at', this.url);
        this.emit('connected');

        // Rejoin room if we reconnected
        if (this.currentRoom && this.peerId) {
          this.joinRoom(this.currentRoom, this.peerId, this.username);
        }
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
        this.isConnected = false;
        this.emit('disconnected');
        this.scheduleReconnect();
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

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[SignalingClient] Max reconnect attempts reached.');
      return;
    }
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

  joinRoom(roomId, peerId, username) {
    this.currentRoom = roomId;
    this.peerId = peerId;
    if (username) this.username = username;

    this.send({
      type: 'join',
      roomId,
      peerId,
      username: this.username
    });
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

  sendScreenState(isSharingScreen) {
    this.send({
      type: 'screen-state',
      isSharingScreen
    });
  }

  sendUserState({ isMuted, isDeafened, isSpeaking }) {
    this.send({
      type: 'user-state',
      isMuted,
      isDeafened,
      isSpeaking
    });
  }

  sendChatMessage(text) {
    if (!this.currentRoom || !text) return;
    this.send({
      type: 'chat-message',
      roomId: this.currentRoom,
      text
    });
  }

  leaveRoom() {
    this.send({ type: 'leave' });
    this.currentRoom = null;
  }

  handleMessage(message) {
    switch (message.type) {
      case 'room-users':
        this.emit('room-users', message.peers, message.roomId);
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
      case 'peer-screen-state':
        this.emit('peer-screen-state', message.peerId, message.isSharingScreen);
        break;
      case 'peer-state':
        this.emit('peer-state', message);
        break;
      case 'chat-message':
        this.emit('chat-message', message);
        break;
      default:
        console.warn('[SignalingClient] Unhandled message:', message);
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SignalingClient;
}

