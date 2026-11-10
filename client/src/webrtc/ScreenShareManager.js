/**
 * ScreenShareManager: Handles screen and window capturing at 720p/1080p @ 30fps,
 * optimized for gaming performance with controlled bitrates.
 */
class ScreenShareManager {
  constructor() {
    this.screenStream = null;
    this.videoTrack = null;
    this.isSharing = false;
    this.currentPreset = '720p'; // '720p' or '1080p'
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

  getConstraints(preset = '720p') {
    this.currentPreset = preset;
    const is1080p = preset === '1080p';

    return {
      audio: false, // Voice audio is handled separately by AudioManager
      video: {
        width: { ideal: is1080p ? 1920 : 1280, max: is1080p ? 1920 : 1280 },
        height: { ideal: is1080p ? 1080 : 720, max: is1080p ? 1080 : 720 },
        frameRate: { ideal: 30, max: 30 },
        // Optimize for motion and frame stability in games
        cursor: 'always'
      }
    };
  }

  async start(preset = '720p', sourceId = null) {
    if (this.isSharing) {
      await this.stop();
    }

    try {
      const constraints = this.getConstraints(preset);

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
            audio: false,
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
          this.screenStream = await navigator.mediaDevices.getUserMedia(electronConstraints);
        } else {
          this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
        }
      } else {
        // Standard WebRTC DisplayMedia for browser
        this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
      }

      this.videoTrack = this.screenStream.getVideoTracks()[0];
      this.isSharing = true;

      // Listen for OS native "Stop sharing" event
      this.videoTrack.onended = () => {
        console.log('[ScreenShareManager] Stream ended by user.');
        this.handleEnded();
      };

      console.log(`[ScreenShareManager] Screen sharing active (${preset} @ 30fps).`);
      this.emit('started', this.screenStream, this.videoTrack);
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
    this.emit('stopped');
  }

  async stop() {
    if (!this.isSharing) return;

    if (this.videoTrack) {
      this.videoTrack.stop();
      this.videoTrack = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }

    this.isSharing = false;
    this.emit('stopped');
    console.log('[ScreenShareManager] Screen sharing stopped.');
  }

  toggle(preset = '720p', sourceId = null) {
    if (this.isSharing) {
      return this.stop();
    } else {
      return this.start(preset, sourceId);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScreenShareManager;
}

