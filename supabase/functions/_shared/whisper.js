// Verbatim re-transcription via OpenAI Whisper (word-level timestamps).
//
// The Realtime transcript is "cleaned" (fillers/false-starts removed), so we
// re-transcribe the recorded counsellor audio with whisper-1 + verbose_json to
// recover un-cleaned text AND per-word timings. Reuses the existing OPENAI_API_KEY
// (never exposed to the browser). Edge-only (uses getEnv + fetch/FormData/File).

import { getEnv } from "./env.js";

const WHISPER_MODEL = "whisper-1"; // the model that returns word-level timestamps

/**
 * transcribeVerbatim(bytes, filename?) -> { text, words:[{word,start,end}], duration, language }
 * bytes: ArrayBuffer | Uint8Array of the audio file (webm/opus).
 * Throws on missing key / non-2xx.
 */
export async function transcribeVerbatim(bytes, filename = "call.webm") {
  const key = getEnv("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: "audio/webm" });
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: "audio/webm" }));
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  // English fluency assessment — bias the decoder to English so code-switching
  // doesn't produce transliterated noise.
  form.append("language", "en");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whisper ${res.status}: ${detail.slice(0, 300)}`);
  }
  const j = await res.json();
  return {
    text: typeof j.text === "string" ? j.text : "",
    words: Array.isArray(j.words) ? j.words : [],
    duration: Number(j.duration) || 0,
    language: j.language || null,
    model: WHISPER_MODEL,
  };
}
