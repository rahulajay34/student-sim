// Usage event buffering + flush for the edge functions.
//
// The llm.js usage sink and the OpenAI voice/transcription recorders push priced
// rows into an in-process buffer; the host flushes (a single batched insert,
// awaited) before returning its Response so the edge runtime doesn't kill the
// write. flushUsage() drains the buffer, so concurrent requests in one isolate
// never double-write the same row.

import { priceUsage } from "./lib/usagePricing.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

const _buffer = [];

// raw: { provider, model, mode?, feature?, sessionId?, counsellorId?, personaLabel?, usage }
function toRow(raw) {
  const priced = priceUsage({ provider: raw.provider, model: raw.model, feature: raw.feature, usage: raw.usage });
  return {
    session_id: raw.sessionId || null,
    owner_id: raw.counsellorId || null,
    provider: priced.provider,
    model: priced.model,
    feature: raw.feature || null,
    mode: raw.mode || null,
    input_tokens: priced.input_tokens,
    output_tokens: priced.output_tokens,
    cache_write_tokens: priced.cache_write_tokens,
    cache_read_tokens: priced.cache_read_tokens,
    audio_input_tokens: priced.audio_input_tokens,
    audio_output_tokens: priced.audio_output_tokens,
    usd_cost: priced.usd_cost,
    meta: raw.personaLabel ? { personaLabel: raw.personaLabel } : {},
  };
}

// Adapter for the llm.js sink: ev = { provider, model, mode, usage, meta }.
export function bufferLlmUsage(ev) {
  try {
    _buffer.push(toRow({
      provider: ev.provider, model: ev.model, mode: ev.mode, usage: ev.usage,
      feature: ev.meta?.feature, sessionId: ev.meta?.sessionId,
      counsellorId: ev.meta?.counsellorId, personaLabel: ev.meta?.personaLabel,
    }));
  } catch (err) {
    console.warn("[usage] buffer (llm) threw:", err && err.message);
  }
}

// Direct recorder for OpenAI voice / transcription usage (from /observe).
export function bufferUsage(raw) {
  try {
    _buffer.push(toRow(raw));
  } catch (err) {
    console.warn("[usage] buffer threw:", err && err.message);
  }
}

export async function flushUsage() {
  if (_buffer.length === 0) return;
  const rows = _buffer.splice(0, _buffer.length);
  try {
    const { error } = await getSupabaseAdmin().from("usage_events").insert(rows);
    if (error) console.warn("[usage] flush insert failed:", error.message);
  } catch (err) {
    console.warn("[usage] flush threw:", err && err.message);
  }
}
