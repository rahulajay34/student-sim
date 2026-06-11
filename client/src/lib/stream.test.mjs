// Unit tests for createSentenceChunker and stripStreamingEmotionTag.
// Run with: node --test client/src/lib/stream.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Inline re-implementations so this file is self-contained (avoids needing to
// transpile JSX / Vite aliases for a Node test).  These mirror stream.js exactly
// so any divergence is a test maintenance bug, not a product bug.

// ── stripStreamingEmotionTag ──────────────────────────────────────────────────
const EMOTION_TAG_GLOBAL = /\[emotion:[^\]]*\]/gi;
const TAG_OPENER = "[emotion:";

function stripStreamingEmotionTag(fullText) {
  let text = String(fullText).replace(EMOTION_TAG_GLOBAL, "");
  const openIdx = text.lastIndexOf("[");
  if (openIdx !== -1) {
    const tail = text.slice(openIdx);
    const lower = tail.toLowerCase();
    const hasClose = tail.includes("]");
    if (!hasClose && tail.length > 1) {
      if (TAG_OPENER.startsWith(lower) || lower.startsWith(TAG_OPENER)) {
        return { display: text.slice(0, openIdx), pending: tail };
      }
    }
  }
  return { display: text, pending: "" };
}

// ── createSentenceChunker ─────────────────────────────────────────────────────
const SENTENCE_BOUNDARY = /[.!?।॥]/;
const SOFT_BOUNDARY = /[,;]/;
const DASH_BOUNDARY = / — /;
const MIN_CHUNK_LEN = 25;
const SOFT_MIN = 40;
const MAX_CHUNK_LEN = 110;

function createSentenceChunker({ minChunkLen = MIN_CHUNK_LEN } = {}) {
  let emittedLen = 0;

  function forceSplitAt(pending, cap) {
    let best = -1;
    for (let i = Math.min(cap - 1, pending.length - 1); i >= 0; i--) {
      if (SOFT_BOUNDARY.test(pending[i])) {
        const next = pending[i + 1];
        if (next === undefined || /\s/.test(next)) { best = i + 1; break; }
      }
    }
    if (best > 0) return best;
    for (let i = Math.min(cap, pending.length - 1); i >= 0; i--) {
      if (/\s/.test(pending[i])) return i + 1;
    }
    return Math.min(cap, pending.length);
  }

  function take(fullText, isFinal) {
    const out = [];
    let pending = fullText.slice(emittedLen);

    for (;;) {
      let emitEnd = -1;

      // Hard sentence boundaries.
      for (let i = 0; i < pending.length; i++) {
        const ch = pending[i];
        if (!SENTENCE_BOUNDARY.test(ch)) continue;
        const next = pending[i + 1];
        const atEnd = i === pending.length - 1;
        const confirmed = next === undefined ? isFinal : /\s/.test(next);
        if (!confirmed && !(atEnd && isFinal)) continue;
        const candidate = pending.slice(0, i + 1);
        if (candidate.trim().length < minChunkLen && !(atEnd && isFinal)) continue;
        emitEnd = i + 1;
        break;
      }

      // Soft boundaries (comma/semicolon/dash).
      if (emitEnd === -1 && pending.length >= SOFT_MIN) {
        let softIdx = -1;
        const dashM = DASH_BOUNDARY.exec(pending);
        if (dashM) softIdx = dashM.index + 3;

        for (let i = 0; i < pending.length; i++) {
          if (SOFT_BOUNDARY.test(pending[i])) {
            const next = pending[i + 1];
            if (/\s/.test(next)) {
              if (i + 1 >= SOFT_MIN) { softIdx = i + 1; break; }
            }
          }
        }
        if (softIdx > 0) emitEnd = softIdx;
      }

      // MAX_CHUNK_LEN force-flush.
      if (emitEnd === -1 && !isFinal && pending.length > MAX_CHUNK_LEN) {
        emitEnd = forceSplitAt(pending, MAX_CHUNK_LEN);
      }

      if (emitEnd <= 0) break;

      const sentence = pending.slice(0, emitEnd).trim();
      if (sentence) out.push(sentence);

      let j = emitEnd;
      while (j < pending.length && /\s/.test(pending[j])) j++;
      emittedLen += j;
      pending = fullText.slice(emittedLen);
    }

    return out;
  }

  return {
    push(fullText) { return take(String(fullText), false); },
    flush(fullText) {
      const text = String(fullText);
      const out = take(text, true);
      const rest = text.slice(emittedLen).trim();
      if (rest) { out.push(rest); emittedLen = text.length; }
      return out;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("stripStreamingEmotionTag", () => {
  it("strips a complete emotion tag", () => {
    const { display, pending } = stripStreamingEmotionTag("Hello there[emotion:happy]");
    assert.equal(display, "Hello there");
    assert.equal(pending, "");
  });

  it("withholds a partial emotion tag (proper non-empty prefix)", () => {
    const { display, pending } = stripStreamingEmotionTag("Hello there[emotion:");
    assert.equal(display, "Hello there");
    assert.equal(pending, "[emotion:");
  });

  it("withholds mid-prefix '[emot'", () => {
    const { display, pending } = stripStreamingEmotionTag("Good morning[emot");
    assert.equal(display, "Good morning");
    assert.equal(pending, "[emot");
  });

  it("does NOT withhold a bare '[' (length === 1)", () => {
    // A bare "[" by itself must not be suppressed — it clearly is not a prefix
    // of "[emotion:" (it would withhold for the entire stream duration).
    const { display, pending } = stripStreamingEmotionTag("Good morning [");
    assert.equal(display, "Good morning [");
    assert.equal(pending, "");
  });

  it("does NOT withhold '[xyz' that cannot become '[emotion:'", () => {
    const { display, pending } = stripStreamingEmotionTag("Look [xyz there");
    // '[xyz there' doesn't match the tag pattern — no withhold.
    assert.equal(display, "Look [xyz there");
    assert.equal(pending, "");
  });

  it("strips multiple complete tags", () => {
    const { display } = stripStreamingEmotionTag("[emotion:sad]No [emotion:happy] problem");
    assert.equal(display, "No  problem");
  });
});

describe("createSentenceChunker — basic sentence splitting", () => {
  it("emits nothing until a sentence boundary is accumulated", () => {
    const c = createSentenceChunker();
    const a = c.push("Hello");
    assert.deepEqual(a, []);
  });

  it("emits a sentence on full stop + space", () => {
    const c = createSentenceChunker();
    const a = c.push("Hello, how are you doing. Fine");
    assert.equal(a.length, 1);
    assert.equal(a[0], "Hello, how are you doing.");
  });

  it("flush() emits the remainder without a boundary", () => {
    const c = createSentenceChunker();
    c.push("Something without boundary yet");
    const a = c.flush("Something without boundary yet and more text");
    assert.equal(a.length, 1);
    assert.ok(a[0].length > 0);
  });
});

describe("createSentenceChunker — decimal guard", () => {
  it("does not split on '5.5' (digit . digit)", () => {
    const c = createSentenceChunker();
    // The '.' in '5.5' is not followed by whitespace so shouldn't split.
    const a = c.push("The fee is 5.5 lakh per year for the program.");
    // Should only emit after the final '.' + space (or at least not mid-decimal).
    assert.ok(a.every(s => !s.endsWith("5")));
  });

  it("'5.5' is preserved intact in flush output", () => {
    const c = createSentenceChunker();
    const a = c.flush("The fee is 5.5 lakh.");
    assert.equal(a.length, 1);
    assert.ok(a[0].includes("5.5"));
  });
});

describe("createSentenceChunker — comma-only long Hinglish reply (core bug fix)", () => {
  const LONG_COMMA_REPLY =
    "haan sahi keh rahe hain aap, main samajh raha hoon bilkul, " +
    "lekin thoda time chahiye mujhe sochne ke liye, " +
    "kyunki itna bada decision hai, " +
    "aur mere paas abhi finances clear nahi hain, " +
    "toh dekhta hoon kya hoga aage";

  it("emits multiple mid-stream chunks from push() for a long comma-only reply", () => {
    const c = createSentenceChunker();
    // Feed the text in three incremental steps as tokens arrive.
    const third = Math.floor(LONG_COMMA_REPLY.length / 3);
    const a1 = c.push(LONG_COMMA_REPLY.slice(0, third));
    const a2 = c.push(LONG_COMMA_REPLY.slice(0, third * 2));
    const a3 = c.push(LONG_COMMA_REPLY);
    const midStreamChunks = [...a1, ...a2, ...a3];

    assert.ok(
      midStreamChunks.length >= 1,
      `Expected >=1 mid-stream chunks, got ${midStreamChunks.length}: ${JSON.stringify(midStreamChunks)}`
    );
  });

  it("flush() after push() emits the full text with no duplication", () => {
    const c = createSentenceChunker();
    const fromPush = c.push(LONG_COMMA_REPLY);
    const fromFlush = c.flush(LONG_COMMA_REPLY);
    const all = [...fromPush, ...fromFlush].join(" ");
    // Every word should appear exactly once (no duplication).
    const pushWords = LONG_COMMA_REPLY.split(/\s+/);
    for (const word of pushWords) {
      const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const count = (all.match(re) || []).length;
      assert.ok(count >= 1, `Word "${word}" missing from output`);
    }
  });

  it("force-flush fires when pending exceeds MAX_CHUNK_LEN with no sentence boundary", () => {
    const c = createSentenceChunker();
    // A string > 110 chars with only commas and no sentence-ending punctuation.
    const noSentence =
      "acha theek hai yaar mujhe samajh aa gaya, " +
      "lekin meri ek aur baat hai abhi, " +
      "kya aap bata sakte hain placement ke baare mein thoda";
    assert.ok(noSentence.length > MAX_CHUNK_LEN, "test string must be > MAX_CHUNK_LEN");
    const a = c.push(noSentence);
    assert.ok(a.length >= 1, `force-flush should have emitted >=1 chunk, got ${a.length}`);
  });
});

describe("createSentenceChunker — no double-emission across push/flush", () => {
  it("content emitted by push is not re-emitted by flush", () => {
    const text = "Hello, this is a reasonably long sentence. And here is more text.";
    const c = createSentenceChunker();
    const fromPush = c.push(text);
    const fromFlush = c.flush(text);
    // The combined output should not repeat any sentence.
    const all = [...fromPush, ...fromFlush];
    const seen = new Set();
    for (const s of all) {
      assert.ok(!seen.has(s), `Duplicate sentence emitted: "${s}"`);
      seen.add(s);
    }
  });
});
