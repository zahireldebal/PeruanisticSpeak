/**
 * ScreenShareManager: Handles screen and window capturing at 720p/1080p @ 30/60fps,
 * with optional system audio transmission for gameplay, movies, and streams.
 */
class ScreenShareManager {
  constructor() {
    this.screenStream = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.isSharing = false;
    this.isStarting = false;
    this.currentPreset = '720p'; // '720p' or '1080p'
    this.currentFps = 30; // 30 or 60
    this.captureAudio = false;
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
          console.error(`[ScreenShareManager] Listener error on ${event}:`, err);
        }
      }
    }
  }

  setPreset(preset) {
    if (preset === '720p' || preset === '1080p') {
      this.currentPreset = preset;
    }
  }

  setFps(fps) {
    this.currentFps = ScreenShareManager.normalizeFps(fps);
  }

  setCaptureAudio(enable) {
    this.captureAudio = !!enable;
  }

  static normalizeFps(fps) {
    return Number(fps) === 60 ? 60 : 30;
  }

  /**
   * Sender encoding limits per preset/fps (used by PeerManager on every video sender).
   */
  static getEncodingParams(preset = '720p', fps = 30) {
    const is60 = ScreenShareManager.normalizeFps(fps) === 60;
    const is1080p = preset === '1080p';
    let maxBitrate = 3500000; // 30fps (720p/1080p): 3.5 Mbps
    if (is60) maxBitrate = is1080p ? 6000000 : 4500000;
    return { maxBitrate, maxFramerate: is60 ? 60 : 30 };
  }

  /**
   * getConstraints(preset, fps, captureAudio)
   * Backwards compatible with the old getConstraints(preset, captureAudio) signature.
   */
  getConstraints(preset = '720p', fps = 30, captureAudio = false) {
    if (typeof fps === 'boolean') {
      captureAudio = fps;
      fps = 30;
    }
    fps = ScreenShareManager.normalizeFps(fps);
    this.currentPreset = preset;
    this.currentFps = fps;
    this.captureAudio = captureAudio;
    const is1080p = preset === '1080p';

    return {
      audio: captureAudio ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Ask the browser to leave our own playback (voices, chimes) out of the capture
        restrictOwnAudio: true
      } : false,
      video: {
        width: { ideal: is1080p ? 1920 : 1280, max: is1080p ? 1920 : 1280 },
        height: { ideal: is1080p ? 1080 : 720, max: is1080p ? 1080 : 720 },
        frameRate: { ideal: fps, max: fps },
        cursor: 'always'
      }
    };
  }

  async start(preset = '720p', fps = 30, sourceId = null, captureAudio = false) {
    if (this.isStarting) return;
    this.isStarting = true;
    if (this.isSharing) {
      await this.stop();
    }

    fps = ScreenShareManager.normalizeFps(fps);
    this.currentPreset = preset;
    this.currentFps = fps;
    this.captureAudio = captureAudio;

    try {
      const constraints = this.getConstraints(preset, fps, captureAudio);
      const api = (typeof window !== 'undefined') ? window.electronAPI : null;

      if (api && api.isElectron && api.setScreenSource) {
        // Electron: main process serves the picked source to getDisplayMedia, with system
        // audio captured as 'loopbackWithoutChrome' (excludes PeruanisticSPEAK's own output,
        // so peers never hear their own voice / our chimes echoed back).
        await api.setScreenSource(sourceId, 'loopbackWithoutChrome');
        try {
          this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
        } catch (err) {
          if (!captureAudio) throw err;
          console.warn('[ScreenShareManager] Capture with audio failed, retrying video only:', err);
          await api.setScreenSource(sourceId, 'loopbackWithoutChrome');
          this.screenStream = await navigator.mediaDevices.getDisplayMedia({ ...constraints, audio: false });
        }
      } else {
        // Standard WebRTC DisplayMedia for browser
        this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
      }

      this.videoTrack = this.screenStream.getVideoTracks()[0];
      const audioTracks = this.screenStream.getAudioTracks();
      this.audioTrack = audioTracks.length > 0 ? audioTracks[0] : null;

      // 60fps is for fast motion (games): prefer keeping framerate over resolution
      if (this.videoTrack && 'contentHint' in this.videoTrack) {
        this.videoTrack.contentHint = fps === 60 ? 'motion' : '';
      }

      this.isSharing = true;

      // Listen for OS native "Stop sharing" event
      this.videoTrack.onended = () => {
        console.log('[ScreenShareManager] Stream ended by user.');
        this.handleEnded();
      };

      console.log(`[ScreenShareManager] Screen sharing active (${preset} @ ${fps}fps, audio: ${!!this.audioTrack}).`);
      this.emit('started', this.screenStream, this.videoTrack, this.audioTrack);
      this.isStarting = false;
      return this.screenStream;
    } catch (err) {
      console.warn('[ScreenShareManager] Screen share request cancelled or failed:', err);
      this.isSharing = false;
      this.isStarting = false;
      this.emit('error', err);
      throw err;
    }
  }

  handleEnded() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
    }
    this.isSharing = false;
    this.screenStream = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.emit('stopped');
  }

  async stop() {
    if (!this.isSharing) return;

    if (this.videoTrack) {
      this.videoTrack.stop();
      this.videoTrack = null;
    }
    if (this.audioTrack) {
      this.audioTrack.stop();
      this.audioTrack = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }

    this.isSharing = false;
    this.emit('stopped');
    console.log('[ScreenShareManager] Screen sharing stopped.');
  }

  toggle(preset = '720p', fps = 30, sourceId = null, captureAudio = false) {
    if (this.isSharing) {
      return this.stop();
    } else {
      return this.start(preset, fps, sourceId, captureAudio);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScreenShareManager;
}
