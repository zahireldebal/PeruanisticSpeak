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

  // 9b. Text channels are server-wide (not tied to the voice room)
  const waitForMsg = (ws, pred) => new Promise((resolve) => {
    const handler = (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (pred(parsed)) { ws.off('message', handler); resolve(parsed); }
    };
    ws.on('message', handler);
  });

  const wsD = new WebSocket(`ws://127.0.0.1:${testPort}`);
  const historyD = waitForMsg(wsD, m => m.type === 'chat-history');
  await new Promise(r => wsD.on('open', r));
  await historyD;
  const generalAtD = waitForMsg(wsD, m => m.type === 'chat-message' && m.roomId === 'general');
  wsA.send(JSON.stringify({ type: 'chat-message', roomId: 'general', text: 'Mensaje para todos' }));
  const gD = await generalAtD;
  assert(gD.text === 'Mensaje para todos' && gD.username === 'GamerA' && gD.id, 'User outside any voice room receives #general messages');

  const fromDAtB = waitForMsg(wsB, m => m.type === 'chat-message' && m.roomId === 'voz-2');
  wsD.send(JSON.stringify({ type: 'chat-message', roomId: 'voz-2', text: 'Hola desde afuera', peerId: 'peer-d', username: 'GamerD' }));
  const dB = await fromDAtB;
  assert(dB.username === 'GamerD' && dB.senderPeerId === 'peer-d', 'User outside voice can write in #voz-2 and others in voz-1 receive it');

  const badAtB = waitForMsg(wsB, m => m.type === 'chat-message' && m.text === 'canal invalido');
  wsD.send(JSON.stringify({ type: 'chat-message', roomId: '../../etc', text: 'canal invalido' }));
  const okAtB = waitForMsg(wsB, m => m.type === 'chat-message' && m.text === 'canal valido');
  wsD.send(JSON.stringify({ type: 'chat-message', roomId: 'sala-afk', text: 'canal valido', username: 'GamerD' }));
  const first = await Promise.race([badAtB.then(() => 'bad'), okAtB.then(() => 'ok')]);
  assert(first === 'ok', 'Invalid text channel ids are rejected, #sala-afk works');

  // 9c. Late connection receives recent chat history
  const wsE = new WebSocket(`ws://127.0.0.1:${testPort}`);
  const historyE = waitForMsg(wsE, m => m.type === 'chat-history');
  await new Promise(r => wsE.on('open', r));
  const hE = await historyE;
  assert(hE.channels.general && hE.channels.general.some(m => m.text === 'Mensaje para todos') && hE.channels['voz-2'].length === 1, 'New connection receives per-channel chat history');
  wsE.close();

  // 9d. Streamer switching voice room keeps its "sharing" state
  const stateAfterSwitch = waitForMsg(wsD, m => m.type === 'server-state' && m.rooms['voz-2']);
  wsA.send(JSON.stringify({ type: 'join', roomId: 'voz-2', peerId: 'peer-a', username: 'GamerA' }));
  const sA = await stateAfterSwitch;
  assert(sA.rooms['voz-2'][0].peerId === 'peer-a' && sA.rooms['voz-2'][0].isSharingScreen === true, 'Streamer who switches room is still marked as sharing');
  wsA.send(JSON.stringify({ type: 'join', roomId: 'voz-1', peerId: 'peer-a', username: 'GamerA' }));
  wsD.close();

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

  // 11. Unique Nickname enforcement
  const wsC = new WebSocket(`ws://127.0.0.1:${testPort}`);
  await new Promise(r => wsC.on('open', r));

  const errorPromiseC = new Promise((resolve) => {
    wsC.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'error') resolve(parsed);
    });
  });

  wsC.send(JSON.stringify({
    type: 'join',
    roomId: 'voz-1',
    peerId: 'peer-c',
    username: 'GamerB' // already taken by wsB!
  }));

  const errC = await errorPromiseC;
  assert(errC.code === 'nick-taken', 'Server rejects duplicate nickname');
  wsC.close();

  // 12. Ping / pong latency probe
  const pongP = waitForMsg(wsB, m => m.type === 'pong');
  wsB.send(JSON.stringify({ type: 'ping', t: 12345.5 }));
  const pong = await pongP;
  assert(pong.t === 12345.5, 'Server answers ping with pong echoing the timestamp');

  // 13. Session resume: a quick socket drop does not tear down the call for others
  SignalingServer.RESUME_GRACE_MS = 400;
  const openWs = () => new Promise(res => { const w = new WebSocket(`ws://127.0.0.1:${testPort}`); w.on('open', () => res(w)); });
  const wsR1 = await openWs();
  const joinedR = waitForMsg(wsB, m => m.type === 'user-joined' && m.peerId === 'peer-r');
  wsR1.send(JSON.stringify({ type: 'join', roomId: 'voz-1', peerId: 'peer-r', username: 'Resumer', sessionId: 'sess-1' }));
  await joinedR;

  const leftEvents = [];
  const leftListener = (msg) => { const m = JSON.parse(msg.toString()); if (m.type === 'user-left' || m.type === 'user-joined') leftEvents.push(m.type + ':' + m.peerId); };
  wsB.on('message', leftListener);
  wsR1.terminate();
  await new Promise(r => setTimeout(r, 100));
  const wsR2 = await openWs();
  const resumedP = waitForMsg(wsR2, m => m.type === 'room-users');
  wsR2.send(JSON.stringify({ type: 'join', roomId: 'voz-1', peerId: 'peer-r', username: 'Resumer', sessionId: 'sess-1' }));
  const resumed = await resumedP;
  await new Promise(r => setTimeout(r, 600)); // longer than the grace period
  assert(resumed.resumed === true && resumed.peers.some(p => p.peerId === 'peer-b'), 'Reconnect within the grace period resumes the session (room-users resumed)');
  assert(leftEvents.length === 0, `Others see no leave/join on a resumed reconnect (${leftEvents.join(',') || 'none'})`);

  const offerToR = waitForMsg(wsR2, m => m.type === 'offer');
  wsB.send(JSON.stringify({ type: 'offer', targetPeerId: 'peer-r', sdp: { type: 'offer', sdp: 'x' } }));
  assert((await offerToR).senderPeerId === 'peer-b', 'Signaling reaches the resumed socket');

  // 14. Without a reconnect, the seat is released after the grace period
  wsR2.terminate();
  const t0 = Date.now();
  while (!leftEvents.includes('user-left:peer-r') && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 50));
  assert(leftEvents.includes('user-left:peer-r'), 'Peer is announced as left once the grace period expires');

  // 15. A different session with the same peerId (app restarted) is a fresh join
  leftEvents.length = 0;
  const wsS1 = await openWs();
  wsS1.send(JSON.stringify({ type: 'join', roomId: 'voz-1', peerId: 'peer-s', username: 'Restarter', sessionId: 'old' }));
  await new Promise(r => setTimeout(r, 150));
  wsS1.terminate();
  await new Promise(r => setTimeout(r, 50));
  const wsS2 = await openWs();
  const freshP = waitForMsg(wsS2, m => m.type === 'room-users');
  wsS2.send(JSON.stringify({ type: 'join', roomId: 'voz-1', peerId: 'peer-s', username: 'Restarter', sessionId: 'new' }));
  const fresh = await freshP;
  await new Promise(r => setTimeout(r, 150));
  assert(!fresh.resumed && leftEvents.includes('user-left:peer-s') && leftEvents.includes('user-joined:peer-s'), 'New app session with the same peerId is treated as leave + join');
  wsB.off('message', leftListener);
  wsS2.close();

  // 16. ICE (TURN) configuration from environment variables
  process.env.TURN_URLS = 'turn:turn.example.com:3478,turns:turn.example.com:5349';
  process.env.TURN_USERNAME = 'u';
  process.env.TURN_CREDENTIAL = 'p';
  server.iceConfigCache = null;
  const wsI = new WebSocket(`ws://127.0.0.1:${testPort}`);
  const iceP = waitForMsg(wsI, m => m.type === 'ice-config');
  const ice = await iceP;
  assert(ice.iceServers.length === 1 && ice.iceServers[0].urls.length === 2 && ice.iceServers[0].username === 'u', 'Server sends TURN config from TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL');
  wsI.close();
  delete process.env.TURN_URLS; delete process.env.TURN_USERNAME; delete process.env.TURN_CREDENTIAL;

  wsB.close();
  await server.close();

  console.log(`\n🎉 All tests passed: ${passed}/${total}`);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
