/**
 * AudioManager: Controls local audio capture, VAD (Voice Activity Detection),
 * Mute, Deafen, Push-To-Talk modes and audio processing (RNNoise AI noise suppression,
 * echo cancellation, automatic gain control).
 */
class AudioManager {
  constructor() {
    this.localStream = null; // processed stream sent to peers
    this.audioTrack = null; // processed track sent to peers
    this.rawStream = null; // microphone as captured
    this.rawTrack = null;
    this.rnnoiseNode = null;
    this.processedDestination = null;
    this.noiseSuppressionMode = 'off'; // 'rnnoise' | 'browser' | 'off'
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

  /**
   * Opens the microphone and builds the processing chain:
   *   mic (browser echo cancellation / gain control) -> RNNoise (AI noise suppression)
   *   -> processed track sent to peers.
   * Browser audio-processing flags cannot be changed on a live track in Chromium
   * (applyConstraints resolves but does nothing), so every settings change re-runs init().
   */
  async init(deviceId = null) {
    try {
      if (!deviceId && typeof localStorage !== 'undefined') {
        deviceId = localStorage.getItem('ps_audio_device') || null;
      }
      this.selectedDeviceId = deviceId;

      const wantsRnnoise = !!this.audioProcessing.noiseSuppression && AudioManager.isRnnoiseSupported();
      const constraints = {
        audio: {
          echoCancellation: !!this.audioProcessing.echoCancellation,
          // Browser suppressor first, then RNNoise. Measured on this pipeline: the chain removes
          // ~57 dB of fan noise (browser alone ~18 dB, RNNoise alone ~40 dB) and handles loud hiss
          // that RNNoise alone barely touches, while speech level drops by only ~1 dB.
          noiseSuppression: !!this.audioProcessing.noiseSuppression && (!wantsRnnoise || AudioManager.CHAIN_BROWSER_NS),
          autoGainControl: !!this.audioProcessing.autoGainControl,
          channelCount: 1, // mono for voice optimization
          sampleRate: 48000
        },
        video: false
      };

      if (deviceId) {
        constraints.audio.deviceId = { exact: deviceId };
      }

      // Release the previous microphone and processing graph before acquiring a new one
      this.teardownPipeline();

      this.rawStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.rawTrack = this.rawStream.getAudioTracks()[0];

      if (deviceId && typeof localStorage !== 'undefined') {
        localStorage.setItem('ps_audio_device', deviceId);
      }

      await this.buildPipeline(wantsRnnoise);
      this.applyInputMode();

      // Keep an active voice test running on the new microphone / settings
      if (this.isVoiceTesting) {
        this.stopVoiceTest();
        this.startVoiceTest();
      }

      console.log(`[AudioManager] Microphone ready. Device: ${deviceId || 'default'}, noise suppression: ${this.noiseSuppressionMode}`);
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

  async buildPipeline(wantsRnnoise) {
    const AudioCtx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) {
      this.localStream = this.rawStream;
      this.audioTrack = this.rawTrack;
      this.noiseSuppressionMode = this.audioProcessing.noiseSuppression ? 'browser' : 'off';
      return;
    }

    this.audioContext = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
    this.resumeAudioContext();
    this.microphoneSource = this.audioContext.createMediaStreamSource(this.rawStream);

    let output = this.microphoneSource;
    this.noiseSuppressionMode = this.audioProcessing.noiseSuppression ? 'browser' : 'off';

    if (wantsRnnoise) {
      try {
        this.rnnoiseNode = await AudioManager.createRnnoiseNode(this.audioContext);
        this.microphoneSource.connect(this.rnnoiseNode);
        output = this.rnnoiseNode;
        this.noiseSuppressionMode = 'rnnoise';
      } catch (err) {
        console.warn('[AudioManager] RNNoise unavailable, falling back to browser noise suppression:', err);
        AudioManager.rnnoiseBroken = true;
        if (AudioManager.CHAIN_BROWSER_NS) {
          // Mic already has browser NS on: rebuild the graph without RNNoise
          try { this.audioContext.close(); } catch (_) {}
          this.audioContext = null;
          return this.buildPipeline(false);
        }
        // The mic was opened with browser NS off; reopen it with NS on
        this.teardownPipeline();
        const fallback = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: !!this.audioProcessing.echoCancellation,
            noiseSuppression: true,
            autoGainControl: !!this.audioProcessing.autoGainControl,
            channelCount: 1,
            sampleRate: 48000,
            ...(this.selectedDeviceId ? { deviceId: { exact: this.selectedDeviceId } } : {})
          },
          video: false
        });
        this.rawStream = fallback;
        this.rawTrack = fallback.getAudioTracks()[0];
        return this.buildPipeline(false);
      }
    }

    this.processedDestination = this.audioContext.createMediaStreamDestination();
    output.connect(this.processedDestination);
    this.localStream = this.processedDestination.stream;
    this.audioTrack = this.localStream.getAudioTracks()[0];

    // VAD meter reads the processed signal (noise no longer triggers "speaking")
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.4;
    output.connect(this.analyser);
    this.setupAudioAnalysis();
  }

  teardownPipeline() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    if (this.rnnoiseNode) {
      try { this.rnnoiseNode.port.postMessage('destroy'); } catch (_) {}
      try { this.rnnoiseNode.disconnect(); } catch (_) {}
      this.rnnoiseNode = null;
    }
    if (this.audioTrack && this.audioTrack !== this.rawTrack) {
      this.audioTrack.stop();
    }
    if (this.rawTrack) {
      this.rawTrack.stop();
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch (_) {}
    }
    this.rawStream = null;
    this.rawTrack = null;
    this.audioContext = null;
    this.microphoneSource = null;
    this.processedDestination = null;
    this.analyser = null;
  }

  resumeAudioContext() {
    const ctx = this.audioContext;
    if (!ctx || ctx.state === 'running') return;
    ctx.resume().catch(() => {});
    // If the browser still requires a user gesture, resume on the first interaction
    if (typeof document !== 'undefined' && !this._resumeOnGesture) {
      this._resumeOnGesture = () => {
        if (this.audioContext && this.audioContext.state !== 'running') {
          this.audioContext.resume().catch(() => {});
        }
      };
      document.addEventListener('pointerdown', this._resumeOnGesture, true);
      document.addEventListener('keydown', this._resumeOnGesture, true);
    }
  }

  static isRnnoiseSupported() {
    return !AudioManager.rnnoiseBroken &&
      typeof window !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined' &&
      typeof WebAssembly !== 'undefined' &&
      typeof self !== 'undefined' && typeof self.RNNOISE_WASM_B64 === 'string';
  }

  static getRnnoiseWasm() {
    if (!AudioManager._rnnoiseWasm) {
      const bin = atob(self.RNNOISE_WASM_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      AudioManager._rnnoiseWasm = bytes.buffer;
    }
    return AudioManager._rnnoiseWasm;
  }

  static async createRnnoiseNode(ctx) {
    if (ctx.sampleRate !== 48000) {
      throw new Error(`RNNoise needs 48 kHz, context runs at ${ctx.sampleRate} Hz`);
    }
    const workletUrl = new URL('vendor/rnnoise/rnnoiseWorklet.js', document.baseURI).href;
    await ctx.audioWorklet.addModule(workletUrl);
    return new AudioWorkletNode(ctx, AudioManager.RNNOISE_PROCESSOR_ID, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { maxChannels: 1, wasmBinary: AudioManager.getRnnoiseWasm() }
    });
  }

  async setAudioProcessing(settings) {
    if (!settings) return;
    if (typeof settings.noiseSuppression === 'boolean') this.audioProcessing.noiseSuppression = settings.noiseSuppression;
    if (typeof settings.echoCancellation === 'boolean') this.audioProcessing.echoCancellation = settings.echoCancellation;
    if (typeof settings.autoGainControl === 'boolean') this.audioProcessing.autoGainControl = settings.autoGainControl;

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ps_audio_processing', JSON.stringify(this.audioProcessing));
    }

    // Re-open the mic with the new settings; PeerManager swaps the new track into every call
    if (this.rawTrack) {
      try {
        await this.init(this.selectedDeviceId);
        console.log('[AudioManager] Applied audio processing settings:', this.audioProcessing);
      } catch (err) {
        console.warn('[AudioManager] Failed to apply audio processing settings:', err);
      }
    }
  }

  setupAudioAnalysis() {
    try {
      if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      if (!this.analyser) return;

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
    if (this.speakingDebounceTimeout) clearTimeout(this.speakingDebounceTimeout);
    this.teardownPipeline();
    this.audioTrack = null;
    this.localStream = null;
  }
}

AudioManager.RNNOISE_PROCESSOR_ID = '@sapphi-red/web-noise-suppressor/rnnoise';
AudioManager.rnnoiseBroken = false;
AudioManager.CHAIN_BROWSER_NS = true;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioManager;
}
