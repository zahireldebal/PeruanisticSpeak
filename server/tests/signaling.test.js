const { WebSocket } = require('ws');
const http = require('http');
const SignalingServer = require('../src/signaling');

async function runTests() {
  console.log('--- [TEST] Starting Signaling Server Verification ---');
  const testPort = 3999;
  const server = new SignalingServer({ port: testPort, host: '127.0.0.1' });
  await server.start();

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      process.exit(1);
    } else {
      console.log(`✅ PASS: ${message}`);
      passed++;
    }
  }

  // 1. Health check HTTP endpoint
  await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${testPort}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        assert(res.statusCode === 200, 'HTTP /health returns 200');
        assert(json.status === 'ok', 'HTTP /health status is ok');
        resolve();
      });
    });
  });

  // 2. Client A and Client B connection and handshake
  const wsA = new WebSocket(`ws://127.0.0.1:${testPort}`);
  const wsB = new WebSocket(`ws://127.0.0.1:${testPort}`);

  await Promise.all([
    new Promise(r => wsA.on('open', r)),
    new Promise(r => wsB.on('open', r))
  ]);
  assert(true, 'Client A and B connected via WebSocket');

  // 3. Client A joins room 'voz-1'
  const roomUsersPromiseA = new Promise((resolve) => {
    wsA.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'room-users') resolve(parsed);
    });
  });

  wsA.send(JSON.stringify({
    type: 'join',
    roomId: 'voz-1',
    peerId: 'peer-a',
    username: 'GamerA'
  }));

  const roomUsersA = await roomUsersPromiseA;
  assert(roomUsersA.roomId === 'voz-1' && roomUsersA.peers.length === 0, 'Client A receives empty room-users on first join');

  // 4. Client B joins room 'voz-1'
  const userJoinedPromiseA = new Promise((resolve) => {
    wsA.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'user-joined') resolve(parsed);
    });
  });

  const roomUsersPromiseB = new Promise((resolve) => {
    wsB.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'room-users') resolve(parsed);
    });
  });

  wsB.send(JSON.stringify({
    type: 'join',
    roomId: 'voz-1',
    peerId: 'peer-b',
    username: 'GamerB'
  }));

  const [joinedA, roomUsersB] = await Promise.all([userJoinedPromiseA, roomUsersPromiseB]);
  assert(joinedA.peerId === 'peer-b' && joinedA.username === 'GamerB', 'Client A receives user-joined for Client B');
  assert(roomUsersB.peers.length === 1 && roomUsersB.peers[0].peerId === 'peer-a', 'Client B receives Client A in room-users');

  // 5. SDP Offer/Answer forwarding
  const offerPromiseB = new Promise((resolve) => {
    wsB.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'offer') resolve(parsed);
    });
  });

  wsA.send(JSON.stringify({
    type: 'offer',
    targetPeerId: 'peer-b',
    sdp: { type: 'offer', sdp: 'fake-sdp-offer' }
  }));

  const offerReceivedB = await offerPromiseB;
  assert(offerReceivedB.senderPeerId === 'peer-a' && offerReceivedB.sdp.sdp === 'fake-sdp-offer', 'Client B receives offer forwarded from Client A');

  // 6. SDP Answer forwarding
  const answerPromiseA = new Promise((resolve) => {
    wsA.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'answer') resolve(parsed);
    });
  });

  wsB.send(JSON.stringify({
    type: 'answer',
    targetPeerId: 'peer-a',
    sdp: { type: 'answer', sdp: 'fake-sdp-answer' }
  }));

  const answerReceivedA = await answerPromiseA;
  assert(answerReceivedA.senderPeerId === 'peer-b' && answerReceivedA.sdp.sdp === 'fake-sdp-answer', 'Client A receives answer forwarded from Client B');

  // 7. ICE Candidate forwarding
  const icePromiseB = new Promise((resolve) => {
    wsB.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'ice-candidate') resolve(parsed);
    });
  });

  wsA.send(JSON.stringify({
    type: 'ice-candidate',
    targetPeerId: 'peer-b',
    candidate: { candidate: 'candidate:1 1 UDP ...' }
  }));

  const iceReceivedB = await icePromiseB;
  assert(iceReceivedB.senderPeerId === 'peer-a' && iceReceivedB.candidate.candidate.includes('UDP'), 'Client B receives ICE candidate from Client A');

  // 8. Screen share state broadcast
  const screenPromiseB = new Promise((resolve) => {
    wsB.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'peer-screen-state') resolve(parsed);
    });
  });

  wsA.send(JSON.stringify({
    type: 'screen-state',
    isSharingScreen: true
  }));

  const screenReceivedB = await screenPromiseB;
  assert(screenReceivedB.peerId === 'peer-a' && screenReceivedB.isSharingScreen === true, 'Client B receives screen-state broadcast');

  // 9. Chat message broadcast
  const chatPromiseB = new Promise((resolve) => {
    wsB.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'chat-message') resolve(parsed);
    });
  });

  wsA.send(JSON.stringify({
    type: 'chat-message',
    roomId: 'voz-1',
    text: 'Hola gentita, probando micro'
  }));

  const chatReceivedB = await chatPromiseB;
  assert(chatReceivedB.senderPeerId === 'peer-a' && chatReceivedB.text === 'Hola gentita, probando micro', 'Client B receives chat message in room');

  // 10. Disconnect and user-left broadcast
  const leftPromiseB = new Promise((resolve) => {
    wsB.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'user-left') resolve(parsed);
    });
  });

  wsA.close();
  const leftReceivedB = await leftPromiseB;
  assert(leftReceivedB.peerId === 'peer-a', 'Client B receives user-left when Client A disconnects');

  wsB.close();
  await server.close();

  console.log(`\n🎉 All tests passed: ${passed}/${total}`);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

