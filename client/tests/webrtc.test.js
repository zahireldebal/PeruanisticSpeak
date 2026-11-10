/**
 * Client WebRTC Logic Automated Test Suite
 */
const SignalingClient = require('../src/webrtc/SignalingClient');
const AudioManager = require('../src/webrtc/AudioManager');
const ScreenShareManager = require('../src/webrtc/ScreenShareManager');

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

async function runClientTests() {
  console.log('--- [TEST] Starting Client WebRTC Engine Verification ---');

  // 1. SignalingClient event emitter & message serialization
  const client = new SignalingClient('ws://fake-host:3001');
  let lastSent = null;
  client.ws = {
    readyState: 1, // OPEN
    send: (data) => { lastSent = JSON.parse(data); }
  };

  client.joinRoom('voz-1', 'my-peer-id', 'TestGamer');
  assert(lastSent.type === 'join' && lastSent.roomId === 'voz-1' && lastSent.peerId === 'my-peer-id', 'SignalingClient correctly serializes join payload');

  client.sendChatMessage('Hola amigos');
  assert(lastSent.type === 'chat-message' && lastSent.text === 'Hola amigos', 'SignalingClient serializes chat-message');

  client.sendUserState({ isMuted: true, isSpeaking: false });
  assert(lastSent.type === 'user-state' && lastSent.isMuted === true, 'SignalingClient serializes user-state');

  // Event parsing
  let receivedPeers = null;
  client.on('room-users', (peers) => { receivedPeers = peers; });
  client.handleMessage({ type: 'room-users', roomId: 'voz-1', peers: [{ peerId: 'p2', username: 'Amigo' }] });
  assert(receivedPeers && receivedPeers[0].username === 'Amigo', 'SignalingClient correctly emits room-users event');

  // 2. AudioManager logic
  const audio = new AudioManager();
  assert(audio.isMuted === false, 'AudioManager starts unmuted');
  assert(audio.isDeafened === false, 'AudioManager starts undeafened');

  audio.toggleMute();
  assert(audio.isMuted === true, 'AudioManager toggleMute mutes mic');

  audio.toggleMute();
  assert(audio.isMuted === false, 'AudioManager toggleMute unmutes mic');

  // When deafened, it must also mute
  audio.setDeafen(true);
  assert(audio.isDeafened === true && audio.isMuted === true, 'Deafening user automatically mutes microphone');

  // PTT Mode
  audio.setInputMode('ptt');
  assert(audio.inputMode === 'ptt', 'AudioManager switches to PTT mode');
  assert(audio.isPttActive === false, 'PTT is initially inactive');

  audio.pttKeyDown();
  assert(audio.isPttActive === true, 'pttKeyDown activates PTT');

  audio.pttKeyUp();
  assert(audio.isPttActive === false, 'pttKeyUp deactivates PTT');

  // 3. ScreenShareManager constraints
  const screen = new ScreenShareManager();
  const c720 = screen.getConstraints('720p');
  assert(c720.video.width.ideal === 1280 && c720.video.height.ideal === 720 && c720.video.frameRate.ideal === 30, 'ScreenShareManager configures 720p @ 30fps');

  const c1080 = screen.getConstraints('1080p');
  assert(c1080.video.width.ideal === 1920 && c1080.video.height.ideal === 1080 && c1080.video.frameRate.ideal === 30, 'ScreenShareManager configures 1080p @ 30fps');

  console.log(`\n🎉 All client tests passed: ${passed}/${total}`);
}

runClientTests().catch((err) => {
  console.error('Fatal client test error:', err);
  process.exit(1);
});

