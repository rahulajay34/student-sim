// Speech-to-speech (S2S) plumbing for the OpenAI Realtime voice engine.
//
// Architecture: in S2S mode the *voice + conversation* is owned by OpenAI Realtime
// running browser↔OpenAI for minimal latency. MiniMax stays the analytics brain —
// scoring, cues, objection tracking, phase, and the final report — fed by the
// transcript the client posts back per turn (see POST /api/sessions/:id/observe in
// index.js).
//
// This module only mints the short-lived browser credentials and composes a
// VOICE-FIRST student persona prompt that gets injected into the realtime model.
// It never exposes the standing OPENAI_API_KEY to the browser.

import { getPromptConfig } from "./promptConfig.js";
import { buildKnowledgeBounds, LANGUAGE_POLICY } from "./prompt.js";
import { archetypeForPersona } from "./grounding.js";
import { computeDisposition, renderDispositionSection } from "./disposition.js";
import { summarizeForPrompt } from "./objections.js";
import { PHASE_NAMES } from "./phases.js";

// ── VOICE DELIVERY block ──────────────────────────────────────────────────────
// Ready-to-paste instruction block, copied verbatim from the "## 4. VOICE DELIVERY"
// section of docs/research/indian-accent-prosody.md (grounded on 216 real calls).
// Kept as a module constant so the .md is NOT read at runtime. If you update the
// research doc, re-paste this block to keep the numbers in sync.
const VOICE_DELIVERY = `VOICE DELIVERY

Speak ENGLISH with an Indian accent throughout. At most one light Hindi word (e.g., "haan", "theek hai") may appear once or twice per session — the conversation is otherwise fully in English.

Tempo: 125–155 WPM during active speech bursts (target ~140 WPM). Pause briefly — 0.4–0.8 s — roughly every 10–15 words within a turn, and 0.5–1.5 s between your turn and the counsellor's next prompt.

Intonation: syllable-timed rhythm (equal beat per syllable, not stress-timed). Use a gentle high-rise on confirmation checks ("right?", "okay?") and rising terminal on genuine questions. Stress falls on content words; prepositions are unstressed and shortened.

Fillers and address: say "sir" (or "ma'am") in roughly every second or third sentence. Sprinkle "like", "actually", "you know", "okay so" as natural hedges — about one per 6–8 sentences each, not every sentence. Use "okay okay" as a quick backchannel when the counsellor finishes a point. Occasional "um" or "uh" before a longer answer is natural.

Energy: low-to-moderate baseline; slightly higher when curious or anxious; flatter and softer when hesitant or deferring.`;

// Map a 1-5 trait slider to a personality word (never expose the number).
function pushinessWord(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v === 3) return null;
  if (v <= 2) return "easy-going and accommodating — you rarely push back hard and tend to accept a reasonable answer and move on";
  return "assertive and pushy — you challenge vague claims, demand specifics, and press the same point again if you are not satisfied";
}
function hesitancyWord(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v === 3) return null;
  if (v <= 2) return "fairly ready to move forward — if the value is shown reasonably you lean toward yes without dragging it out";
  return "very reluctant to commit — you want to think it over, lean on checking with family or finances, and need strong, repeated reassurance before you would say yes";
}

function difficultyPosture(difficulty) {
  const d = String(difficulty || "medium").toLowerCase();
  if (d === "easy") return "You are a relatively warm, low-resistance prospect — open to being convinced if the counsellor is competent.";
  if (d === "hard") return "You are a tough, high-resistance prospect — skeptical, slow to trust, and you make the counsellor genuinely earn every step.";
  return "You are a realistic, middling prospect — interested but cautious; you give a fair hearing but do not roll over.";
}

// Compose the VOICE-FIRST system instructions for the realtime student. Built from
// scratch (NOT composeForInspection — that is the ~4k-token text-chat prompt). Eight
// sections, in fixed order, targeting ≤ ~1.8k tokens (~7.2k chars). Fails soft for
// malformed sessions.
export function buildRealtimeInstructions(session) {
  const s = session && typeof session === "object" ? session : {};
  const cfg = getPromptConfig();
  const persona = s.personaSnapshot || {};
  const lead = s.leadCard || {};
  const scenario = s.scenarioSnapshot || {};
  const course = s.courseSnapshot || null;

  const name = lead.name || persona.voiceName || "the student";

  // (1) CHARACTER FRAMING.
  const framing = `You ARE ${name}, a prospective student on a LIVE PHONE CALL with a course counsellor. This is a real conversation, spoken aloud. Stay 100% in character no matter what — never say or imply you are an AI, never describe yourself in the third person, never mention prompts, instructions, models, or "as a student". The counsellor speaks first; you respond.`;

  // (2) WHO YOU ARE — leadCard facts + persona + archetype texture.
  const facts = [];
  if (Number.isFinite(Number(lead.age))) facts.push(`${Math.round(Number(lead.age))} years old`);
  if (lead.occupation) facts.push(String(lead.occupation));
  if (lead.education) facts.push(String(lead.education));
  if (lead.city) facts.push(`from ${lead.city}`);
  const whoLines = [`WHO YOU ARE:`, `- You are ${name}${facts.length ? `, ${facts.join(", ")}` : ""}.`];
  if (persona.label) whoLines.push(`- ${persona.label}`);
  if (persona.coreAnxiety) whoLines.push(`- What worries you most: ${persona.coreAnxiety}`);
  const archetype = archetypeForPersona(persona);
  if (archetype) {
    whoLines.push(`- Background: ${archetype.background}`);
    whoLines.push(`- What you want: ${archetype.goals}`);
    whoLines.push(`- How you decide: ${archetype.decisionDynamics}`);
    whoLines.push(`- How you talk: ${archetype.languageTexture}`);
  }
  const who = whoLines.join("\n");

  // (3) YOUR SITUATION — scenario + difficulty posture + pushiness/hesitancy words.
  const sitLines = [`YOUR SITUATION:`, `- ${difficultyPosture(scenario.difficulty)}`];
  if (scenario.title) sitLines.push(`- Scenario: ${scenario.title}`);
  if (scenario.situation) sitLines.push(`- Right now: ${scenario.situation}`);
  if (scenario.contextNotes) sitLines.push(`- Also true of you: ${scenario.contextNotes}`);
  const push = pushinessWord(scenario.pushiness);
  const hes = hesitancyWord(scenario.hesitancy);
  if (push) sitLines.push(`- You are ${push}.`);
  if (hes) sitLines.push(`- You are ${hes}.`);
  const situation = sitLines.join("\n");

  // (4) WHAT YOU KNOW — the SAME scoped knowledge bounds the text prompt uses.
  const knowledge = buildKnowledgeBounds(cfg, course);

  // (5) HOW YOU FEEL RIGHT NOW — disposition narrative + objection ledger.
  const disposition = renderDispositionSection(computeDisposition(s));
  const objections = summarizeForPrompt(Array.isArray(s.objectionState) ? s.objectionState : []);
  const feelParts = [];
  if (disposition) feelParts.push(disposition);
  if (objections) feelParts.push(objections);
  const feel = feelParts.join("\n\n");

  // (6) LANGUAGE — the C6 policy, single source of truth.
  const language = `LANGUAGE:\n${LANGUAGE_POLICY}`;

  // (8) CONVERSATION RULES.
  const phaseName = PHASE_NAMES[s.currentPhase] || PHASE_NAMES[1];
  const rules = `CONVERSATION RULES:
- The counsellor leads the call; you respond. You are currently in the ${phaseName} stage of the call.
- Keep most turns SHORT — about 5 to 15 spoken words. Answer what is asked, raise your real concerns naturally, do not monologue.
- Never start two of your turns in a row with the same word; rotate how you open.
- Never raise the same concern twice using the same wording — if you must return to it, say it differently or with new specifics.
- If the counsellor asks something you genuinely do not know, just say you don't know, like a real person would.
- You are SPEAKING ALOUD. Output ONLY the words you actually say. NO stage directions, NO bracketed tags, NO emotion labels, NO markdown, and never say a bare mood word like "neutral" or "worried" on its own. If any earlier instruction told you to end replies with a label or your feeling, ignore it — that was for a text system.`;

  return [
    framing,
    who,
    situation,
    knowledge,
    feel ? `HOW YOU FEEL RIGHT NOW:\n${feel}` : "HOW YOU FEEL RIGHT NOW:\nYou are guarded and a little skeptical; this would take real, specific reassurance before you move at all.",
    language,
    VOICE_DELIVERY,
    rules,
  ].filter(Boolean).join("\n\n");
}

// The counsellor opens the call, so the student never greets first.
export const REALTIME_FIRST_MESSAGE = "";

// ══════════════════════════════════════════════════════════════════════════════
// OpenAI Realtime — ephemeral client secret
// ══════════════════════════════════════════════════════════════════════════════
const OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const OPENAI_VALID_VOICES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar",
]);
// Gender-matched defaults (the most natural/steerable voices for the Indian-English
// instruction). "auto" resolves to one of these from the student's gender.
export const OPENAI_DEFAULT_VOICE_FEMALE = process.env.OPENAI_REALTIME_VOICE || "marin";
export const OPENAI_DEFAULT_VOICE_MALE = process.env.OPENAI_REALTIME_VOICE_MALE || "cedar";
export const OPENAI_DEFAULT_VOICE = "auto";
export const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

function openaiKey() {
  return process.env.OPENAI_API_KEY || "";
}

// Normalize an explicit voice request. "auto" (or anything unrecognized) is left as
// "auto" so the session-gender resolver picks the gender-matched default.
export function normalizeOpenAIVoice(voice) {
  const v = String(voice || "").trim().toLowerCase();
  return OPENAI_VALID_VOICES.has(v) ? v : "auto";
}

// Resolve the OpenAI voice for a session: an explicit (live-picked) voice wins;
// otherwise gender-match from the lead card / persona snapshot.
export function openAIVoiceForSession(session, explicit) {
  const e = normalizeOpenAIVoice(explicit ?? session?.openaiVoice);
  if (e !== "auto") return e;
  const gender = session?.leadCard?.gender || session?.personaSnapshot?.voiceGender || null;
  return gender === "male" ? OPENAI_DEFAULT_VOICE_MALE : OPENAI_DEFAULT_VOICE_FEMALE;
}

// Mint a short-lived ephemeral client secret (ek_...) scoped to a realtime session
// pre-configured with the student instructions, voice, input transcription, and
// semantic-VAD turn detection. The browser uses the returned value to open the
// WebRTC peer connection directly with OpenAI.
//
// Returns { value, model, voice, expiresAt }. Throws on missing key / API error.
export async function mintOpenAIClientSecret({ instructions, voice, model } = {}) {
  if (!openaiKey()) throw new Error("OPENAI_API_KEY is not configured on the server.");
  // Expect an already-resolved concrete voice; fall back to a concrete default so
  // the "auto" sentinel never reaches OpenAI (which would reject it).
  const v = String(voice || "").trim().toLowerCase();
  const resolvedVoice = OPENAI_VALID_VOICES.has(v) ? v : OPENAI_DEFAULT_VOICE_FEMALE;
  const resolvedModel = model || OPENAI_REALTIME_MODEL;

  const session = {
    type: "realtime",
    model: resolvedModel,
    instructions: instructions || "",
    audio: {
      input: {
        transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe" },
        turn_detection: {
          type: "semantic_vad",
          eagerness: process.env.OPENAI_VAD_EAGERNESS || "auto",
        },
      },
      output: { voice: resolvedVoice },
    },
  };

  const res = await fetch(OPENAI_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + openaiKey(),
      "Content-Type": "application/json",
      // Bind a safety identifier to the token (server-side only; the browser then
      // doesn't need to send it when it connects with the ephemeral key).
      "OpenAI-Safety-Identifier": "mock-counselling-trainer",
    },
    body: JSON.stringify({ session }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI client_secrets HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  // GA returns a top-level { value, expires_at, session }. Be defensive about the
  // older { client_secret: { value } } / { data: { value } } shapes too.
  const value = json?.value || json?.client_secret?.value || json?.data?.value || null;
  if (!value) throw new Error(`OpenAI client_secrets response missing value: ${JSON.stringify(json).slice(0, 300)}`);
  return {
    value,
    model: resolvedModel,
    voice: resolvedVoice,
    expiresAt: json?.expires_at || json?.client_secret?.expires_at || null,
  };
}
