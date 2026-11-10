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

  // 3b. 60 FPS support
  const c720p60 = screen.getConstraints('720p', 60, false);
  assert(c720p60.video.frameRate.ideal === 60 && c720p60.video.frameRate.max === 60 && c720p60.audio === false, 'ScreenShareManager configures 720p @ 60fps');
  assert(screen.currentFps === 60, 'ScreenShareManager tracks current fps');

  const c1080p60 = screen.getConstraints('1080p', 60, true);
  assert(c1080p60.video.height.ideal === 1080 && c1080p60.video.frameRate.ideal === 60 && c1080p60.audio !== false, 'ScreenShareManager configures 1080p @ 60fps with audio');
  assert(c1080p60.audio.restrictOwnAudio === true, 'Screen audio constraints ask to exclude the app\'s own playback');

  const cBad = screen.getConstraints('720p', 144, false);
  assert(cBad.video.frameRate.ideal === 30, 'Unsupported fps values fall back to 30');

  const enc30 = ScreenShareManager.getEncodingParams('1080p', 30);
  const enc60 = ScreenShareManager.getEncodingParams('1080p', 60);
  assert(enc30.maxBitrate === 3500000 && enc30.maxFramerate === 30, 'Encoding: 30fps uses 3.5 Mbps / 30fps');
  assert(enc60.maxBitrate === 6000000 && enc60.maxFramerate === 60, 'Encoding: 1080p60 uses 6 Mbps / 60fps');

  // 3c. Voice test ("Probar Voz") with stubbed browser media APIs
  global.MediaStream = class { constructor(tracks) { this.tracks = tracks || []; } getTracks() { return this.tracks; } getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); } };
  global.Audio = class { constructor() { this.srcObject = null; this.paused = true; } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
  const fakeTrack = (kind = 'audio') => ({ kind, enabled: true, readyState: 'live', stopped: false, stop() { this.stopped = true; this.readyState = 'ended'; }, clone() { return fakeTrack(kind); } });

  const vt = new AudioManager();
  assert(vt.startVoiceTest() === false && vt.isVoiceTesting === false, 'Voice test refuses to start without a microphone');
  vt.audioTrack = fakeTrack();
  vt.audioTrack.enabled = false; // muted mic
  let voiceEvents = [];
  vt.on('voice-test-change', (on) => voiceEvents.push(on));
  assert(vt.toggleVoiceTest() === true && vt.isVoiceTesting === true, 'toggleVoiceTest starts the voice test');
  assert(vt.voiceTestTrack !== vt.audioTrack && vt.voiceTestTrack.enabled === true, 'Voice test uses an enabled clone of the mic track (works while muted)');
  assert(vt.voiceTestElement && vt.voiceTestElement.paused === false, 'Voice test plays the mic back locally');
  const clone = vt.voiceTestTrack;
  assert(vt.toggleVoiceTest() === false && clone.stopped === true && vt.voiceTestElement === null, 'toggleVoiceTest stops playback and releases the clone');
  assert(vt.audioTrack.stopped === false, 'Stopping the voice test leaves the real mic track running');
  vt.startVoiceTest();
  vt.destroy();
  assert(vt.isVoiceTesting === false, 'destroy() stops an active voice test');
  assert(voiceEvents.join(',') === 'true,false,true,false', 'voice-test-change events fire on start/stop');

  // 3d. PeerManager negotiation & track routing with a mocked RTCPeerConnection
  class FakeSender { constructor(track) { this.track = track || null; } replaceTrack(t) { this.track = t; return Promise.resolve(); } setStreams() {} getParameters() { return { encodings: [{}] }; } setParameters(p) { this.params = p; return Promise.resolve(); } }
  class FakePC {
    constructor() { this.transceivers = []; this.signalingState = 'stable'; this.connectionState = 'new'; this.remoteDescription = null; this.closed = false; FakePC.all.push(this); }
    addTransceiver(trackOrKind, init = {}) { const t = { sender: new FakeSender(typeof trackOrKind === 'string' ? null : trackOrKind), direction: init.direction || 'sendrecv' }; this.transceivers.push(t); return t; }
    async setRemoteDescription(d) { if (this.failNextSRD) { this.failNextSRD = false; throw new Error('m-lines mismatch'); } this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; }
    async setLocalDescription() { this.localDescription = { type: this.signalingState === 'have-remote-offer' ? 'answer' : 'offer', sdp: 'x' }; this.signalingState = this.localDescription.type === 'answer' ? 'stable' : 'have-local-offer'; }
    async addIceCandidate() {}
    restartIce() { this.iceRestarted = (this.iceRestarted || 0) + 1; }
    close() { this.closed = true; }
  }
  FakePC.all = [];
  global.RTCPeerConnection = FakePC;
  const PeerManager = require('../src/webrtc/PeerManager');

  const sig = new SignalingClient('ws://fake-host:3001');
  const sent = [];
  sig.peerId = 'peer_b';
  sig.ws = { readyState: 1, send: (d) => sent.push(JSON.parse(d)) };
  const pmAudio = new AudioManager();
  const pmScreen = new ScreenShareManager();
  const pm = new PeerManager(sig, pmAudio, pmScreen);

  sig.handleMessage({ type: 'room-users', roomId: 'voz-1', peers: [{ peerId: 'peer_c', username: 'C' }] });
  const pcC1 = pm.peerConnections.get('peer_c');
  assert(pcC1 && pm.peerMeta.get('peer_c').micTransceiver, 'PeerManager creates a connection with a dedicated mic transceiver');

  // Mic initialized late -> swapped into existing connections
  pmAudio.audioTrack = fakeTrack();
  pmAudio.emit('ready');
  assert(pm.peerMeta.get('peer_c').micTransceiver.sender.track === pmAudio.audioTrack, 'Late microphone init is attached to existing peers');

  // Re-join of the same peer replaces the stale connection
  sig.handleMessage({ type: 'user-joined', peerId: 'peer_c', username: 'C' });
  assert(pcC1.closed === true && pm.peerConnections.get('peer_c') !== pcC1, 'Re-joined peer gets a fresh connection (stale one closed)');

  // Answer arriving in stable state is ignored (no InvalidStateError)
  const pcC2 = pm.peerConnections.get('peer_c');
  await pm.handleAnswer('peer_c', { type: 'answer', sdp: 'late' });
  assert(pcC2.remoteDescription === null, 'Late answer in stable state is ignored');

  // Offer that cannot be applied -> connection rebuilt and answered
  pcC2.failNextSRD = true;
  sent.length = 0;
  await pm.handleOffer('peer_c', { type: 'offer', sdp: 'from-rebuilt-remote' });
  const pcC3 = pm.peerConnections.get('peer_c');
  assert(pcC2.closed && pcC3 !== pcC2 && sent.some(m => m.type === 'answer'), 'Incompatible offer rebuilds the connection and still answers');

  // Remote tracks: mic -> voice element, screen audio -> NOT voice element
  const micTrack = fakeTrack('audio');
  pcC3.ontrack({ track: micTrack, streams: [new MediaStream([micTrack])] });
  const voiceEl = pm.remoteAudioElements.get('peer_c');
  assert(voiceEl && voiceEl.srcObject.tracks[0] === micTrack, 'Remote mic track goes to the voice audio element');
  const scrVideo = fakeTrack('video');
  const scrAudio = fakeTrack('audio');
  const scrStream = new MediaStream([scrVideo, scrAudio]);
  pcC3.ontrack({ track: scrAudio, streams: [scrStream] });
  assert(pm.remoteAudioElements.get('peer_c').srcObject.tracks[0] === micTrack, 'Screen audio does not replace the streamer\'s voice');

  // Disconnected is not fatal anymore
  pcC3.connectionState = 'disconnected';
  pcC3.onconnectionstatechange();
  assert(pm.peerConnections.get('peer_c') === pcC3, 'Transient disconnect keeps the connection (recovery instead of drop)');
  pcC3.connectionState = 'failed';
  pcC3.onconnectionstatechange();
  assert(pcC3.iceRestarted === 1, 'Failed connection triggers an ICE restart');

  // Per-user volume
  assert(pm.getPeerVolume('peer_c') === 100, 'Default user volume is 100%');
  pm.setPeerVolume('peer_c', 40);
  assert(Math.abs(pm.remoteAudioElements.get('peer_c').volume - 0.4) < 1e-9, 'setPeerVolume(40) sets the voice element volume to 0.4');
  assert(pm.setPeerVolume('peer_c', 250) === 100 && pm.setPeerVolume('peer_c', -5) === 0, 'User volume is clamped to 0-100');
  pm.setPeerVolume('peer_c', 100);

  // Fresh connection to a newcomer waits for their offer (no initial glare)
  sent.length = 0;
  sig.handleMessage({ type: 'user-joined', peerId: 'peer_d', username: 'D' });
  const pcD = pm.peerConnections.get('peer_d');
  await pcD.onnegotiationneeded();
  assert(!sent.some(m => m.type === 'offer' && m.targetPeerId === 'peer_d'), 'Existing member does not offer to a newcomer before the newcomer offers');
  await pm.handleOffer('peer_d', { type: 'offer', sdp: 'newcomer-offer' });
  await new Promise(r => setTimeout(r, 0));
  const toD = sent.filter(m => m.targetPeerId === 'peer_d').map(m => m.type).join(',');
  assert(toD === 'answer,offer', `After answering the newcomer, the held negotiation is sent (${toD})`);

  sent.length = 0;
  sig.handleMessage({ type: 'room-users', roomId: 'voz-1', peers: [{ peerId: 'peer_e', username: 'E' }] });
  await pm.peerConnections.get('peer_e').onnegotiationneeded();
  assert(sent.some(m => m.type === 'offer' && m.targetPeerId === 'peer_e'), 'Newcomer offers immediately to existing members');
  pm.destroy();

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
