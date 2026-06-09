// Text-to-speech via Kokoro-82M, running fully in the browser (kokoro-js +
// transformers.js, WebGPU with a wasm fallback). English voices, ~80-330MB
// model downloaded once then cached by the browser.
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

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

  // kokoro-js's stream() pushes text into a TextSplitterStream but never
  // closes it, so the last sentence is always held in the buffer and never
  // emitted. We create and close the splitter ourselves to flush every sentence.
  const splitter = new TextSplitterStream();
  splitter.push(text);
  splitter.close();

  const stream = tts.stream(splitter, { voice });
  for await (const { audio } of stream) {
    if (player.epoch !== epoch) break; // interrupted
    player.enqueue(audio.audio, audio.sampling_rate);
  }
}
