// Gapless streaming playback of Float32 audio chunks, with an instant stop()
// for barge-in. Kokoro emits one chunk per sentence; we schedule each chunk
// back-to-back on a single AudioContext so playback starts as soon as the
// first sentence is synthesized.
export class StreamingAudioPlayer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.sources = new Set();
    this.nextStartTime = 0;
    this.pending = 0;
    // Bumped on every stop(). The TTS loop captures the epoch when it starts
    // and stops feeding the moment the epoch changes (barge-in / new reply).
    this.epoch = 0;
    // Called once the queue drains naturally (i.e. speech finished on its own,
    // not because it was interrupted).
    this.onended = null;
  }

  _ensureCtx() {
    if (!this.ctx || this.ctx.state === "closed") {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // Create the analyser once per AudioContext; all sources route through it.
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  // Returns the AnalyserNode for level-metering, or null before the context
  // has been initialised (i.e. before the first enqueue/speak call).
  getAnalyser() {
    return this.analyser;
  }

  get playing() {
    return this.pending > 0;
  }

  // float32: mono samples in [-1, 1]; sampleRate e.g. 24000 (Kokoro output).
  enqueue(float32, sampleRate) {
    const ctx = this._ensureCtx();
    const buffer = ctx.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);

    const startAt = Math.max(ctx.currentTime, this.nextStartTime);
    src.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.pending++;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      this.pending--;
      if (this.pending === 0) this.onended?.();
    };
  }

  // Immediately halt all playback and invalidate the current epoch.
  stop() {
    this.epoch++;
    for (const src of this.sources) {
      try {
        src.onended = null; // prevent the drain callback from firing
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.pending = 0;
    this.nextStartTime = 0;
  }
}
