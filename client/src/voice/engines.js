// Shared voice-engine constants for the 3-way toggle (Classic / OpenAI Realtime /
// ElevenLabs). Used by the GreenRoom selector, the in-call CallStage controls, and
// Session wiring. The selection is remembered in localStorage between calls.

export const ENGINE_CLASSIC = "classic";
export const ENGINE_OPENAI = "openai";
export const ENGINE_ELEVENLABS = "elevenlabs";

export const VOICE_ENGINES = [
  {
    id: ENGINE_CLASSIC,
    label: "Classic",
    short: "STT → MiniMax → TTS",
    desc: "The original pipeline. Works offline; authentic Indian student voices. Highest latency.",
  },
  {
    id: ENGINE_OPENAI,
    label: "OpenAI Realtime",
    short: "Speech-to-speech",
    desc: "Lowest latency. American-base voices instructed to speak Indian English + light Hinglish.",
  },
  {
    id: ENGINE_ELEVENLABS,
    label: "ElevenLabs",
    short: "Speech-to-speech",
    desc: "Low latency with authentic Indian voices (same voice as Classic for this student).",
  },
];

export function isS2SEngine(engine) {
  return engine === ENGINE_OPENAI || engine === ENGINE_ELEVENLABS;
}

// OpenAI Realtime voices (audition any live from the in-call control). marin/cedar
// are the newest gpt-realtime voices and sound the most natural. All are
// American/British base, instructed to speak Indian English. "auto" gender-matches
// (female→Marin, male→Cedar) from the student's profile.
export const OPENAI_VOICES = [
  { id: "auto", label: "Auto (match student gender)", note: "♀ → Marin · ♂ → Cedar — recommended" },
  { id: "marin", label: "Marin", note: "Newest · natural · female-leaning" },
  { id: "cedar", label: "Cedar", note: "Newest · natural · male-leaning" },
  { id: "coral", label: "Coral", note: "Warm · friendly · female-leaning" },
  { id: "ash", label: "Ash", note: "Clear · measured · male-leaning" },
  { id: "alloy", label: "Alloy", note: "Neutral · balanced" },
  { id: "ballad", label: "Ballad", note: "Expressive · emotive" },
  { id: "echo", label: "Echo", note: "Calm · smooth · male-leaning" },
  { id: "sage", label: "Sage", note: "Soft · thoughtful" },
  { id: "shimmer", label: "Shimmer", note: "Bright · energetic · female-leaning" },
  { id: "verse", label: "Verse", note: "Versatile · expressive" },
];

export const DEFAULT_OPENAI_VOICE = "auto";

// ElevenLabs student voices — authentic Indian accents (your original catalog).
// "auto" gender-matches (Priya ♀ / Prashant ♂) from the student's profile.
export const ELEVENLABS_VOICES = [
  { id: "auto", label: "Auto (match student gender)", note: "Priya ♀ / Prashant ♂ — recommended" },
  { id: "hK2VWYcsIcpRFeFwf1QD", label: "Priya", note: "Female · Indian · warm" },
  { id: "khNT67c7kgWhlbNQynFY", label: "Prashant", note: "Male · Indian" },
  { id: "hczKB0VbXLcBTn17ShYS", label: "Vikram", note: "Male · Indian · deep" },
];
export const DEFAULT_ELEVEN_VOICE = "auto";

export const ENGINE_STORAGE_KEY = "mct_voice_engine";
export const OPENAI_VOICE_STORAGE_KEY = "mct_openai_voice";
export const ELEVEN_VOICE_STORAGE_KEY = "mct_eleven_voice";

export function loadStoredEngine() {
  try {
    const v = localStorage.getItem(ENGINE_STORAGE_KEY);
    return VOICE_ENGINES.some((e) => e.id === v) ? v : ENGINE_CLASSIC;
  } catch { return ENGINE_CLASSIC; }
}
export function loadStoredOpenAIVoice() {
  try {
    const v = localStorage.getItem(OPENAI_VOICE_STORAGE_KEY);
    return OPENAI_VOICES.some((o) => o.id === v) ? v : DEFAULT_OPENAI_VOICE;
  } catch { return DEFAULT_OPENAI_VOICE; }
}
export function loadStoredElevenVoice() {
  try {
    const v = localStorage.getItem(ELEVEN_VOICE_STORAGE_KEY);
    return ELEVENLABS_VOICES.some((o) => o.id === v) ? v : DEFAULT_ELEVEN_VOICE;
  } catch { return DEFAULT_ELEVEN_VOICE; }
}
