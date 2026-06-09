// Standalone proof that Kokoro TTS runs locally and produces real audio.
// Downloads the model on first run (cached afterwards) and writes a WAV you
// can play. Run: node scripts/tts-smoke.mjs
import { KokoroTTS } from "kokoro-js";
import fs from "node:fs";

const TEXT =
  "Hi! I'm really interested in your data analytics program, but honestly, the fees feel a bit high for me. Can you help me understand what I'd be getting?";

console.log("Loading Kokoro-82M (first run downloads ~80MB)...");
const t0 = Date.now();
// Node uses onnxruntime-node (cpu/dml only). The browser app uses webgpu/wasm.
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8",
  device: "cpu",
});
console.log(`Model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s. Synthesizing...`);

const t1 = Date.now();
const audio = await tts.generate(TEXT, { voice: "af_heart" });
const synthMs = Date.now() - t1;

const wav = audio.toWav();
const out = new URL("../voice-smoke.wav", import.meta.url);
fs.writeFileSync(out, Buffer.from(wav));

const seconds = audio.audio.length / audio.sampling_rate;
const rtf = synthMs / 1000 / seconds;
console.log(
  `OK: wrote voice-smoke.wav (${fs.statSync(out).size} bytes, ${seconds.toFixed(
    1
  )}s of audio @ ${audio.sampling_rate}Hz).`
);
console.log(
  `Synthesis took ${(synthMs / 1000).toFixed(1)}s on CPU/wasm (real-time factor ${rtf.toFixed(
    2
  )}x). WebGPU in the browser will be faster.`
);
