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
    // Fire-and-forget resume for synchronous callers (existing behaviour).
    // _ensureCtxAsync() below awaits it properly before scheduling audio.
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  /**
   * Async variant: ensures the context exists AND waits for any in-progress
   * resume() to complete.  Use before scheduling time-sensitive audio (e.g.
   * enqueue) so the first sentence doesn't stutter after the tab regains focus.
   */
  async _ensureCtxAsync() {
    const ctx = this._ensureCtx();
    if (ctx.state === "suspended") {
      // May still be suspended if _ensureCtx's fire-and-forget hasn't resolved.
      await ctx.resume().catch(() => {});
    }
    return ctx;
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
  // Returns a Promise so callers can await before scheduling the next chunk,
  // though in practice callers don't need to — the scheduling is self-chaining
  // via nextStartTime.  The async resume ensures no first-sentence stutter when
  // the tab regains focus from a suspended state.
  async enqueue(float32, sampleRate) {
    const ctx = await this._ensureCtxAsync();
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
