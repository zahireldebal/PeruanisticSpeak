/**
 * Client WebRTC Logic Automated Test Suite
 */
const SignalingClient = require('../src/webrtc/SignalingClient');
const AudioManager = require('../src/webrtc/AudioManager');
const ScreenShareManager = require('../src/webrtc/ScreenShareManager');
const SoundEffects = require('../src/webrtc/SoundEffects');

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

  client.joinRoom('voz-1', 'my-peer-id', 'TestGamer', 'data:image/jpeg;base64,fake');
  assert(lastSent.type === 'join' && lastSent.roomId === 'voz-1' && lastSent.avatar === 'data:image/jpeg;base64,fake', 'SignalingClient correctly serializes join payload with avatar');

  client.sendChatMessage('Hola amigos', null, 'general');
  assert(lastSent.type === 'chat-message' && lastSent.text === 'Hola amigos' && lastSent.roomId === 'general', 'SignalingClient serializes chat-message with channel');

  client.sendUserState({ isMuted: true, isSpeaking: false });
  assert(lastSent.type === 'user-state' && lastSent.isMuted === true, 'SignalingClient serializes user-state');

  client.sendWatchingScreen('target-123', true);
  assert(lastSent.type === 'watching-screen' && lastSent.targetPeerId === 'target-123', 'SignalingClient serializes watching-screen');

  client.sendRequestRenegotiate('target-123');
  assert(lastSent.type === 'request-renegotiate' && lastSent.targetPeerId === 'target-123', 'SignalingClient serializes request-renegotiate');

  // Event parsing
  let receivedPeers = null;
  client.on('room-users', (peers) => { receivedPeers = peers; });
  client.handleMessage({ type: 'room-users', roomId: 'voz-1', peers: [{ peerId: 'p2', username: 'Amigo' }] });
  assert(receivedPeers && receivedPeers[0].username === 'Amigo', 'SignalingClient correctly emits room-users event');

  let serverStateRooms = null;
  client.on('server-state', (rooms) => { serverStateRooms = rooms; });
  client.handleMessage({ type: 'server-state', rooms: { 'voz-1': [] } });
  assert(serverStateRooms && serverStateRooms['voz-1'], 'SignalingClient correctly emits server-state');

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

  // Audio processing controls
  await audio.setAudioProcessing({ noiseSuppression: false, echoCancellation: true, autoGainControl: false });
  assert(audio.audioProcessing.noiseSuppression === false && audio.audioProcessing.autoGainControl === false, 'AudioManager updates audio processing settings');

  // PTT Mode
  audio.setInputMode('ptt');
  assert(audio.inputMode === 'ptt', 'AudioManager switches to PTT mode');
  assert(audio.isPttActive === false, 'PTT is initially inactive');

  audio.pttKeyDown();
  assert(audio.isPttActive === true, 'pttKeyDown activates PTT');

  audio.pttKeyUp();
  assert(audio.isPttActive === false, 'pttKeyUp deactivates PTT');

  // 3. ScreenShareManager constraints & audio
  const screen = new ScreenShareManager();
  const c720 = screen.getConstraints('720p', false);
  assert(c720.video.width.ideal === 1280 && c720.video.height.ideal === 720 && c720.video.frameRate.ideal === 30, 'ScreenShareManager configures 720p @ 30fps');

  const c1080 = screen.getConstraints('1080p', true);
  assert(c1080.video.width.ideal === 1920 && c1080.video.height.ideal === 1080 && c1080.audio !== false, 'ScreenShareManager configures 1080p @ 30fps with audio enabled');

  // 4. SoundEffects methods
  const sounds = new SoundEffects();
  assert(typeof sounds.playJoin === 'function', 'SoundEffects has playJoin method');
  assert(typeof sounds.playLeave === 'function', 'SoundEffects has playLeave method');
  assert(typeof sounds.playScreenShareStart === 'function', 'SoundEffects has playScreenShareStart method');
  assert(typeof sounds.playChatMessage === 'function', 'SoundEffects has playChatMessage method');
  assert(typeof sounds.playViewerJoined === 'function', 'SoundEffects has playViewerJoined method');

  console.log(`\n🎉 All client tests passed: ${passed}/${total}`);
}

runClientTests().catch((err) => {
  console.error('Fatal client test error:', err);
  process.exit(1);
});
