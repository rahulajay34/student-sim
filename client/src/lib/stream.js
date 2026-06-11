// SSE consumer for the streaming student-reply path.
//
// `POST /api/sessions/:id/message` with `Accept: text/event-stream` streams the
// student reply (see CONTRACT.md §SSE protocol):
//   - event: token  / data: {text}  — raw reply tokens (perceived latency)
//   - event: done   / data: <JSON>  — canonical result, byte-for-byte the same
//       shape as the non-SSE response ({reply, emotion, currentPhase,
//       satisfactionScore, scoreReason, turnType, milestones}). The coherence
//       gate may have substituted the reply, so callers MUST swap in this payload.
//   - event: error  / data: {error} — on failure (includes LLM_TIMEOUT).
//
// IMPORTANT: this lives in stream.js (NOT lib/api.js — another agent owns that).
//
// `onToken(textChunk)` fires per raw token. The raw stream can contain a trailing
// `[emotion:X]` tag (possibly split across chunks); SUPPRESSING that tag from the
// displayed text is the caller's job — this consumer forwards raw token text
// verbatim so no information is lost before the caller buffers it.
//
// Resolves with the `done` payload (also delivered via `onDone`). Rejects (and
// calls `onError`) on a fetch-level failure or a server `error` event, so the
// caller can fall back to the non-streaming JSON path and never lose a turn.

// Strips any `[emotion:X]` tag (complete or partial) from streamed reply text
// for DISPLAY only. The tag is emitted trailing and can arrive split across token
// chunks (e.g. "...thanks [emo" then "tion:happy]"), so we must hold back any tail
// that could be the start of a tag until we know it isn't.
//
// Strategy: remove all complete `[emotion:...]` tags, then if the text ends with a
// prefix of the literal "[emotion:" opener (or an open "[emotion:" with no closing
// "]" yet), withhold that suffix. Returns { display, pending } where `pending` is
// the withheld tail to be re-prepended to the next chunk's accumulated buffer.
//
// Operates on the FULL accumulated streamed text each call (cheap, robust to any
// split). Callers pass the whole running buffer and render `display`.
const EMOTION_TAG_GLOBAL = /\[emotion:[^\]]*\]/gi;
const TAG_OPENER = "[emotion:";

export function stripStreamingEmotionTag(fullText) {
  // Drop every completed tag anywhere in the text.
  let text = String(fullText).replace(EMOTION_TAG_GLOBAL, "");

  // An unterminated "[emotion:..." with no closing "]" — withhold from the open bracket.
  const openIdx = text.lastIndexOf("[");
  if (openIdx !== -1) {
    const tail = text.slice(openIdx);
    // tail is a prefix of "[emotion:..." (the opener) OR a started-but-unclosed tag.
    const lower = tail.toLowerCase();
    if (TAG_OPENER.startsWith(lower) || lower.startsWith(TAG_OPENER)) {
      return { display: text.slice(0, openIdx), pending: tail };
    }
  }
  return { display: text, pending: "" };
}

// ── Sentence chunker for incremental TTS ───────────────────────────────────────
// Splits a progressively-growing (emotion-tag-suppressed) display string into
// speakable sentences so the student can start talking on the first sentence
// instead of after the whole reply. Boundaries: . ! ? or the Devanagari danda
// (।/॥) followed by whitespace (or end-of-input on flush). A minimum chunk length
// (~25 chars) coalesces tiny fragments ("Okay.", "Haan.") so we don't fire
// micro-chunks at the TTS engine.
//
// Usage: create one per reply. Call push(fullDisplaySoFar) on every token update
// — it returns an array of any NEWLY-complete sentences. Call flush() on `done`
// to emit whatever remains. Returns whitespace-trimmed, non-empty sentences only.
const SENTENCE_BOUNDARY = /[.!?।॥]/;
const MIN_CHUNK_LEN = 25;

export function createSentenceChunker({ minChunkLen = MIN_CHUNK_LEN } = {}) {
  let emittedLen = 0; // chars of the display string already emitted as sentences

  // Scan `pending` (the not-yet-emitted tail) for boundary positions; emit a
  // sentence each time the accumulated length since the last cut is >= minChunkLen.
  function take(fullText, isFinal) {
    const out = [];
    let pending = fullText.slice(emittedLen);
    let localBase = 0; // index within `pending` where the current sentence starts

    for (let i = 0; i < pending.length; i++) {
      const ch = pending[i];
      if (!SENTENCE_BOUNDARY.test(ch)) continue;
      // A boundary char must be followed by whitespace (or, on flush, end) to count
      // — avoids splitting decimals ("5.5"), abbreviations mid-token, etc.
      const next = pending[i + 1];
      const atEnd = i === pending.length - 1;
      const boundaryConfirmed = next === undefined ? isFinal : /\s/.test(next);
      if (!boundaryConfirmed && !(atEnd && isFinal)) continue;

      const candidate = pending.slice(localBase, i + 1);
      if (candidate.trim().length < minChunkLen && !(atEnd && isFinal)) {
        // Too short — keep accumulating into the next boundary.
        continue;
      }
      const sentence = candidate.trim();
      if (sentence) out.push(sentence);
      // Advance past this sentence + any trailing whitespace.
      let j = i + 1;
      while (j < pending.length && /\s/.test(pending[j])) j++;
      emittedLen += j; // consumed from the start of `pending`
      pending = fullText.slice(emittedLen);
      localBase = 0;
      i = -1; // restart scan over the new pending tail
    }
    return out;
  }

  return {
    push(fullText) {
      return take(String(fullText), false);
    },
    flush(fullText) {
      const text = String(fullText);
      const out = take(text, true);
      // Emit any trailing remainder that never hit a boundary.
      const rest = text.slice(emittedLen).trim();
      if (rest) {
        out.push(rest);
        emittedLen = text.length;
      }
      return out;
    },
  };
}

export async function postMessageStream(sessionId, body, { onToken, onDone, onError } = {}) {
  let res;
  try {
    res = await fetch(`/api/sessions/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    // Network / fetch-level failure — surface so the caller can retry via JSON.
    onError?.(err);
    throw err;
  }

  const contentType = res.headers.get("content-type") || "";

  // Server didn't honour SSE (older server, proxy, or error). Parse as JSON so a
  // turn is still delivered through this path when possible.
  if (!contentType.includes("text/event-stream")) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      onError?.(err);
      throw err;
    }
    onDone?.(data);
    return data;
  }

  if (!res.ok || !res.body) {
    const err = new Error(`Request failed (${res.status})`);
    onError?.(err);
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let donePayload = null;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line ("\n\n").
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        // Parse the SSE frame line-by-line: one `event:` and any number of
        // `data:` lines (concatenated per the SSE spec).
        let event = null;
        const dataLines = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (!event || dataLines.length === 0) continue;
        const dataRaw = dataLines.join("\n");

        let data;
        try {
          data = JSON.parse(dataRaw);
        } catch {
          continue;
        }

        if (event === "token") {
          if (typeof data?.text === "string") onToken?.(data.text);
        } else if (event === "done") {
          donePayload = data;
        } else if (event === "error") {
          const err = new Error(data?.error || "Student reply failed.");
          err.sseError = true;
          onError?.(err);
          throw err;
        }
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      /* already closed */
    }
  }

  if (!donePayload) {
    // The connection reached the server and started streaming, then dropped before
    // `done`. Flag as a server-side stream error (sseError) so the caller does NOT
    // re-POST — the server already processed (and persisted) this turn; a JSON
    // retry would duplicate the message. Surface via toast instead.
    const err = new Error("The student reply stream ended unexpectedly.");
    err.sseError = true;
    onError?.(err);
    throw err;
  }

  onDone?.(donePayload);
  return donePayload;
}
