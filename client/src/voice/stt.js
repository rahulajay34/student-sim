import { pipeline } from "@huggingface/transformers";
import { hasWebGPU } from "./tts";

// whisper-tiny.en: 4x faster than base, ~150-300ms on WASM for short phrases.
const MODEL_ID = "onnx-community/whisper-tiny.en";

let _sttPromise = null;

export function loadSTT({ onProgress } = {}) {
  if (!_sttPromise) {
    _sttPromise = (async () => {
      const device = (await hasWebGPU()) ? "webgpu" : "wasm";
      const dtype = device === "webgpu" ? "fp32" : "q8";
      return pipeline("automatic-speech-recognition", MODEL_ID, {
        device,
        dtype,
        progress_callback: onProgress,
      });
    })();
  }
  return _sttPromise;
}

export async function transcribe(transcriber, float32) {
  const out = await transcriber(float32, { chunk_length_s: 30, stride_length_s: 5 });
  return (out?.text || "").trim();
}
