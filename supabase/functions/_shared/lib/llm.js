// _shared/lib/llm.js — ported from server/llm.js.
// CHANGES:
//   - Replaced process.env with getEnv() from ../env.js.
//   - All other logic is byte-identical.
//
// NOTE: This module imports @anthropic-ai/sdk which resolves via the Deno import
// map (import_map.json) under Deno. Under Node it will NOT resolve from this
// directory (no node_modules here) — exclude llm.js from node import-smoke tests.

import Anthropic from "npm:@anthropic-ai/sdk@0.104.1";
import { getEnv } from "../env.js";

export const MODEL = "claude-sonnet-4-6";

function resolveModel(override) {
  return override || getEnv("ANTHROPIC_MODEL") || MODEL;
}
export { resolveModel };

export const STUDENT_SAMPLING = { temperature: 0.9 };
export const DETERMINISTIC_SAMPLING = { temperature: 0.2 };

export const FAST_OPTIONS = { mode: "fast" };
export const REASONING_OPTIONS = { mode: "reasoning" };

export const DEFAULT_TIMEOUT_MS = 45_000;
export const REPORT_TIMEOUT_MS = 120_000;

const DEFAULT_MAX_TOKENS = 8_192;

let _client = null;

function getClient() {
  if (_client) return _client;
  _client = new Anthropic({
    apiKey: getEnv("ANTHROPIC_API_KEY") || "",
    maxRetries: 2,
  });
  return _client;
}

export function _setClientForTests(fakeClient) {
  _client = fakeClient;
}

function normalizeOpts(opts = {}) {
  const {
    mode: modeExplicit,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries,
    model,
    jsonSchema,
    effort,
    temperature,
    thinking: legacyThinking,
    top_p: _tp,
    repeat_penalty: _rp,
    ...rest
  } = opts;

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
    temperature,
    _rest: rest,
  };
}

function buildParams(messages, model, norm) {
  const { mode, temperature, jsonSchema, maxRetries, effort } = norm;

  let systemParam;
  let userMessages = messages;
  if (messages.length > 0 && messages[0].role === "system") {
    systemParam = messages[0].content;
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

  if (systemParam !== undefined) params.system = systemParam;
  if (temperature !== undefined && mode !== "reasoning") params.temperature = temperature;

  return { params, maxRetries };
}

function timeoutError(ms) {
  const err = new Error(`LLM call timed out after ${ms}ms`);
  err.code = "LLM_TIMEOUT";
  return err;
}

function mapSdkError(err, timeoutMs) {
  if (
    err?.constructor?.name === "APIConnectionTimeoutError" ||
    err?.code === "ERR_CANCELED" ||
    (err?.message || "").toLowerCase().includes("timeout")
  ) {
    throw timeoutError(timeoutMs);
  }
  throw err;
}

function extractTextFromContent(content) {
  let text = "";
  for (const block of content || []) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

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
