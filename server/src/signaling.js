const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

/**
 * PeruanisticSPEAK Signaling Server
 * Ultra-lightweight WebRTC coordinator for voice, screen-sharing and text chat.
 */
class SignalingServer {
  constructor(options = {}) {
    this.port = options.port || process.env.PORT || 3001;
    this.host = options.host || process.env.HOST || '0.0.0.0';
    this.rooms = new Map(); // roomId -> Map(peerId -> { ws, username, avatar, isSharingScreen, isMuted, isDeafened, isSpeaking })
    this.peers = new Map(); // ws -> { peerId, username, avatar, roomId, isAlive }
    this.server = null;
    this.wss = null;
    this.heartbeatInterval = null;
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            service: 'PeruanisticSPEAK Signaling Server',
            version: '1.0.0',
            activeRooms: this.rooms.size,
            connectedClients: this.peers.size
          }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws) => {
        const peerState = {
          peerId: null,
          username: 'Gamer',
          avatar: null,
          roomId: null,
          isAlive: true,
          isSharingScreen: false,
          isMuted: false,
          isDeafened: false,
          isSpeaking: false
        };
        this.peers.set(ws, peerState);

        // Send current server-wide channels state immediately on connection
        this.send(ws, {
          type: 'server-state',
          rooms: this.getServerState()
        });

        ws.on('pong', () => {
          peerState.isAlive = true;
        });

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(ws, message);
          } catch (err) {
            console.error('[Signaling] Failed to parse message:', err.message);
          }
        });

        ws.on('close', () => {
          this.handleDisconnect(ws);
        });

        ws.on('error', (err) => {
          console.error('[Signaling] Client connection error:', err.message);
          this.handleDisconnect(ws);
        });
      });

      // Keepalive heartbeat every 15 seconds to immediately catch disconnected/zombie peers
      this.heartbeatInterval = setInterval(() => {
        for (const [ws, peerState] of this.peers.entries()) {
          if (!peerState.isAlive) {
            console.log(`[Signaling] Heartbeat timeout for peer ${peerState.peerId || 'unknown'}, terminating.`);
            ws.terminate();
            this.handleDisconnect(ws);
            continue;
          }
          peerState.isAlive = false;
          ws.ping();
        }
      }, 15000);

      this.server.listen(this.port, this.host, () => {
        console.log(`[Signaling] PeruanisticSPEAK signaling server running on port ${this.port}`);
        resolve(this);
      });
    });
  }

  getServerState() {
    const channelUsers = {};
    for (const [roomId, room] of this.rooms.entries()) {
      channelUsers[roomId] = [];
      for (const [peerId, user] of room.entries()) {
        channelUsers[roomId].push({
          peerId: user.peerId,
          username: user.username,
          avatar: user.avatar,
          isSharingScreen: user.isSharingScreen,
          isMuted: user.isMuted,
          isDeafened: user.isDeafened,
          isSpeaking: user.isSpeaking
        });
      }
    }
    return channelUsers;
  }

  broadcastServerState() {
    const payload = {
      type: 'server-state',
      rooms: this.getServerState()
    };
    for (const ws of this.peers.keys()) {
      this.send(ws, payload);
    }
  }

  handleMessage(ws, message) {
    const peerState = this.peers.get(ws);
    if (!peerState) return;

    switch (message.type) {
      case 'join': {
        const { roomId, peerId, username, avatar } = message;
        if (!roomId || !peerId) return;

        const requestedNick = (username || `Gamer_${peerId.slice(0, 4)}`).trim();

        // Enforce unique nickname across all active peers
        for (const [otherWs, otherState] of this.peers.entries()) {
          if (otherWs !== ws && otherState.peerId && otherState.peerId !== peerId) {
            if (otherState.username.toLowerCase() === requestedNick.toLowerCase()) {
              this.send(ws, {
                type: 'error',
                code: 'nick-taken',
                message: `El apodo "${requestedNick}" ya está en uso. Por favor elige otro.`
              });
              return;
            }
          }
        }

        // Leave any existing room first
        if (peerState.roomId) {
          this.leaveRoom(ws);
        }

        peerState.peerId = peerId;
        peerState.username = requestedNick;
        peerState.avatar = avatar || null;
        peerState.roomId = roomId;

        if (!this.rooms.has(roomId)) {
          this.rooms.set(roomId, new Map());
        }

        const room = this.rooms.get(roomId);

        // Notify other room members of the new joiner
        this.broadcastToRoom(roomId, ws, {
          type: 'user-joined',
          peerId: peerState.peerId,
          username: peerState.username,
          avatar: peerState.avatar
        });

        // Add current peer to the room
        room.set(peerState.peerId, {
          ws,
          peerId: peerState.peerId,
          username: peerState.username,
          avatar: peerState.avatar,
          isSharingScreen: peerState.isSharingScreen,
          isMuted: peerState.isMuted,
          isDeafened: peerState.isDeafened,
          isSpeaking: peerState.isSpeaking
        });

        // Send existing room participants back to the joiner
        const existingPeers = [];
        for (const [id, user] of room.entries()) {
          if (id !== peerId) {
            existingPeers.push({
              peerId: user.peerId,
              username: user.username,
              avatar: user.avatar,
              isSharingScreen: user.isSharingScreen,
              isMuted: user.isMuted,
              isDeafened: user.isDeafened,
              isSpeaking: user.isSpeaking
            });
          }
        }

        this.send(ws, {
          type: 'room-users',
          roomId,
          peers: existingPeers
        });

        // Broadcast updated presence to all connected clients
        this.broadcastServerState();
        break;
      }

      case 'offer': {
        const { targetPeerId, sdp } = message;
        this.forwardToPeer(peerState.roomId, targetPeerId, {
          type: 'offer',
          senderPeerId: peerState.peerId,
          sdp
        });
        break;
      }

      case 'answer': {
        const { targetPeerId, sdp } = message;
        this.forwardToPeer(peerState.roomId, targetPeerId, {
          type: 'answer',
          senderPeerId: peerState.peerId,
          sdp
        });
        break;
      }

      case 'ice-candidate': {
        const { targetPeerId, candidate } = message;
        this.forwardToPeer(peerState.roomId, targetPeerId, {
          type: 'ice-candidate',
          senderPeerId: peerState.peerId,
          candidate
        });
        break;
      }

      case 'request-renegotiate': {
        const { targetPeerId } = message;
        this.forwardToPeer(peerState.roomId, targetPeerId, {
          type: 'request-renegotiate',
          senderPeerId: peerState.peerId
        });
        break;
      }

      case 'watching-screen': {
        const { targetPeerId, isWatching } = message;
        this.forwardToPeer(peerState.roomId, targetPeerId, {
          type: 'viewer-update',
          viewerPeerId: peerState.peerId,
          viewerUsername: peerState.username,
          isWatching: isWatching !== false
        });
        break;
      }

      case 'screen-state': {
        peerState.isSharingScreen = !!message.isSharingScreen;
        this.updateRoomPeer(peerState);
        this.broadcastToRoom(peerState.roomId, ws, {
          type: 'peer-screen-state',
          peerId: peerState.peerId,
          isSharingScreen: peerState.isSharingScreen
        });
        this.broadcastServerState();
        break;
      }

      case 'user-state': {
        if (typeof message.isMuted === 'boolean') peerState.isMuted = message.isMuted;
        if (typeof message.isDeafened === 'boolean') peerState.isDeafened = message.isDeafened;
        if (typeof message.isSpeaking === 'boolean') peerState.isSpeaking = message.isSpeaking;
        if (message.avatar) peerState.avatar = message.avatar;
        this.updateRoomPeer(peerState);
        this.broadcastToRoom(peerState.roomId, ws, {
          type: 'peer-state',
          peerId: peerState.peerId,
          isMuted: peerState.isMuted,
          isDeafened: peerState.isDeafened,
          isSpeaking: peerState.isSpeaking,
          avatar: peerState.avatar
        });
        this.broadcastServerState();
        break;
      }

      case 'chat-message': {
        const targetRoom = message.roomId || peerState.roomId;
        if (!targetRoom || (!message.text && !message.image)) return;
        this.broadcastToRoom(targetRoom, null, {
          type: 'chat-message',
          roomId: targetRoom,
          senderPeerId: peerState.peerId,
          username: peerState.username,
          avatar: peerState.avatar,
          text: message.text ? String(message.text).slice(0, 1000) : '',
          image: message.image ? String(message.image) : null,
          timestamp: Date.now()
        });
        break;
      }

      case 'leave': {
        this.leaveRoom(ws);
        this.broadcastServerState();
        break;
      }

      default:
        console.warn(`[Signaling] Unknown message type: ${message.type}`);
    }
  }

  updateRoomPeer(peerState) {
    if (!peerState.roomId || !this.rooms.has(peerState.roomId)) return;
    const room = this.rooms.get(peerState.roomId);
    const member = room.get(peerState.peerId);
    if (member) {
      member.isSharingScreen = peerState.isSharingScreen;
      member.isMuted = peerState.isMuted;
      member.isDeafened = peerState.isDeafened;
      member.isSpeaking = peerState.isSpeaking;
      member.avatar = peerState.avatar;
    }
  }

  forwardToPeer(roomId, targetPeerId, payload) {
    if (!roomId || !this.rooms.has(roomId)) return;
    const room = this.rooms.get(roomId);
    const target = room.get(targetPeerId);
    if (target && target.ws.readyState === WebSocket.OPEN) {
      this.send(target.ws, payload);
    }
  }

  broadcastToRoom(roomId, excludeWs, payload) {
    if (!roomId || !this.rooms.has(roomId)) return;
    const room = this.rooms.get(roomId);
    for (const member of room.values()) {
      if (member.ws !== excludeWs && member.ws.readyState === WebSocket.OPEN) {
        this.send(member.ws, payload);
      }
    }
  }

  send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  leaveRoom(ws) {
    const peerState = this.peers.get(ws);
    if (!peerState || !peerState.roomId) return;

    const roomId = peerState.roomId;
    if (this.rooms.has(roomId)) {
      const room = this.rooms.get(roomId);
      room.delete(peerState.peerId);

      this.broadcastToRoom(roomId, ws, {
        type: 'user-left',
        peerId: peerState.peerId
      });

      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    peerState.roomId = null;
    peerState.isSharingScreen = false;
  }

  handleDisconnect(ws) {
    this.leaveRoom(ws);
    this.peers.delete(ws);
    this.broadcastServerState();
  }

  close() {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
      if (this.wss) {
        this.wss.close();
      }
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

// Start standalone if invoked directly
if (require.main === module) {
  const port = process.env.PORT || 3001;
  const server = new SignalingServer({ port });
  server.start();
}

module.exports = SignalingServer;
