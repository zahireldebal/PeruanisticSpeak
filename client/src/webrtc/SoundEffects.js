/**
 * SoundEffects: Synthesizes gamer audio chimes using Web Audio API.
 * Zero external MP3 files required, low overhead, non-intrusive volume.
 * Features TeamSpeak 3-style connection tones and notification cues.
 */
class SoundEffects {
  constructor() {
    this.ctx = null;
    this.isEnabled = true;
  }

  getAudioContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * TS3-style "Connected" ascending arpeggio (C5 -> E5 -> G5)
   */
  playJoin() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + (idx * 0.08);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.12, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.16);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.16);
      });
    } catch (err) {
      console.warn('[SoundEffects] Join sound error:', err);
    }
  }

  /**
   * TS3-style "Disconnected" descending arpeggio (G5 -> E5 -> C5)
   */
  playLeave() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const notes = [783.99, 659.25, 523.25]; // G5, E5, C5
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + (idx * 0.08);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.12, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.16);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.16);
      });
    } catch (err) {
      console.warn('[SoundEffects] Leave sound error:', err);
    }
  }

  /**
   * Screen share started chime (electronic ascending beam)
   */
  playScreenShareStart() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.22);
    } catch (err) {
      console.warn('[SoundEffects] Screen share sound error:', err);
    }
  }

  /**
   * Chat message incoming notification (soft subtle ping)
   */
  playChatMessage() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // A5

      gain.gain.setValueAtTime(0.10, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch (err) {
      console.warn('[SoundEffects] Chat sound error:', err);
    }
  }

  /**
   * Someone started watching your screen transmission
   */
  playViewerJoined() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, now); // C6 water-drop

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.10);
    } catch (err) {
      console.warn('[SoundEffects] Viewer joined sound error:', err);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SoundEffects;
}
