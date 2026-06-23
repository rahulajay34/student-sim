// _shared/lib/engine.js — ported from server/engine.js.
// CHANGES:
//   - Import paths updated to local ./llm.js and ./prompt.js, ./classify.js.
//   - No process.env usage — no change needed.

import { chat, chatStream, STUDENT_SAMPLING, DETERMINISTIC_SAMPLING } from "./llm.js";
import { buildSystemPrompt, buildSystemPromptParts, computeConvincementHint } from "./prompt.js";
import { classifyCounsellorTurn } from "./classify.js";

const EMOTION_TAG_RE = /\[emotion:\s*([a-z ]{0,30})\]/gi;
const VALID_EMOTIONS = new Set(["neutral", "happy", "hesitant", "worried", "frustrated", "excited"]);

export function parseEmotion(raw) {
  let emotion = "neutral";
  let firstCapture = null;

  const text = String(raw).replace(EMOTION_TAG_RE, (_match, val) => {
    if (firstCapture === null) firstCapture = val.trim().toLowerCase();
    return " ";
  }).replace(/  +/g, " ").trim();

  if (firstCapture !== null && VALID_EMOTIONS.has(firstCapture)) {
    emotion = firstCapture;
  }

  return { text, emotion };
}

function withEmotion(text, emotion = "neutral") {
  const e = VALID_EMOTIONS.has(emotion) ? emotion : "neutral";
  return `${String(text).trim()} [emotion:${e}]`;
}

function transcriptToMessages(transcript) {
  const msgs = [];
  if (!Array.isArray(transcript)) return msgs;
  if (transcript.length > 0 && transcript[0].role === "student") {
    msgs.push({ role: "user", content: "Start the conversation. Please introduce yourself briefly." });
  }
  for (const t of transcript) {
    msgs.push({ role: t.role === "student" ? "assistant" : "user", content: t.text });
  }
  return msgs;
}

export async function getFirstMessage(persona, scenario, course, flavour = null) {
  const systemParts = buildSystemPromptParts(persona, scenario, 1, 50, course, null, flavour, null, null, null, null);
  const raw = await chat([
    {
      role: "user",
      content:
        "Start the conversation. Your very first message must be only a self-introduction of 2-3 sentences. Improvise it fresh in your own words from your real facts (your name, what you do or study, your city, and why you took the test) — never a rehearsed-sounding script, and phrase it differently than a generic intro would. Nothing else.",
    },
  ], { ...STUDENT_SAMPLING, mode: "fast", systemParts });
  return parseEmotion(raw);
}

const WORD_LOOP_RE = /(\b\w+(?:\s+\w+)?\b)(?:[,.\s]+\1\b){2,}/i;
const RUNAWAY_WORD_CAP = 150;
export function structurallyBroken(text) {
  return WORD_LOOP_RE.test(text) || text.split(/\s+/).filter(Boolean).length > RUNAWAY_WORD_CAP;
}

const COHERENCE_TIMEOUT_MS = 8_000;

async function makesSense(counsellorMsg, replyText) {
  if (structurallyBroken(replyText)) return false;
  try {
    const verdict = await chat([{
      role: "user",
      content: `You are checking one line of dialogue from a phone call between a course counsellor and a student. Hinglish, casual grammar and very short replies like "haan sir" are all NORMAL and valid.

Counsellor said: "${counsellorMsg}"
Student replied: "${replyText}"

Is the student's reply coherent and logically sensible as a response (not garbled, not half-finished nonsense, not answering something never asked)? Reply with exactly one word: VALID or INVALID.`,
    }], { ...DETERMINISTIC_SAMPLING, mode: "fast", timeoutMs: COHERENCE_TIMEOUT_MS, maxRetries: 0 });
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

const REPEAT_SIM_THRESHOLD = 0.8;
const REPEAT_LOOKBACK = 6;

function normalizeForSim(text) {
  return String(text)
    .replace(EMOTION_TAG_RE, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loopSimilarity(a, b) {
  const ta = new Set(normalizeForSim(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeForSim(b).split(" ").filter(Boolean));
  if (ta.size < 4 || tb.size < 4) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

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

const LOOP_FALLBACK_LINE = "Right sir, I hear you. Let me think about that and let's move ahead.";

function ensureNonEmpty({ text, emotion }) {
  if (typeof text === "string" && text.trim()) return { text, emotion };
  console.warn("[engine] empty reply after gating — substituting fallback line");
  return { text: DOUBLE_FAILURE_LINE, emotion: "neutral" };
}

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

  const systemParts = buildSystemPromptParts(
    personaSnapshot, scenarioSnapshot, currentPhase, satisfactionScore, courseSnapshot,
    turnHint, personalityFlavour, convincementHint, objectionState, turnVerbosity, lastAdjustment, session,
  );
  const systemPrompt = buildSystemPrompt(
    personaSnapshot, scenarioSnapshot, currentPhase, satisfactionScore, courseSnapshot,
    turnHint, personalityFlavour, convincementHint, objectionState, turnVerbosity, lastAdjustment, session,
  );
  const messages = transcriptToMessages(transcript);
  return { last, turnHint, systemPrompt, systemParts, messages, transcript };
}

function studentSampling(session) {
  const on = session?.thinkingMode === "on";
  return { ...STUDENT_SAMPLING, mode: on ? "reasoning" : "fast" };
}

async function guardLoop({ text, emotion }, { systemPrompt, transcript }) {
  if (maxLoopSimilarity(text, transcript) <= REPEAT_SIM_THRESHOLD) return { text, emotion };

  const retryRaw = await chat(
    [{ role: "system", content: systemPrompt + REPEAT_NOTE }, ...transcriptToMessages(transcript)],
    { ...STUDENT_SAMPLING, mode: "fast" },
  );
  const retry = parseEmotion(retryRaw);
  console.warn(`[engine] looping reply regenerated: "${text}" -> "${retry.text}"`);

  if (!retry.text || structurallyBroken(retry.text) || maxLoopSimilarity(retry.text, transcript) > REPEAT_SIM_THRESHOLD) {
    return { text: LOOP_FALLBACK_LINE, emotion: "neutral" };
  }
  return retry;
}

async function gateReply({ text, emotion }, { last, turnHint, systemPrompt, transcript }) {
  if (await makesSense(last?.text || "", text)) {
    return guardLoop({ text, emotion }, { systemPrompt, transcript });
  }

  if (turnHint === "question" || turnHint === "invite") {
    const retryRaw = await chat(
      [{ role: "system", content: systemPrompt + REGEN_NOTE }, ...transcriptToMessages(transcript)],
      { ...STUDENT_SAMPLING, mode: "fast" },
    );
    const retry = parseEmotion(retryRaw);
    console.warn(`[engine] incoherent ${turnHint} reply regenerated: "${text}" -> "${retry.text}"`);
    if (structurallyBroken(retry.text) || !retry.text) {
      return { text: DOUBLE_FAILURE_LINE, emotion: "neutral" };
    }
    return guardLoop(retry, { systemPrompt, transcript });
  }

  const ack = FALLBACK_ACKS[ackRotation++ % FALLBACK_ACKS.length];
  console.warn(`[engine] incoherent statement reply replaced: "${text}" -> "${ack}"`);
  return { text: ack, emotion: "neutral" };
}

// Usage/cost meta for the student-reply LLM call (recorded by the llm.js sink).
function studentUsage(session) {
  return {
    feature: "student_reply",
    sessionId: session.id || null,
    counsellorId: session.counsellorId || null,
    personaLabel: session.personaSnapshot?.label || null,
  };
}

export async function getStudentReply(session) {
  const ctx = prepareReply(session);
  const raw = await chat(ctx.messages, { ...studentSampling(session), systemParts: ctx.systemParts, usage: studentUsage(session) });
  const parsed = parseEmotion(raw);
  return ensureNonEmpty(await gateReply(parsed, ctx));
}

export async function* getStudentReplyStream(session) {
  const ctx = prepareReply(session);
  let buf = "";
  for await (const tok of chatStream(ctx.messages, { ...studentSampling(session), systemParts: ctx.systemParts, usage: studentUsage(session) })) {
    buf += tok;
    yield tok;
  }
  const parsed = parseEmotion(buf);
  const gated = ensureNonEmpty(await gateReply(parsed, ctx));
  return { text: gated.text, emotion: gated.emotion, raw: withEmotion(gated.text, gated.emotion) };
}
