// Usage event recording for the legacy Express server (JSON store).
// The process is long-lived, so we insert synchronously (fire-and-forget is safe)
// into the "usage" collection. Cost is computed from the shared rate cards.

import { priceUsage } from "./usagePricing.js";
import * as store from "./store.js";

// raw: { provider, model, mode?, feature?, sessionId?, counsellorId?, personaLabel?, usage }
function toRecord(raw) {
  const priced = priceUsage({ provider: raw.provider, model: raw.model, feature: raw.feature, usage: raw.usage });
  return {
    createdAt: new Date().toISOString(),
    sessionId: raw.sessionId || null,
    ownerId: raw.counsellorId || null,
    provider: priced.provider,
    model: priced.model,
    feature: raw.feature || null,
    mode: raw.mode || null,
    inputTokens: priced.input_tokens,
    outputTokens: priced.output_tokens,
    cacheWriteTokens: priced.cache_write_tokens,
    cacheReadTokens: priced.cache_read_tokens,
    audioInputTokens: priced.audio_input_tokens,
    audioOutputTokens: priced.audio_output_tokens,
    usdCost: priced.usd_cost,
    personaLabel: raw.personaLabel || null,
  };
}

// llm.js sink adapter.
export function recordLlmUsage(ev) {
  try {
    store.insert("usage", toRecord({
      provider: ev.provider, model: ev.model, mode: ev.mode, usage: ev.usage,
      feature: ev.meta?.feature, sessionId: ev.meta?.sessionId,
      counsellorId: ev.meta?.counsellorId, personaLabel: ev.meta?.personaLabel,
    }));
  } catch (err) {
    console.warn("[usage] record (llm) failed:", err && err.message);
  }
}

// Direct recorder for OpenAI voice / transcription usage.
export function recordUsage(raw) {
  try {
    store.insert("usage", toRecord(raw));
  } catch (err) {
    console.warn("[usage] record failed:", err && err.message);
  }
}
