// Generates the student's turns. Builds the chat message array from the stored
// transcript (the server owns conversation history) and the composed system prompt.
import { chat, chatStream, STUDENT_SAMPLING, DETERMINISTIC_SAMPLING } from "./ollama.js";
import { buildSystemPrompt, computeConvincementHint } from "./prompt.js";
import { classifyCounsellorTurn } from "./classify.js";

const EMOTION_TAG_RE = /\[emotion:\s*([a-z ]{0,30})\]/gi;
const VALID_EMOTIONS = new Set(["neutral", "happy", "hesitant", "worried", "frustrated", "excited"]);

// Parses the [emotion:X] tag from anywhere in the LLM output, strips all
// occurrences (generic regex — no enum in the pattern), and returns { text, emotion }.
// Validates the FIRST captured value against the 6-value enum; falls back to "neutral".
export function parseEmotion(raw) {
  let emotion = "neutral";
  let firstCapture = null;

  // Replace all [emotion:...] tags with a single space; capture the first value.
  const text = String(raw).replace(EMOTION_TAG_RE, (_match, val) => {
    if (firstCapture === null) firstCapture = val.trim().toLowerCase();
    return " ";
  }).replace(/  +/g, " ").trim();

  if (firstCapture !== null && VALID_EMOTIONS.has(firstCapture)) {
    emotion = firstCapture;
  }

  return { text, emotion };
}

// Re-attaches a trailing [emotion:X] tag to a coherence-gated / substituted reply.
// Canned and regenerated replies have no emotion of their own, so they default to
// neutral — preserving the student-reply protocol (every reply ends with a tag).
function withEmotion(text, emotion = "neutral") {
  const e = VALID_EMOTIONS.has(emotion) ? emotion : "neutral";
  return `${String(text).trim()} [emotion:${e}]`;
}

// Maps the stored transcript into Ollama's alternating user/assistant format.
// student -> assistant, counsellor -> user. The opening student message has no
// preceding user turn, so we inject a synthetic trigger to keep roles alternating.
function transcriptToMessages(transcript) {
  const msgs = [];
  if (!Array.isArray(transcript)) return msgs; // defensive: never throw on a bad/undefined transcript
  if (transcript.length > 0 && transcript[0].role === "student") {
    msgs.push({ role: "user", content: "Start the conversation. Please introduce yourself briefly." });
  }
  for (const t of transcript) {
    msgs.push({ role: t.role === "student" ? "assistant" : "user", content: t.text });
  }
  return msgs;
}

// flavour is the per-session personalityFlavour rolled at session start. Old
// callers that omit it fall soft inside buildSystemPrompt. The opening message
// never gets a verbosity/momentum override — turnVerbosity and lastAdjustment
// are null by definition (no prior counsellor turn to react to yet).
export async function getFirstMessage(persona, scenario, course, flavour = null) {
  const systemPrompt = buildSystemPrompt(persona, scenario, 1, 50, course, null, flavour, null, null, null, null);
  const raw = await chat([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        "Start the conversation. Your very first message must be only a self-introduction of 2-3 sentences. Mention your background based on your persona and why you took the test. Nothing else.",
    },
  ], STUDENT_SAMPLING);
  return parseEmotion(raw);
}

// --- coherence gate ----------------------------------------------------------
// The register reference is mined from noisy ASR transcripts, so the model
// sometimes imitates the garble. Every reply is cross-checked (AFTER the emotion
// tag is stripped, so the gate only sees the spoken text); incoherent ones are
// replaced (statement turn -> rotating Hinglish acknowledgement) or regenerated
// once (question/invite turn -> a reply that actually answers). The canonical
// reply always carries an [emotion:X] tag re-attached at the end.

// Free structural screen: word/phrase loops ("the, the, the") and runaway length.
// The length cap is decoupled from coherence: a genuine 2-4 sentence "open" reply
// can legitimately run well past 60 words, so only obviously runaway output (>150
// words) is treated as broken — otherwise valid verbose turns get swapped for a
// canned 4-word ack. Word-loop garble is still caught regardless of length.
const WORD_LOOP_RE = /(\b\w+(?:\s+\w+)?\b)(?:[,.\s]+\1\b){2,}/i;
const RUNAWAY_WORD_CAP = 150;
// Exported for unit testing — pure function of its input.
export function structurallyBroken(text) {
  return WORD_LOOP_RE.test(text) || text.split(/\s+/).filter(Boolean).length > RUNAWAY_WORD_CAP;
}

// Tighter timeout for the coherence gate so a slow verifier can't stall the
// SSE 'done' event for the full default 45s — the gate fails open on timeout.
const COHERENCE_TIMEOUT_MS = 8_000;

// LLM coherence check (small near-deterministic call). Fails OPEN: if the
// verifier itself errors (or times out), the reply stands — never block a
// session on the gate. This call keeps the default thinking mode (disabled).
async function makesSense(counsellorMsg, replyText) {
  if (structurallyBroken(replyText)) return false;
  try {
    const verdict = await chat([{
      role: "user",
      content: `You are checking one line of dialogue from a phone call between a course counsellor and a student. Hinglish, casual grammar and very short replies like "haan sir" are all NORMAL and valid.

Counsellor said: "${counsellorMsg}"
Student replied: "${replyText}"

Is the student's reply coherent and logically sensible as a response (not garbled, not half-finished nonsense, not answering something never asked)? Reply with exactly one word: VALID or INVALID.`,
    }], { ...DETERMINISTIC_SAMPLING, timeoutMs: COHERENCE_TIMEOUT_MS });
    return !/\bINVALID\b/i.test(verdict);
  } catch (e) {
    console.warn("[engine] coherence check failed open:", e.message);
    return true;
  }
}

const FALLBACK_ACKS = ["Okay sir.", "Haan sir.", "Theek hai.", "Hmm, okay."];
let ackRotation = 0;
const DOUBLE_FAILURE_LINE = "Sorry sir, I did not get that. Can you please repeat?";

const REGEN_NOTE = `

IMPORTANT: Your previous draft of this reply did not make sense (garbled or illogical). Write a NEW reply that plainly and directly answers the counsellor's last message in 1-2 short, simple sentences. It must be fully coherent. Keep the same casual student register. End with a [emotion:X] tag as usual.`;

// --- anti-loop guard ---------------------------------------------------------
// The student LLM sometimes repeats an objection nearly verbatim turn after turn
// (see ses-4545ee97 — the same refund/guarantee line 5x). Before accepting a
// reply we compare it against the last 6 student turns; if it is >0.8 similar to
// any, we regenerate ONCE with REPEAT_NOTE, and if STILL too similar fall back to
// a short acknowledgement that moves the conversation forward.
const REPEAT_SIM_THRESHOLD = 0.8;
const REPEAT_LOOKBACK = 6;

// Normalise: strip the emotion tag (already stripped by parseEmotion, but be
// defensive), lowercase, collapse punctuation/whitespace to single spaces.
function normalizeForSim(text) {
  return String(text)
    .replace(EMOTION_TAG_RE, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Token-overlap (Jaccard-ish, by shared-token fraction of the shorter set) so a
// near-verbatim repeat scores high even with a few words changed. Very short
// replies (acks like "haan sir") never trip the guard — they are legitimately
// repeatable and the threshold is computed against the smaller token set.
function loopSimilarity(a, b) {
  const ta = new Set(normalizeForSim(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeForSim(b).split(" ").filter(Boolean));
  if (ta.size < 4 || tb.size < 4) return 0; // ignore short acknowledgements
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

// Max similarity of `text` against the last REPEAT_LOOKBACK student turns.
function maxLoopSimilarity(text, transcript) {
  const recentStudent = (transcript || [])
    .filter((t) => t.role === "student")
    .slice(-REPEAT_LOOKBACK);
  let max = 0;
  for (const t of recentStudent) {
    const s = loopSimilarity(text, t.text);
    if (s > max) max = s;
  }
  return max;
}

const REPEAT_NOTE = `

IMPORTANT: You already said almost exactly this in a previous turn — do NOT repeat yourself. The counsellor has just responded to you. React to what the counsellor actually told you in this latest message: accept it, ask ONE specific new follow-up, or raise a DIFFERENT concern. Do not restate the same objection in the same words. Keep it short and natural. End with a [emotion:X] tag as usual.`;

const LOOP_FALLBACK_LINE = "Haan sir, I hear you. Let me think about that and let's move ahead.";

// Shared pieces for the per-turn reply: turnHint classification + composed prompt
// + message array. Used by both the streaming and non-streaming entry points.
// personalityFlavour is passed through to buildSystemPrompt; old sessions that
// lack the field fall soft inside buildSystemPrompt (re-rolls from persona.personality
// or DEFAULT_PERSONALITY).
// turnVerbosity ('short'|'open'|null) is rolled per turn by the server and stored
// on the session as `lastTurnVerbosity`; lastAdjustment is the counsellor's most
// recent scoring adjustment (the one-turn-lag value — scoring runs in parallel by
// design). Both are threaded into buildSystemPrompt so the per-turn verbosity and
// momentum overrides render. Both fall soft to null when the server has not set
// them (old sessions, or the opening turn).
function prepareReply(session) {
  const { personaSnapshot, scenarioSnapshot, currentPhase, satisfactionScore, transcript, courseSnapshot, personalityFlavour = null, objectionState = null } = session;
  const last = transcript[transcript.length - 1];
  const turnHint = last?.role === "counsellor" ? classifyCounsellorTurn(last.text) : null;
  const convincementHint = computeConvincementHint(session);

  const turnVerbosity = (session.lastTurnVerbosity === "open" || session.lastTurnVerbosity === "short")
    ? session.lastTurnVerbosity
    : null;
  const history = Array.isArray(session.scoreHistory) ? session.scoreHistory : [];
  const lastEntry = history.length ? history[history.length - 1] : null;
  const lastAdjustment = (lastEntry && typeof lastEntry.adjustment === "number") ? lastEntry.adjustment : null;

  const systemPrompt = buildSystemPrompt(
    personaSnapshot, scenarioSnapshot, currentPhase, satisfactionScore, courseSnapshot,
    turnHint, personalityFlavour, convincementHint, objectionState, turnVerbosity, lastAdjustment,
  );
  const messages = [{ role: "system", content: systemPrompt }, ...transcriptToMessages(transcript)];
  // `transcript` is needed by gateReply/guardLoop for the regeneration + anti-loop
  // paths (transcriptToMessages + maxLoopSimilarity). Without it those paths saw
  // `undefined` and threw on transcript.length (incoherent question/invite regen).
  return { last, turnHint, systemPrompt, messages, transcript };
}

// Per-session thinking control for the STUDENT reply call only. session.thinkingMode
// is 'on' | 'off' (default 'off'); 'on' re-enables M3's reasoning block for the
// reply (quality > latency), 'off' keeps it disabled. The coherence/anti-loop regen
// calls deliberately keep the default (disabled) — they never read this.
function studentSampling(session) {
  const thinking = session?.thinkingMode === "on" ? { type: "adaptive" } : { type: "disabled" };
  return { ...STUDENT_SAMPLING, thinking };
}

// Anti-loop guard: a coherent reply still gets rejected if it is >0.8 similar to
// any of the last 6 student turns. Regenerate ONCE with REPEAT_NOTE; if still too
// similar, fall back to a short move-forward acknowledgement (neutral emotion).
// transcript already includes the counsellor's latest message as its final turn.
async function guardLoop({ text, emotion }, { systemPrompt, transcript }) {
  if (maxLoopSimilarity(text, transcript) <= REPEAT_SIM_THRESHOLD) return { text, emotion };

  const retryRaw = await chat(
    [{ role: "system", content: systemPrompt + REPEAT_NOTE }, ...transcriptToMessages(transcript)],
    STUDENT_SAMPLING,
  );
  const retry = parseEmotion(retryRaw);
  console.warn(`[engine] looping reply regenerated: "${text}" -> "${retry.text}"`);

  if (!retry.text || structurallyBroken(retry.text) || maxLoopSimilarity(retry.text, transcript) > REPEAT_SIM_THRESHOLD) {
    return { text: LOOP_FALLBACK_LINE, emotion: "neutral" };
  }
  return retry;
}

// Runs the coherence gate on an already-parsed reply ({ text, emotion }).
// Returns the canonical { text, emotion } (gated/substituted). On a substitution,
// emotion defaults to neutral. transcript/systemPrompt are needed for the single
// question/invite regeneration.
async function gateReply({ text, emotion }, { last, turnHint, systemPrompt, transcript }) {
  if (await makesSense(last?.text || "", text)) {
    return guardLoop({ text, emotion }, { systemPrompt, transcript });
  }

  if (turnHint === "question" || turnHint === "invite") {
    // ONE regeneration with the REGEN_NOTE appended to the same system prompt.
    const retryRaw = await chat(
      [{ role: "system", content: systemPrompt + REGEN_NOTE }, ...transcriptToMessages(transcript)],
      STUDENT_SAMPLING,
    );
    const retry = parseEmotion(retryRaw);
    console.warn(`[engine] incoherent ${turnHint} reply regenerated: "${text}" -> "${retry.text}"`);
    if (structurallyBroken(retry.text) || !retry.text) {
      return { text: DOUBLE_FAILURE_LINE, emotion: "neutral" };
    }
    // A coherent regeneration can still be a near-verbatim repeat — run it through
    // the anti-loop guard before accepting (#21).
    return guardLoop(retry, { systemPrompt, transcript });
  }

  // Statement turn -> rotating canned Hinglish acknowledgement (neutral emotion).
  const ack = FALLBACK_ACKS[ackRotation++ % FALLBACK_ACKS.length];
  console.warn(`[engine] incoherent statement reply replaced: "${text}" -> "${ack}"`);
  return { text: ack, emotion: "neutral" };
}

// Non-streaming student reply. transcript already includes the counsellor's
// latest message as the final turn. Returns { text, emotion } where text is
// the SPOKEN text (emotion tag stripped) and emotion is the parsed/defaulted tint.
export async function getStudentReply(session) {
  const ctx = prepareReply(session);
  const raw = await chat(ctx.messages, studentSampling(session));
  const parsed = parseEmotion(raw);
  return gateReply(parsed, ctx);
}

// Streaming student reply for the SSE path. Yields RAW tokens as they arrive
// (so the client can render perceived-latency text), then RETURNS the CANONICAL
// { text, emotion, raw } after the coherence gate. The canonical reply can differ
// from the streamed tokens (gate may substitute/regenerate) — callers must swap
// in the returned value. The trailing [emotion:X] tag is re-attached on the
// canonical reply via withEmotion().
export async function* getStudentReplyStream(session) {
  const ctx = prepareReply(session);
  let buf = "";
  for await (const tok of chatStream(ctx.messages, studentSampling(session))) {
    buf += tok;
    yield tok;
  }
  const parsed = parseEmotion(buf);
  const gated = await gateReply(parsed, ctx);
  // raw is the canonical spoken text with the emotion tag re-attached, kept for
  // any caller that wants the protocol-complete string.
  return { text: gated.text, emotion: gated.emotion, raw: withEmotion(gated.text, gated.emotion) };
}
