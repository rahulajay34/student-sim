// Voice catalog for the single (OpenAI Realtime) engine.
//
// The platform now runs ONE voice engine: OpenAI Realtime speech-to-speech.
// This module is what survived the consolidation — it carries only the OpenAI
// voice catalog (for the green-room + in-call voice picker) plus the persisted
// default-voice preference. The old 3-way engine toggle and the two legacy
// pipelines (and their constants/storage keys) are gone.

// OpenAI Realtime voices (audition any live from the in-call control). marin/cedar
// are the newest gpt-realtime voices and sound the most natural. All are
// American/British base, instructed to speak natural Indian English. "auto"
// gender-matches (female→Marin, male→Cedar) from the student's profile.
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

export const OPENAI_VOICE_STORAGE_KEY = "mct_openai_voice";

export function loadStoredOpenAIVoice() {
  try {
    const v = localStorage.getItem(OPENAI_VOICE_STORAGE_KEY);
    return OPENAI_VOICES.some((o) => o.id === v) ? v : DEFAULT_OPENAI_VOICE;
  } catch { return DEFAULT_OPENAI_VOICE; }
}
