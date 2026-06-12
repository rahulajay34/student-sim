// LLM client — MiniMax (https://api.minimax.io, OpenAI-compatible API).
// The file keeps its legacy name (ollama.js) because every server module imports
// from here; the app previously ran on Ollama Cloud and before that the project
// name referenced Gemini. Auth: Bearer MINIMAX_API_KEY from the repo-root .env.
//
// MiniMax-M3 is a reasoning model: response content starts with an inline
// <think>...</think> block. Both chat() and chatStream() strip/suppress it so
// callers (and the SSE client) only ever see the actual reply.

const API_URL = "https://api.minimax.io/v1/chat/completions";

// Single model for all calls (chat, scoring, coherence, report).
// Override per-call via options.model or globally via MINIMAX_MODEL env var.
export const MODEL = process.env.MINIMAX_MODEL || "MiniMax-M3";

// Sampling presets (consumed below; repeat_penalty is translated to the
// OpenAI-style frequency_penalty MiniMax accepts).
// STUDENT_SAMPLING: roleplayed student must sound varied and human.
// DETERMINISTIC_SAMPLING: scoring and report generation must be stable.
export const STUDENT_SAMPLING = { temperature: 0.9, top_p: 0.95, repeat_penalty: 1.3 };
export const DETERMINISTIC_SAMPLING = { temperature: 0.2 };

// Default timeouts (milliseconds).
const DEFAULT_TIMEOUT_MS = 45_000;   // chat / scoring calls
const REPORT_TIMEOUT_MS = 120_000;   // report generation

// Generous output budget: M3 spends tokens on its hidden <think> block before
// the visible reply, so a tight cap would truncate answers mid-thought.
const DEFAULT_MAX_TOKENS = 8_192;

const THINK_CLOSE = "</think>";

function apiKey() {
  return process.env.MINIMAX_API_KEY || "";
}

// Translate our sampling preset names to the OpenAI-style body MiniMax accepts.
// `thinking` controls M3's reasoning block: default { type: "disabled" } (no
// <think> block — faster, cheaper) for every call; a caller passing
// { type: "adaptive" } re-enables reasoning. If the API ever rejects the field,
// stripThink() still handles any reasoning block that comes back, so it is safe.
function buildBody(messages, model, samplingOptions, stream) {
  const { temperature, top_p, repeat_penalty, max_tokens, thinking } = samplingOptions || {};
  const body = {
    model,
    stream,
    messages,
    max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
    thinking: thinking ?? { type: "disabled" },
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (top_p !== undefined) body.top_p = top_p;
  if (repeat_penalty !== undefined) body.frequency_penalty = Math.max(0, (repeat_penalty - 1) * 1.5);
  return body;
}

function timeoutError(ms) {
  const err = new Error(`LLM call timed out after ${ms}ms`);
  err.code = "LLM_TIMEOUT";
  return err;
}

// Strip the <think>...</think> reasoning block from a complete response.
// Two hard-won edge cases:
// - NO closing tag (model truncated mid-think): returning the raw string leaked
//   the model's internal monologue into the student's transcript — strip the
//   whole unclosed block instead (empty result is fine; engine.ensureNonEmpty
//   substitutes a fallback line).
// - Visible text BEFORE the think block: slicing from </think> silently dropped
//   it — preserve both sides.
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

/**
 * chat(messages, options?, model?)
 *
 * Thin wrapper — callers pass messages and receive the (think-stripped) text.
 * Backward-compatible: all three parameters are optional.
 *
 * Supported options (in addition to sampling knobs):
 *   options.model      {string}  — override the model for this call
 *   options.timeoutMs  {number}  — abort timeout in ms
 *                                  (default 45 000; use REPORT_TIMEOUT_MS=120 000 for reports)
 *
 * Throws an Error with .code='LLM_TIMEOUT' if the call exceeds timeoutMs.
 */
export async function chat(messages, options = {}, model = MODEL) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, model: modelOverride, ...samplingOptions } = options;
  const resolvedModel = modelOverride || model;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: "Bearer " + apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildBody(messages, resolvedModel, samplingOptions, false)),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`MiniMax HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(`MiniMax response missing content: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return stripThink(content);
  } catch (err) {
    if (err?.name === "AbortError") throw timeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * chatStream(messages, options?)
 *
 * Async generator that yields string tokens as they arrive from the model.
 * Used by the SSE endpoint to stream student replies to the client.
 * The model's <think>...</think> block is suppressed: nothing is yielded
 * until the reasoning closes (or, for non-reasoning responses, from the start).
 *
 * Supported options (same as chat):
 *   options.model      {string}
 *   options.timeoutMs  {number}  — window for the response headers + first chunk
 *                                  (default 45 000; cleared once streaming begins)
 *
 * Throws Error with .code='LLM_TIMEOUT' if streaming doesn't start in time.
 */
export async function* chatStream(messages, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, model: modelOverride, ...samplingOptions } = options;
  const resolvedModel = modelOverride || MODEL;
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: "Bearer " + apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildBody(messages, resolvedModel, samplingOptions, true)),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === "AbortError") throw timeoutError(timeoutMs);
    throw err;
  }
  if (!res.ok) {
    clearTimeout(timer);
    const detail = await res.text().catch(() => "");
    throw new Error(`MiniMax HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";          // partial SSE lines across network chunks
  let thinkBuf = "";        // accumulated content while inside <think>
  let thinking = true;      // suppress output until </think> (or proven absent)
  let firstChunkSeen = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstChunkSeen) {
        firstChunkSeen = true;
        clearTimeout(timer);
        timer = null;
      }
      sseBuf += decoder.decode(value, { stream: true });

      // Parse complete SSE lines; keep the trailing partial line in the buffer.
      const lines = sseBuf.split("\n");
      sseBuf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        let delta = "";
        try {
          delta = JSON.parse(payload)?.choices?.[0]?.delta?.content || "";
        } catch {
          continue; // ignore malformed keep-alive lines
        }
        if (!delta) continue;

        if (!thinking) {
          yield delta;
          continue;
        }

        // Inside (potential) think block: buffer until </think> shows up.
        thinkBuf += delta;
        const closeIdx = thinkBuf.indexOf(THINK_CLOSE);
        if (closeIdx !== -1) {
          thinking = false;
          const visible = thinkBuf.slice(closeIdx + THINK_CLOSE.length).replace(/^\s+/, "");
          thinkBuf = "";
          if (visible) yield visible;
        } else if (!thinkBuf.trimStart().startsWith("<think")
          && thinkBuf.trimStart().length > "<think>".length) {
          // No think block in this response — flush and pass through from now on.
          thinking = false;
          const visible = thinkBuf;
          thinkBuf = "";
          if (visible) yield visible;
        }
      }
    }
    // Stream ended without [DONE]; flush anything still buffered (no-think edge).
    if (thinking && thinkBuf) {
      const visible = stripThink(thinkBuf);
      if (visible) yield visible;
    }
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock?.();
  }
}

/**
 * chatStreamCollect(messages, onToken, options?, model?)
 *
 * Callback-style streaming wrapper for callers that want the full text
 * and an onToken side-effect. Resolves to the full concatenated text.
 */
export async function chatStreamCollect(messages, onToken, options = {}, model = MODEL) {
  const { model: modelOverride, ...rest } = options;
  const resolvedOptions = { ...rest, model: modelOverride || model };
  let full = "";
  for await (const tok of chatStream(messages, resolvedOptions)) {
    full += tok;
    if (onToken) onToken(tok);
  }
  return full;
}

// Convenience timeout constant exported for callers that generate reports.
export { REPORT_TIMEOUT_MS };

// Robustly pull the first JSON object out of an LLM response (handles ```json fences).
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
