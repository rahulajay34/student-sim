// LLM client — Anthropic Claude via @anthropic-ai/sdk.
// Replaces the legacy MiniMax/OpenAI-compatible fetch layer.
//
// All callers continue to import from ./ollama.js which re-exports everything
// here. This file is the single implementation; ollama.js is a thin shim.
//
// Key design points:
//   - Lazy singleton client; _setClientForTests() injects a stub.
//   - options.mode = "fast" | "reasoning" drives thinking + effort.
//   - options.jsonSchema drives output_config.format for structured JSON.
//   - Legacy options (top_p, repeat_penalty, thinking:{type}) are sanitized.
//   - Timeout errors surface as Error with .code = "LLM_TIMEOUT".
//   - No top-level process.env reads; all env reads are deferred into functions.

import Anthropic from "@anthropic-ai/sdk";

// ─── Model / constants ────────────────────────────────────────────────────────
export const MODEL = "claude-sonnet-4-6";

function resolveModel(override) {
  return override || process.env.ANTHROPIC_MODEL || MODEL;
}
export { resolveModel };

// ─── Sampling presets ─────────────────────────────────────────────────────────
// STUDENT_SAMPLING: varied, human-sounding roleplayed student turns.
// DETERMINISTIC_SAMPLING: stable scoring / report generation.
// Exported for import-compat with callers that spread these into chat() opts.
export const STUDENT_SAMPLING = { temperature: 0.9 };
export const DETERMINISTIC_SAMPLING = { temperature: 0.2 };

// ─── Mode option bundles (callers pass one of these) ─────────────────────────
// FAST_OPTIONS → thinking disabled, effort low (low latency).
// REASONING_OPTIONS → thinking adaptive, effort high (quality).
export const FAST_OPTIONS = { mode: "fast" };
export const REASONING_OPTIONS = { mode: "reasoning" };

// ─── Timeout defaults ─────────────────────────────────────────────────────────
export const DEFAULT_TIMEOUT_MS = 45_000;
export const REPORT_TIMEOUT_MS = 120_000;

const DEFAULT_MAX_TOKENS = 8_192;

// ─── Lazy singleton client + test seam ───────────────────────────────────────
let _client = null;

function getClient() {
  if (_client) return _client;
  _client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    maxRetries: 2,
  });
  return _client;
}

/**
 * _setClientForTests(fakeClient)
 * Inject a stub client for unit tests. Pass null to restore the real client.
 */
export function _setClientForTests(fakeClient) {
  _client = fakeClient;
}

// ─── Options normalisation ────────────────────────────────────────────────────
// Sanitizes the heterogeneous opts callers pass, producing a clean internal
// descriptor. Legacy fields accepted for backward-compat but not forwarded:
//   - top_p           → dropped (Anthropic: at most one of temperature/top_p)
//   - repeat_penalty  → dropped (no equivalent)
//   - thinking: {type:"adaptive"}  → maps to mode:"reasoning"
//   - thinking: {type:"disabled"}  → maps to mode:"fast"
//   - temperature     → kept as-is (valid in fast mode)
//
// Prompt-caching: callers may pass options.systemParts = { stable, variable }
// (from buildSystemPromptParts) instead of embedding a system role in messages[].
// When present, buildParams builds a two-block system array with cache_control
// on the stable block only. systemParts wins over a leading system-role message;
// a console.warn is emitted if both are present so the collision is visible.
//
// Callers may also pass mode:"fast"|"reasoning" directly (preferred).
function normalizeOpts(opts = {}) {
  const {
    mode: modeExplicit,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries,
    model,
    jsonSchema,
    effort,
    // prompt-caching split { stable, variable }
    systemParts,
    // legacy sampling knobs
    temperature,
    thinking: legacyThinking,
    // explicitly drop these — no equivalent in Anthropic
    top_p: _tp,
    repeat_penalty: _rp,
    // absorb anything else we don't know about
    ...rest
  } = opts;

  // Resolve mode: explicit mode > legacy thinking field > default fast
  let mode = modeExplicit;
  if (!mode) {
    if (legacyThinking?.type === "adaptive") mode = "reasoning";
    else mode = "fast";
  }

  return {
    mode,
    timeoutMs,
    maxRetries,
    model,
    jsonSchema,
    effort,
    systemParts,
    temperature,
    _rest: rest,
  };
}

// Build the Anthropic API params from normalised opts.
function buildParams(messages, model, norm) {
  const { mode, temperature, jsonSchema, maxRetries, effort, systemParts } = norm;

  // Lift a leading system role message to top-level system param.
  // systemParts wins when both are present (logs once to surface the collision).
  let systemParam;
  let userMessages = messages;
  if (messages.length > 0 && messages[0].role === "system") {
    if (systemParts) {
      console.warn("[llm] systemParts and a system-role message are both present — systemParts wins; ignoring the system-role message");
    } else {
      systemParam = messages[0].content;
    }
    userMessages = messages.slice(1);
  }

  const thinking =
    mode === "reasoning"
      ? { type: "adaptive" }
      : { type: "disabled" };

  const output_config = {};
  // Explicit effort option wins; otherwise reasoning→high, fast→low.
  output_config.effort = effort || (mode === "reasoning" ? "high" : "low");

  if (jsonSchema) {
    output_config.format = { type: "json_schema", schema: jsonSchema };
  }

  const params = {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: userMessages,
    thinking,
    output_config,
  };

  // Prompt-caching via systemParts: build a two-block system array.
  // Block 0 carries cache_control (ephemeral) — the stable prefix.
  // Block 1 carries the variable suffix (no cache_control).
  // Omit block 1 when variable is empty (avoids an empty text block).
  if (systemParts) {
    const blocks = [
      { type: "text", text: systemParts.stable, cache_control: { type: "ephemeral" } },
    ];
    if (systemParts.variable) {
      blocks.push({ type: "text", text: systemParts.variable });
    }
    params.system = blocks;
  } else if (systemParam !== undefined) {
    params.system = systemParam;
  }

  // temperature is incompatible with (adaptive) thinking — only send it on
  // fast-mode calls, where thinking is disabled.
  if (temperature !== undefined && mode !== "reasoning") params.temperature = temperature;

  return { params, maxRetries };
}

// ─── Timeout error factory ────────────────────────────────────────────────────
function timeoutError(ms) {
  const err = new Error(`LLM call timed out after ${ms}ms`);
  err.code = "LLM_TIMEOUT";
  return err;
}

// Map SDK timeout errors to our canonical shape.
function mapSdkError(err, timeoutMs) {
  // APIConnectionTimeoutError is raised by the SDK when the request times out.
  if (
    err?.constructor?.name === "APIConnectionTimeoutError" ||
    err?.code === "ERR_CANCELED" ||
    (err?.message || "").toLowerCase().includes("timeout")
  ) {
    throw timeoutError(timeoutMs);
  }
  throw err;
}

// Concatenate all text content blocks, skipping thinking blocks.
function extractTextFromContent(content) {
  let text = "";
  for (const block of content || []) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

// ─── chat() ──────────────────────────────────────────────────────────────────
/**
 * chat(messages, options?, _unusedModelArg?)
 *
 * Translates the message array (lifting a leading system role), calls
 * client.messages.create, and returns the concatenated text content.
 * Thinking blocks are skipped automatically.
 *
 * options:
 *   mode          "fast" | "reasoning"  (default "fast")
 *   timeoutMs     number                (default 45 000)
 *   maxRetries    number
 *   model         string                (override)
 *   jsonSchema    object                (drives output_config.format)
 *   temperature   number
 *   -- legacy, sanitized --
 *   thinking      { type: "adaptive"|"disabled" }  → mapped to mode
 *   top_p         dropped
 *   repeat_penalty dropped
 *
 * Throws Error with .code="LLM_TIMEOUT" on timeout.
 */
export async function chat(messages, options = {}, _unusedModel) {
  const norm = normalizeOpts(options);
  const model = resolveModel(norm.model);
  const { params, maxRetries } = buildParams(messages, model, norm);
  const reqOpts = {};
  if (typeof norm.timeoutMs === "number") reqOpts.timeout = norm.timeoutMs;
  if (typeof maxRetries === "number") reqOpts.maxRetries = maxRetries;

  try {
    const client = getClient();
    const res = await client.messages.create(params, reqOpts);
    return extractTextFromContent(res.content);
  } catch (err) {
    mapSdkError(err, norm.timeoutMs);
  }
}

// ─── chatStream() ─────────────────────────────────────────────────────────────
/**
 * chatStream(messages, options?)
 *
 * Async generator that yields string tokens as they arrive.
 * Only text_delta events are yielded — thinking_delta is skipped automatically.
 *
 * Throws Error with .code="LLM_TIMEOUT" on timeout.
 */
export async function* chatStream(messages, options = {}) {
  const norm = normalizeOpts(options);
  const model = resolveModel(norm.model);
  const { params, maxRetries } = buildParams(messages, model, norm);
  const reqOpts = {};
  if (typeof norm.timeoutMs === "number") reqOpts.timeout = norm.timeoutMs;
  if (typeof maxRetries === "number") reqOpts.maxRetries = maxRetries;

  let stream;
  try {
    const client = getClient();
    stream = client.messages.stream(params, reqOpts);
  } catch (err) {
    mapSdkError(err, norm.timeoutMs);
  }

  try {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  } catch (err) {
    mapSdkError(err, norm.timeoutMs);
  }
}

// ─── chatStreamCollect() ─────────────────────────────────────────────────────
/**
 * chatStreamCollect(messages, onToken, options?, _unusedModelArg?)
 *
 * Callback-style streaming wrapper. Resolves to the full concatenated text.
 */
export async function chatStreamCollect(messages, onToken, options = {}, _unusedModel) {
  const { model: modelOverride, ...rest } = options;
  const resolvedOptions = { ...rest, model: modelOverride };
  let full = "";
  for await (const tok of chatStream(messages, resolvedOptions)) {
    full += tok;
    if (onToken) onToken(tok);
  }
  return full;
}

// ─── stripThink ───────────────────────────────────────────────────────────────
// Kept verbatim from ollama.js — callers that import it continue to work.
// The Anthropic SDK separates thinking into its own block type so this function
// is effectively a no-op for new responses, but it ensures backward compat for
// any cached / test text that contains the MiniMax <think> format.
const THINK_CLOSE = "</think>";

export function stripThink(text) {
  const s = String(text);
  const idx = s.indexOf(THINK_CLOSE);
  if (idx === -1) {
    const openIdx = s.indexOf("<think>");
    if (openIdx === -1) return s.trim();
    return s.slice(0, openIdx).trim();
  }
  const openIdx = s.indexOf("<think>");
  const before = openIdx > -1 && openIdx < idx ? s.slice(0, openIdx).trim() : "";
  const after = s.slice(idx + THINK_CLOSE.length).replace(/^\s+/, "");
  return before ? `${before} ${after}`.trim() : after;
}

// ─── extractJson ──────────────────────────────────────────────────────────────
// Copied verbatim from ollama.js — robustly pulls the first JSON object out of
// an LLM response (handles ```json fences).
export function extractJson(raw) {
  const stripped = String(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model response");
  return JSON.parse(match[0]);
}
