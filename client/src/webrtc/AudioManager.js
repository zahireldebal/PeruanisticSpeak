/**
 * AudioManager: Controls local audio capture, VAD (Voice Activity Detection),
 * Mute, Deafen, Push-To-Talk modes and noise suppression/echo cancellation processing.
 */
class AudioManager {
  constructor() {
    this.localStream = null;
    this.audioTrack = null;
    this.audioContext = null;
    this.analyser = null;
    this.microphoneSource = null;
    this.animationFrame = null;

    this.isMuted = false;
    this.isDeafened = false;
    this.isSpeaking = false;
    this.volume = 0;

    // Modes: 'vad' (voice activity detection) | 'ptt' (push-to-talk)
    this.inputMode = 'vad';
    this.isPttActive = false;
    this.vadThreshold = 0.02; // Threshold for speaking detection
    this.speakingDebounceTimeout = null;

    // Advanced Audio Processing (Discord style)
    let savedProcessing = null;
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('ps_audio_processing');
        if (stored) savedProcessing = JSON.parse(stored);
      }
    } catch (_) {}

    this.audioProcessing = Object.assign({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true
    }, savedProcessing || {});

    this.selectedDeviceId = null;

    // Voice test ("Escucharme"): plays your own processed mic back locally
    this.isVoiceTesting = false;
    this.voiceTestTrack = null;
    this.voiceTestElement = null;

    this.listeners = new Map();
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
          console.error(`[AudioManager] Listener error on ${event}:`, err);
        }
      }
    }
  }

  async init(deviceId = null) {
    try {
      if (!deviceId && typeof localStorage !== 'undefined') {
        deviceId = localStorage.getItem('ps_audio_device') || null;
      }
      this.selectedDeviceId = deviceId;

      const constraints = {
        audio: {
          echoCancellation: !!this.audioProcessing.echoCancellation,
          noiseSuppression: !!this.audioProcessing.noiseSuppression,
          autoGainControl: !!this.audioProcessing.autoGainControl,
          channelCount: 1, // mono for voice optimization
          sampleRate: 48000
        },
        video: false
      };

      if (deviceId) {
        constraints.audio.deviceId = { exact: deviceId };
      }

      // Stop any existing track before acquiring new one
      if (this.audioTrack) {
        this.audioTrack.stop();
      }

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.audioTrack = this.localStream.getAudioTracks()[0];

      if (deviceId && typeof localStorage !== 'undefined') {
        localStorage.setItem('ps_audio_device', deviceId);
      }

      this.setupAudioAnalysis();
      this.applyInputMode();

      // Keep an active voice test running on the newly selected microphone
      if (this.isVoiceTesting) {
        this.stopVoiceTest();
        this.startVoiceTest();
      }

      console.log('[AudioManager] Microphone initialized successfully. DeviceId:', deviceId || 'default');
      this.emit('ready', this.localStream);
      return this.localStream;
    } catch (err) {
      console.error('[AudioManager] Failed to access microphone:', err);
      // Fallback if specific device failed (e.g. unplugged)
      if (deviceId) {
        console.warn('[AudioManager] Falling back to default audio device');
        if (typeof localStorage !== 'undefined') localStorage.removeItem('ps_audio_device');
        return this.init(null);
      }
      this.emit('error', err);
      throw err;
    }
  }

  async setAudioProcessing(settings) {
    if (!settings) return;
    if (typeof settings.noiseSuppression === 'boolean') this.audioProcessing.noiseSuppression = settings.noiseSuppression;
    if (typeof settings.echoCancellation === 'boolean') this.audioProcessing.echoCancellation = settings.echoCancellation;
    if (typeof settings.autoGainControl === 'boolean') this.audioProcessing.autoGainControl = settings.autoGainControl;

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ps_audio_processing', JSON.stringify(this.audioProcessing));
    }

    if (this.audioTrack && this.audioTrack.applyConstraints) {
      try {
        await this.audioTrack.applyConstraints({
          noiseSuppression: this.audioProcessing.noiseSuppression,
          echoCancellation: this.audioProcessing.echoCancellation,
          autoGainControl: this.audioProcessing.autoGainControl
        });
        console.log('[AudioManager] Updated audio processing constraints:', this.audioProcessing);
      } catch (err) {
        console.warn('[AudioManager] Failed to apply live track constraints:', err);
      }
    }
  }

  setupAudioAnalysis() {
    try {
      if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      if (this.audioContext) {
        try { this.audioContext.close(); } catch (_) {}
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.4;

      this.microphoneSource = this.audioContext.createMediaStreamSource(this.localStream);
      this.microphoneSource.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!this.analyser || !this.audioTrack) return;

        // If track is disabled or muted, volume is 0
        if (!this.audioTrack.enabled || this.isMuted || (this.inputMode === 'ptt' && !this.isPttActive)) {
          if (this.isSpeaking) {
            this.setSpeaking(false);
          }
          this.volume = 0;
          this.emit('volume', 0);
          this.animationFrame = requestAnimationFrame(checkVolume);
          return;
        }

        this.analyser.getByteTimeDomainData(dataArray);

        // Compute RMS
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / bufferLength);
        this.volume = Math.min(Math.round(rms * 100 * 2), 100);
        this.emit('volume', this.volume);

        if (this.inputMode === 'vad') {
          if (rms > this.vadThreshold) {
            clearTimeout(this.speakingDebounceTimeout);
            this.setSpeaking(true);
            this.speakingDebounceTimeout = setTimeout(() => {
              this.setSpeaking(false);
            }, 350);
          }
        }

        this.animationFrame = requestAnimationFrame(checkVolume);
      };

      this.animationFrame = requestAnimationFrame(checkVolume);
    } catch (err) {
      console.warn('[AudioManager] AudioContext analysis not available:', err);
    }
  }

  setSpeaking(speaking) {
    if (this.isSpeaking !== speaking) {
      this.isSpeaking = speaking;
      this.emit('speaking-change', speaking);
    }
  }

  applyInputMode() {
    if (!this.audioTrack) return;

    if (this.isMuted) {
      this.audioTrack.enabled = false;
      this.setSpeaking(false);
      return;
    }

    if (this.inputMode === 'ptt') {
      this.audioTrack.enabled = this.isPttActive;
      this.setSpeaking(this.isPttActive);
    } else {
      this.audioTrack.enabled = true;
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.applyInputMode();
    this.emit('mute-change', this.isMuted);
    return this.isMuted;
  }

  setMute(muted) {
    this.isMuted = !!muted;
    this.applyInputMode();
    this.emit('mute-change', this.isMuted);
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    // When deafened, user must also be muted
    if (this.isDeafened) {
      this.setMute(true);
    }
    this.emit('deafen-change', this.isDeafened);
    return this.isDeafened;
  }

  setDeafen(deafened) {
    this.isDeafened = !!deafened;
    if (this.isDeafened) {
      this.setMute(true);
    }
    this.emit('deafen-change', this.isDeafened);
  }

  setInputMode(mode) {
    if (mode === 'vad' || mode === 'ptt') {
      this.inputMode = mode;
      this.applyInputMode();
      this.emit('mode-change', mode);
    }
  }

  pttKeyDown() {
    if (this.inputMode === 'ptt' && !this.isPttActive) {
      this.isPttActive = true;
      this.applyInputMode();
      this.emit('ptt-state', true);
    }
  }

  pttKeyUp() {
    if (this.inputMode === 'ptt' && this.isPttActive) {
      this.isPttActive = false;
      this.applyInputMode();
      this.emit('ptt-state', false);
    }
  }

  /**
   * Voice test: hear your own microphone (with the current noise suppression / echo
   * cancellation / gain settings). Uses a clone of the mic track so it works even while
   * muted or in PTT mode, without changing what peers receive.
   */
  startVoiceTest() {
    if (this.isVoiceTesting) return true;
    if (!this.audioTrack || this.audioTrack.readyState === 'ended') {
      console.warn('[AudioManager] Voice test unavailable: microphone not initialized');
      return false;
    }
    try {
      this.voiceTestTrack = this.audioTrack.clone();
      this.voiceTestTrack.enabled = true;
      const el = new Audio();
      el.autoplay = true;
      el.srcObject = new MediaStream([this.voiceTestTrack]);
      const playing = el.play();
      if (playing && playing.catch) {
        playing.catch(e => console.warn('[AudioManager] Voice test play note:', e));
      }
      this.voiceTestElement = el;
      this.isVoiceTesting = true;
      this.emit('voice-test-change', true);
      return true;
    } catch (err) {
      console.warn('[AudioManager] Failed to start voice test:', err);
      this.stopVoiceTest();
      return false;
    }
  }

  stopVoiceTest() {
    const wasTesting = this.isVoiceTesting;
    if (this.voiceTestElement) {
      try { this.voiceTestElement.pause(); } catch (_) {}
      this.voiceTestElement.srcObject = null;
      this.voiceTestElement = null;
    }
    if (this.voiceTestTrack) {
      this.voiceTestTrack.stop();
      this.voiceTestTrack = null;
    }
    this.isVoiceTesting = false;
    if (wasTesting) this.emit('voice-test-change', false);
  }

  toggleVoiceTest() {
    if (this.isVoiceTesting) {
      this.stopVoiceTest();
    } else {
      this.startVoiceTest();
    }
    return this.isVoiceTesting;
  }

  async getDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        inputs: devices.filter(d => d.kind === 'audioinput'),
        outputs: devices.filter(d => d.kind === 'audiooutput')
      };
    } catch (err) {
      console.warn('[AudioManager] Failed to list devices:', err);
      return { inputs: [], outputs: [] };
    }
  }

  destroy() {
    this.stopVoiceTest();
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (this.speakingDebounceTimeout) clearTimeout(this.speakingDebounceTimeout);
    if (this.audioTrack) {
      this.audioTrack.stop();
      this.audioTrack = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioManager;
}
