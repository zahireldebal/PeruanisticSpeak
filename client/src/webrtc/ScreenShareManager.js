/**
 * ScreenShareManager: Handles screen and window capturing at 720p/1080p @ 30fps,
 * with optional system audio transmission for gameplay, movies, and streams.
 */
class ScreenShareManager {
  constructor() {
    this.screenStream = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.isSharing = false;
    this.currentPreset = '720p'; // '720p' or '1080p'
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

  setCaptureAudio(enable) {
    this.captureAudio = !!enable;
  }

  getConstraints(preset = '720p', captureAudio = false) {
    this.currentPreset = preset;
    this.captureAudio = captureAudio;
    const is1080p = preset === '1080p';

    return {
      audio: captureAudio ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      } : false,
      video: {
        width: { ideal: is1080p ? 1920 : 1280, max: is1080p ? 1920 : 1280 },
        height: { ideal: is1080p ? 1080 : 720, max: is1080p ? 1080 : 720 },
        frameRate: { ideal: 30, max: 30 },
        cursor: 'always'
      }
    };
  }

  async start(preset = '720p', sourceId = null, captureAudio = false) {
    if (this.isSharing) {
      await this.stop();
    }

    this.currentPreset = preset;
    this.captureAudio = captureAudio;

    try {
      const constraints = this.getConstraints(preset, captureAudio);

      // In Electron environment:
      if (window.electronAPI && window.electronAPI.isElectron) {
        let chosenId = sourceId;
        if (!chosenId && window.electronAPI.getScreenSources) {
          const sources = await window.electronAPI.getScreenSources();
          if (sources && sources.length > 0) {
            chosenId = sources[0].id;
          }
        }

        if (chosenId) {
          const electronConstraints = {
            audio: captureAudio ? {
              mandatory: {
                chromeMediaSource: 'desktop'
              }
            } : false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: chosenId,
                minWidth: constraints.video.width.ideal,
                maxWidth: constraints.video.width.max,
                minHeight: constraints.video.height.ideal,
                maxHeight: constraints.video.height.max,
                minFrameRate: 30,
                maxFrameRate: 30
              }
            }
          };

          try {
            this.screenStream = await navigator.mediaDevices.getUserMedia(electronConstraints);
          } catch (electronMediaErr) {
            // If audio capture failed in Electron, retry without audio
            if (captureAudio) {
              console.warn('[ScreenShareManager] Electron audio capture failed, retrying video only:', electronMediaErr);
              electronConstraints.audio = false;
              this.screenStream = await navigator.mediaDevices.getUserMedia(electronConstraints);
            } else {
              throw electronMediaErr;
            }
          }
        } else {
          this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
        }
      } else {
        // Standard WebRTC DisplayMedia for browser
        this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
      }

      this.videoTrack = this.screenStream.getVideoTracks()[0];
      const audioTracks = this.screenStream.getAudioTracks();
      this.audioTrack = audioTracks.length > 0 ? audioTracks[0] : null;

      this.isSharing = true;

      // Listen for OS native "Stop sharing" event
      this.videoTrack.onended = () => {
        console.log('[ScreenShareManager] Stream ended by user.');
        this.handleEnded();
      };

      console.log(`[ScreenShareManager] Screen sharing active (${preset} @ 30fps, audio: ${!!this.audioTrack}).`);
      this.emit('started', this.screenStream, this.videoTrack, this.audioTrack);
      return this.screenStream;
    } catch (err) {
      console.warn('[ScreenShareManager] Screen share request cancelled or failed:', err);
      this.isSharing = false;
      this.emit('error', err);
      throw err;
    }
  }

  handleEnded() {
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

  toggle(preset = '720p', sourceId = null, captureAudio = false) {
    if (this.isSharing) {
      return this.stop();
    } else {
      return this.start(preset, sourceId, captureAudio);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScreenShareManager;
}
