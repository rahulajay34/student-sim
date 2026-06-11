// Text-to-speech via Kokoro-82M, running fully in the browser (kokoro-js +
// transformers.js, WebGPU with a wasm fallback). English voices, ~80-330MB
// model downloaded once then cached by the browser.
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

// ── Devanagari normalizer ─────────────────────────────────────────────────────
// Kokoro's English phonemizer cannot handle Devanagari (U+0900–U+097F) — it
// either garbles the output or throws.  Common Hinglish words that students
// emit are transliterated to their romanised equivalents; anything remaining
// in the Devanagari block is stripped entirely.
//
// Keep this list small and targeted — it covers the highest-frequency words
// seen in real counselling call transcripts.
const DEVANAGARI_MAP = {
  "हाँ": "haan",
  "हां": "haan",
  "नहीं": "nahi",
  "नही": "nahi",
  "ठीक": "theek",
  "है": "hai",
  "हैं": "hain",
  "क्या": "kya",
  "सर": "sir",
  "अच्छा": "accha",
  "मतलब": "matlab",
  "देखो": "dekho",
  "और": "aur",
  "या": "ya",
  "तो": "toh",
  "बहुत": "bahut",
  "कैसे": "kaise",
  "कितना": "kitna",
  "कितने": "kitne",
  "लेकिन": "lekin",
  "पर": "par",
  "मैं": "main",
  "आप": "aap",
  "हम": "hum",
  "वो": "wo",
  "यह": "yeh",
  "जी": "ji",
  "बस": "bas",
  "सोच": "soch",
  "रहा": "raha",
  "रही": "rahi",
  "हूँ": "hoon",
  "हूं": "hoon",
  "था": "tha",
  "थी": "thi",
  "भी": "bhi",
  "तक": "tak",
  "अभी": "abhi",
  "कब": "kab",
  "कहाँ": "kahan",
  "कहां": "kahan",
  "क्यों": "kyun",
  "कैसा": "kaisa",
  "कुछ": "kuch",
};

// Devanagari Unicode block: U+0900–U+097F.
const DEVANAGARI_RANGE = /[ऀ-ॿ]+/g;

/**
 * Normalise `text` so it contains no Devanagari before passing to the English
 * phonemizer.  Known Hinglish words are transliterated; remaining Devanagari
 * clusters are stripped.  Returns the cleaned string (may be empty — callers
 * must guard against empty input before synthesising).
 */
export function normalizeDevanagari(text) {
  // Replace known words first (longest match isn't needed — the map covers
  // whole word forms; simple sequential replacement is fine).
  let result = text;
  for (const [devanagari, roman] of Object.entries(DEVANAGARI_MAP)) {
    result = result.replaceAll(devanagari, roman);
  }
  // Strip any remaining Devanagari characters.
  result = result.replace(DEVANAGARI_RANGE, "");
  // Collapse any double-spaces left by stripped clusters.
  result = result.replace(/  +/g, " ").trim();
  return result;
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_VOICE = "af_heart"; // female, American — highest-rated

let _ttsPromise = null;

export async function hasWebGPU() {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

// Loads the model once and reuses it for the lifetime of the page.
export function loadTTS({ onProgress } = {}) {
  if (!_ttsPromise) {
    _ttsPromise = (async () => {
      const device = (await hasWebGPU()) ? "webgpu" : "wasm";
      const dtype = device === "webgpu" ? "fp32" : "q8";
      return KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback: onProgress,
      });
    })();
  }
  return _ttsPromise;
}

// Streams synthesis sentence-by-sentence into the audio player so the first
// words play within a few hundred ms. Stops feeding the instant the player's
// epoch changes (barge-in or a newer reply superseding this one).
export async function streamSpeak(tts, text, { voice = DEFAULT_VOICE, player }) {
  const epoch = player.epoch;

  // Normalise away any Devanagari so the English phonemizer never sees it.
  const cleanText = normalizeDevanagari(String(text));
  if (!cleanText) return; // nothing left after stripping — skip synth

  // kokoro-js's stream() pushes text into a TextSplitterStream but never
  // closes it, so the last sentence is always held in the buffer and never
  // emitted. We create and close the splitter ourselves to flush every sentence.
  const splitter = new TextSplitterStream();
  splitter.push(cleanText);
  splitter.close();

  const stream = tts.stream(splitter, { voice });
  for await (const { audio } of stream) {
    if (player.epoch !== epoch) break; // interrupted
    player.enqueue(audio.audio, audio.sampling_rate);
  }
}
