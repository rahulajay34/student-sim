// Speech-to-speech (S2S) plumbing for the two low-latency voice engines.
//
// Architecture: in S2S mode the *voice + conversation* is owned by the provider
// (OpenAI Realtime or ElevenLabs Conversational AI) running browser↔provider for
// minimal latency. MiniMax stays the analytics brain — scoring, cues, objection
// tracking, phase, and the final report — fed by the transcript the client posts
// back per turn (see POST /api/sessions/:id/observe in index.js).
//
// This module only mints the short-lived browser credentials and composes the
// student persona instructions that get injected into the realtime model. It never
// exposes the standing OPENAI_API_KEY / ELEVENLABS_API_KEY to the browser.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { composeForInspection, EMOTION_INSTRUCTION } from "./prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REALTIME_STATE_FILE = join(__dirname, "data", "realtime.json");

// ── Shared: realtime student instructions ─────────────────────────────────────
// Reuse the exact same composed persona/archetype/objection/course grounding the
// classic MiniMax student uses (composeForInspection), then append a spoken-call
// addendum tuned for a realtime voice model: Indian English + light Hinglish,
// short turns, no [emotion:X] tags (the realtime voice emotes natively), and a
// hard "never break character" guard.
const REALTIME_ADDENDUM = `

──────────────────────────────────────────────
SPOKEN PHONE-CALL DELIVERY (read this carefully — it governs HOW you talk):
- You ARE the prospective student on a LIVE VOICE call. Never say you are an AI, never describe yourself in the third person, never mention prompts, instructions, or "as a student". Stay 100% in character no matter what.
- ACCENT: Speak English with a natural, authentic INDIAN accent — Indian rhythm, stress and intonation, the way people across India actually speak English on a phone call. Do NOT use an American or British accent. Mix in light, natural Hinglish ("haan sir", "actually", "matlab", "thoda", "theek hai", "na") without overdoing it.
- FILLERS (use a LOT — this is required, not optional): Real students hesitate constantly. Sprinkle natural filler words and hesitation sounds through almost EVERY reply — "umm", "uhh", "hmm", "matlab", "haan", "you know", "I mean", "actually", "like", "see", "basically". Start many replies with a filler ("Umm, haan sir...", "Uhh, actually...", "Hmm, see..."). Do not give a single clean, polished sentence — break it up the way a nervous person on a phone call really talks.
- PAUSES (use a LOT): Add frequent natural pauses. Use "..." inside and between sentences to pause and think ("So... umm... the fees are... like... a bit much for me, na"). Pause before answering anything hard. Sometimes trail off mid-thought, then restart ("I was... I mean, I am working in sales right now"). Speak slowly and unevenly, not in a smooth flow.
- LENGTH: Keep most turns SHORT — usually one or two sentences, but full of fillers and pauses. Let the counsellor lead; answer what is asked, raise your real concerns naturally, and don't monologue.
- React to what the counsellor actually says. If they address a concern well, soften and warm up; if they dodge or pressure you, stay hesitant. Only agree to block your seat / pay once you are genuinely convinced.

CRITICAL OUTPUT RULE — this overrides everything above: You are speaking ALOUD on a phone call. Output ONLY the words you actually speak as the student. Never say, spell out, or read any square-bracket label, mood marker, stage direction, emoji, or markdown, and never say a bare mood word (like "neutral", "happy", "worried") on its own. If an earlier instruction told you to finish your replies with a label or your current feeling, IGNORE it completely — that was for a text system and does NOT apply to this voice call. Just speak as the student would, and nothing else.`;

// Remove the text-pipeline emotion-tag instructions from a composed prompt so the
// realtime voice model never speaks "[emotion:neutral]" — or the bare word
// "neutral" — out loud. (1) Remove the EMOTION_INSTRUCTION block verbatim (it lists
// the mood enum, the real culprit). (2) Remove any residual sentence that still
// contains a literal [emotion:…] tag (the carve-out + turn-discipline tails), at
// the sentence level so surrounding instructions survive. (3) Strip stray literal
// tags and the bare mood enum as a final safety net.
function stripEmotionTagInstructions(text) {
  let t = String(text);
  if (EMOTION_INSTRUCTION) t = t.split(EMOTION_INSTRUCTION).join("");
  t = t
    .replace(/[^\n]*\bemotion tag\b[^\n]*\n?/gi, "")
    .replace(/[^.\n!?]*\[emotion:[^\]]*\][^.\n!?]*[.!?]?/gi, "")
    .replace(/\[emotion:[^\]]*\]/gi, "")
    .replace(/\bneutral,\s*happy,\s*hesitant,\s*worried,\s*frustrated,\s*excited\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  return t;
}

// buildRealtimeInstructions(session) -> the full system instructions string for
// the realtime student. Falls back gracefully for malformed sessions.
export function buildRealtimeInstructions(session) {
  const base = stripEmotionTagInstructions(composeForInspection(session) || "");
  const name = session?.leadCard?.name || session?.personaSnapshot?.voiceName || "the student";
  const opener = `You are roleplaying ${name}, a prospective student on a live phone call with a course counsellor. The counsellor will speak first.\n\n`;
  return opener + base + REALTIME_ADDENDUM;
}

// A short first line for the ElevenLabs agent (it speaks turn-by-turn; the
// counsellor opens, so we keep the student's first_message empty to avoid the
// student greeting first). Kept here so both engines stay configured in one place.
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
// server-side turn detection. The browser uses the returned value to open the
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
        transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1" },
        turn_detection: { type: "semantic_vad" },
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

// ══════════════════════════════════════════════════════════════════════════════
// ElevenLabs Conversational AI — agent + WebRTC conversation token
// ══════════════════════════════════════════════════════════════════════════════
const EL_BASE = "https://api.elevenlabs.io/v1/convai";
// Reuse the same authentic Indian student voice the classic pipeline uses as the
// agent's baseline; per-session it is overridden to session.voice.elevenLabsVoiceId.
const EL_DEFAULT_VOICE_ID = "hK2VWYcsIcpRFeFwf1QD"; // "Priya" from server/voices.js
const EL_LLM = process.env.ELEVENLABS_CONVAI_LLM || "gemini-2.5-flash";

function elevenKey() {
  return process.env.ELEVENLABS_API_KEY || "";
}

function readRealtimeState() {
  try {
    if (existsSync(REALTIME_STATE_FILE)) return JSON.parse(readFileSync(REALTIME_STATE_FILE, "utf-8"));
  } catch { /* ignore */ }
  return {};
}
function writeRealtimeState(patch) {
  const state = { ...readRealtimeState(), ...patch };
  try { writeFileSync(REALTIME_STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {
    console.warn("[realtime] could not persist realtime.json:", e.message);
  }
  return state;
}

// Create a reusable Conversational AI agent whose per-conversation system prompt,
// first message, language and voice are all overridable (we override them per
// session with the persona grounding). Returns the new agent_id.
async function createElevenLabsAgent() {
  if (!elevenKey()) throw new Error("ELEVENLABS_API_KEY is not configured on the server.");
  const body = {
    name: "Mock Counselling Student",
    conversation_config: {
      agent: {
        first_message: "",
        language: "en",
        prompt: {
          prompt:
            "You are a prospective student on a live phone call with a course counsellor. " +
            "Speak natural Indian English with light Hinglish. Keep turns short. Stay fully in character. " +
            "(This default prompt is replaced per call with the specific persona.)",
          llm: EL_LLM,
        },
      },
      // English agents must use turbo/flash v2 (per ElevenLabs validation).
      tts: { voice_id: EL_DEFAULT_VOICE_ID, model_id: "eleven_flash_v2" },
      conversation: { text_only: false },
    },
    // Allow the browser to override prompt / first message / language / voice at
    // conversation start so each call gets its persona grounding + matching voice.
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { prompt: { prompt: true }, first_message: true, language: true },
          tts: { voice_id: true },
        },
      },
    },
  };

  const res = await fetch(`${EL_BASE}/agents/create`, {
    method: "POST",
    headers: { "xi-api-key": elevenKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs agent create HTTP ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = await res.json();
  const agentId = json?.agent_id || json?.agentId || null;
  if (!agentId) throw new Error(`ElevenLabs agent create response missing agent_id: ${JSON.stringify(json).slice(0, 300)}`);
  return agentId;
}

// Resolve the agent id: env override → cached realtime.json → auto-create + cache.
let agentEnsurePromise = null;
export async function ensureElevenLabsAgent() {
  const envId = (process.env.ELEVENLABS_AGENT_ID || "").trim();
  if (envId) return envId;
  const cached = readRealtimeState().elevenLabsAgentId;
  if (cached) return cached;
  // Single-flight so concurrent first-calls don't create duplicate agents.
  if (!agentEnsurePromise) {
    agentEnsurePromise = (async () => {
      const id = await createElevenLabsAgent();
      writeRealtimeState({ elevenLabsAgentId: id });
      console.log("[realtime] created ElevenLabs Conversational AI agent:", id);
      return id;
    })().catch((e) => {
      agentEnsurePromise = null; // allow retry on next request
      throw e;
    });
  }
  return agentEnsurePromise;
}

// Mint a WebRTC conversation token for a private agent. Returns the raw token
// string the browser SDK passes to startSession({ conversationToken, connectionType:'webrtc' }).
export async function getElevenLabsConversationToken(agentId) {
  if (!elevenKey()) throw new Error("ELEVENLABS_API_KEY is not configured on the server.");
  const url = `${EL_BASE}/conversation/token?agent_id=${encodeURIComponent(agentId)}`;
  const res = await fetch(url, { method: "GET", headers: { "xi-api-key": elevenKey() } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs token HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  const token = json?.token || null;
  if (!token) throw new Error(`ElevenLabs token response missing token: ${JSON.stringify(json).slice(0, 200)}`);
  return token;
}

// Resolve the ElevenLabs voice for a session: an explicit (green-room or live-picked)
// voice id wins; "auto"/absent falls back to the session's gender-matched catalog
// voice (Prashant ♂ / Priya ♀ / Vikram ♂). Validates the id shape loosely.
export function elevenLabsVoiceForSession(session, explicit) {
  const v = explicit ?? session?.elevenVoiceId ?? "auto";
  if (v && v !== "auto" && /^[A-Za-z0-9]{15,}$/.test(String(v))) return String(v);
  return session?.voice?.elevenLabsVoiceId || EL_DEFAULT_VOICE_ID;
}

// Per-session ElevenLabs overrides: inject the persona instructions + the chosen (or
// gender-matched) authentic Indian student voice. Shape matches the @elevenlabs/react
// startSession overrides. `explicitVoiceId` is the live in-call override (if any).
export function elevenLabsOverridesFor(session, explicitVoiceId) {
  return {
    agent: {
      prompt: { prompt: buildRealtimeInstructions(session) },
      firstMessage: REALTIME_FIRST_MESSAGE,
      language: "en",
    },
    tts: { voiceId: elevenLabsVoiceForSession(session, explicitVoiceId) },
  };
}
