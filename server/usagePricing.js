// Usage pricing — USD rate cards + per-event cost computation.
//
// Rate cards are USD per 1,000,000 tokens (the unit Anthropic/OpenAI publish).
// Anthropic Claude Sonnet 4.6 confirmed from the official rate card:
//   input $3, output $15, cache write (5m) $3.75, cache write (1h) $6, cache read $0.30.
// OpenAI realtime/transcribe figures are best-effort list prices — VERIFY against
// your billing and adjust here if they drift; they are isolated to this file so a
// correction is a one-line edit (and re-rating is trivial since usd_cost is stored
// per event and INR is applied live at display time).
//
// INR conversion is NOT done here — usd_cost is the source of truth; the live
// USD→INR rate (usageFx.js) is applied at read/display time.

export const PRICING = {
  anthropic: {
    // per 1M tokens
    "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
    "claude-opus-4-8":   { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.50 },
    "claude-haiku-4-5":  { input: 1.0, output: 5.0,  cacheWrite: 1.25, cacheRead: 0.10 },
  },
  openai: {
    // gpt-realtime (speech-to-speech). Audio tokens dominate the bill.
    "gpt-realtime": {
      textInput: 4.0, textOutput: 16.0,
      audioInput: 32.0, audioOutput: 64.0,
      cachedInput: 0.40,
    },
    // gpt-realtime-mini (cheaper S2S tier). ~3x cheaper audio than gpt-realtime.
    // Best-effort list prices (per 1M tokens) — VERIFY against billing.
    "gpt-realtime-mini-2025-12-15": {
      textInput: 0.60, textOutput: 2.40,
      audioInput: 10.0, audioOutput: 20.0,
      cachedInput: 0.30,
    },
    // bare alias in case OPENAI_REALTIME_MODEL is set without the date suffix.
    "gpt-realtime-mini": {
      textInput: 0.60, textOutput: 2.40,
      audioInput: 10.0, audioOutput: 20.0,
      cachedInput: 0.30,
    },
    // gpt-4o-mini-transcribe (counsellor STT).
    "gpt-4o-mini-transcribe": { textInput: 1.25, textOutput: 5.0, audioInput: 3.0 },
    // whisper-1 (verbatim re-transcription for fluency) — billed per audio minute.
    "whisper-1": { perMinute: 0.006 },
  },
};

const ANTHROPIC_FALLBACK = "claude-sonnet-4-6";
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ─── Anthropic ───────────────────────────────────────────────────────────────
// usage shape: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
export function priceAnthropic(model, usage = {}) {
  const p = PRICING.anthropic[model] || PRICING.anthropic[ANTHROPIC_FALLBACK];
  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheWrite = num(usage.cache_creation_input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const usd =
    (input / 1e6) * p.input +
    (output / 1e6) * p.output +
    (cacheWrite / 1e6) * p.cacheWrite +
    (cacheRead / 1e6) * p.cacheRead;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_write_tokens: cacheWrite,
    cache_read_tokens: cacheRead,
    audio_input_tokens: 0,
    audio_output_tokens: 0,
    usd_cost: round6(usd),
  };
}

// ─── OpenAI realtime (voice S2S) ──────────────────────────────────────────────
// usage shape from the data channel's response.done:
//   { input_tokens, output_tokens,
//     input_token_details:{ text_tokens, audio_tokens, cached_tokens },
//     output_token_details:{ text_tokens, audio_tokens } }
export function priceOpenAIRealtime(model, usage = {}) {
  const p = PRICING.openai[model] || PRICING.openai["gpt-realtime"];
  const ind = usage.input_token_details || {};
  const outd = usage.output_token_details || {};
  const inText = num(ind.text_tokens);
  const inAudio = num(ind.audio_tokens);
  const cached = num(ind.cached_tokens);
  const outText = num(outd.text_tokens);
  const outAudio = num(outd.audio_tokens);
  const usd =
    (inText / 1e6) * p.textInput +
    (inAudio / 1e6) * p.audioInput +
    (cached / 1e6) * (p.cachedInput ?? p.textInput) +
    (outText / 1e6) * p.textOutput +
    (outAudio / 1e6) * p.audioOutput;
  return {
    input_tokens: inText,
    output_tokens: outText,
    cache_write_tokens: 0,
    cache_read_tokens: cached,
    audio_input_tokens: inAudio,
    audio_output_tokens: outAudio,
    usd_cost: round6(usd),
  };
}

// ─── OpenAI transcription (STT) ───────────────────────────────────────────────
// usage shape: { input_tokens, output_tokens, input_token_details:{ audio_tokens, text_tokens } } | { type:"tokens" }
export function priceOpenAITranscribe(model, usage = {}) {
  const p = PRICING.openai[model] || PRICING.openai["gpt-4o-mini-transcribe"];
  const ind = usage.input_token_details || {};
  const inAudio = num(ind.audio_tokens ?? usage.input_tokens);
  const inText = num(ind.text_tokens);
  const outText = num(usage.output_tokens);
  const usd =
    (inAudio / 1e6) * p.audioInput +
    (inText / 1e6) * p.textInput +
    (outText / 1e6) * p.textOutput;
  return {
    input_tokens: inText,
    output_tokens: outText,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    audio_input_tokens: inAudio,
    audio_output_tokens: 0,
    usd_cost: round6(usd),
  };
}

// ─── OpenAI Whisper (per-minute transcription) ────────────────────────────────
// usage shape: { durationSeconds }. Stores the audio seconds in audio_input_tokens
// (the schema has no seconds column) so the figure isn't lost; usd_cost is exact.
export function priceOpenAIWhisper(model, usage = {}) {
  const p = PRICING.openai[model] || PRICING.openai["whisper-1"];
  const seconds = num(usage.durationSeconds);
  const usd = (seconds / 60) * p.perMinute;
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    audio_input_tokens: Math.round(seconds),
    audio_output_tokens: 0,
    usd_cost: round6(usd),
  };
}

// ─── Unified dispatcher ───────────────────────────────────────────────────────
// raw: { provider, model, feature?, mode?, usage }
// Returns a flat event-ready object (token columns + usd_cost), no PII.
export function priceUsage(raw = {}) {
  const provider = raw.provider || "anthropic";
  const model = raw.model || ANTHROPIC_FALLBACK;
  let cost;
  if (provider === "openai") {
    if (model === "whisper-1") {
      cost = priceOpenAIWhisper(model, raw.usage);
    } else if (raw.feature === "transcription") {
      cost = priceOpenAITranscribe(model, raw.usage);
    } else {
      cost = priceOpenAIRealtime(model, raw.usage);
    }
  } else {
    cost = priceAnthropic(model, raw.usage);
  }
  return { provider, model, ...cost };
}
