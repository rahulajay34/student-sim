// node --test server/tests/usage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { priceUsage, priceAnthropic, priceOpenAIRealtime } from "../usagePricing.js";
import { isStale, resolveUsdInrRate, FX_FALLBACK } from "../usageFx.js";

test("anthropic cost = input*3 + output*15 + cacheRead*0.30 per 1M (sonnet-4-6)", () => {
  const c = priceAnthropic("claude-sonnet-4-6", {
    input_tokens: 1_000_000, output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
  });
  // 3 + 15 + 0.30 + 3.75 = 22.05
  assert.equal(c.usd_cost, 22.05);
  assert.equal(c.cache_read_tokens, 1_000_000);
});

test("unknown anthropic model falls back to sonnet pricing", () => {
  const c = priceAnthropic("claude-something-new", { input_tokens: 1_000_000 });
  assert.equal(c.usd_cost, 3.0);
});

test("openai realtime prices audio in/out separately", () => {
  const c = priceOpenAIRealtime("gpt-realtime", {
    input_token_details: { audio_tokens: 1_000_000, text_tokens: 0, cached_tokens: 0 },
    output_token_details: { audio_tokens: 1_000_000, text_tokens: 0 },
  });
  assert.equal(c.usd_cost, 96); // 32 + 64
  assert.equal(c.audio_input_tokens, 1_000_000);
  assert.equal(c.audio_output_tokens, 1_000_000);
});

test("priceUsage dispatches openai transcription by feature", () => {
  const c = priceUsage({
    provider: "openai", model: "gpt-4o-mini-transcribe", feature: "transcription",
    usage: { input_token_details: { audio_tokens: 1_000_000 } },
  });
  assert.equal(c.usd_cost, 3.0); // audioInput 3.0/1M
});

test("fx: stale when missing/old, fresh when recent", () => {
  const now = Date.UTC(2026, 0, 2);
  assert.equal(isStale(null, now), true);
  assert.equal(isStale({ rate: 86, fetchedAt: new Date(now).toISOString() }, now), false);
  assert.equal(isStale({ rate: 86, fetchedAt: new Date(now - 24 * 3600 * 1000).toISOString() }, now), true);
});

test("fx: falls back to FX_FALLBACK when fetch fails and no cache", async () => {
  const { record, changed } = await resolveUsdInrRate(null, {
    nowMs: 0, nowIso: "1970-01-01T00:00:00.000Z",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  assert.equal(record.rate, FX_FALLBACK);
  assert.equal(record.source, "fallback");
  assert.equal(changed, true);
});

test("fx: keeps a fresh cached rate without refetching", async () => {
  const cached = { rate: 90, fetchedAt: new Date().toISOString(), source: "live" };
  let fetched = false;
  const { record, changed } = await resolveUsdInrRate(cached, { fetchImpl: async () => { fetched = true; return 100; } });
  assert.equal(record.rate, 90);
  assert.equal(changed, false);
  assert.equal(fetched, false);
});
