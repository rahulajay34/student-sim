// Sidecar client: routes TTS/STT/analyze to the local FastAPI voice server
// (http://localhost:3002). Falls back gracefully when the sidecar is down.

const BASE = "http://localhost:3002";

/** Cached result of the last probe. null = not yet probed. */
let probed = null;

/**
 * Return true when a capability status value indicates the sidecar can serve it.
 * "ready" = warmed up; "unloaded" = available, lazy-warms on first call (slow first time).
 */
export function capabilityReady(status) {
  return status === "ready" || status === "unloaded";
}

/**
 * Probe GET /health with a 1-second timeout.
 * Result is cached per session unless force=true.
 * Returns { ok, capabilities, ttsEngine, sttEngine } — on any error: { ok: false, capabilities: {} }.
 *
 * sttEngine: 'scribe' | 'whisper' | null
 *   'scribe'  → ElevenLabs Scribe is active; client should route counsellor STT to sidecar
 *               (fast HTTP API, no local model download stall).
 *   'whisper' → faster-whisper loaded locally; client stays on browser whisper-tiny to avoid
 *               the first-request model-download stall.
 *   null      → STT disabled or sidecar unreachable; client uses browser whisper-tiny.
 */
export async function probeSidecar(force = false) {
  if (probed && !force) return probed;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1000);
    const res = await fetch(`${BASE}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      probed = { ok: false, capabilities: {} };
      return probed;
    }
    const data = await res.json();
    probed = {
      ok: true,
      capabilities: data.capabilities || {},
      ttsEngine: data.ttsEngine || null,
      sttEngine: data.sttEngine || null,
    };
    return probed;
  } catch {
    probed = { ok: false, capabilities: {} };
    return probed;
  }
}

/** Return the cached probe result (or null if not yet probed). */
export function sidecarStatus() {
  return probed;
}

/**
 * POST /tts — returns ArrayBuffer (WAV bytes).
 * @param {string} text
 * @param {string} [emotion="neutral"]
 * @param {string|null} [voice=null] - ElevenLabs voice ID override (per-session student voice)
 * @returns {Promise<ArrayBuffer>}
 */
export async function sidecarTts(text, emotion = "neutral", voice = null) {
  const res = await fetch(`${BASE}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, emotion, ...(voice ? { voice } : {}) }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`sidecar /tts failed: ${msg}`);
  }
  return res.arrayBuffer();
}

/**
 * POST /stt — multipart "audio" field (WAV blob).
 * @param {Blob} wavBlob
 * @returns {Promise<{text: string, words: Array, durationSec: number}>}
 */
export async function sidecarStt(wavBlob) {
  const fd = new FormData();
  fd.append("audio", wavBlob, "utterance.wav");
  const res = await fetch(`${BASE}/stt`, { method: "POST", body: fd });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`sidecar /stt failed: ${msg}`);
  }
  return res.json();
}

/**
 * POST /analyze — multipart "audio" (WAV) + optional "transcript" (string).
 * @param {Blob} wavBlob
 * @param {string} [transcript=""]
 * @returns {Promise<object>} delivery metrics
 */
export async function sidecarAnalyze(wavBlob, transcript = "") {
  const fd = new FormData();
  fd.append("audio", wavBlob, "utterance.wav");
  if (transcript) fd.append("transcript", transcript);
  const res = await fetch(`${BASE}/analyze`, { method: "POST", body: fd });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error(`sidecar /analyze failed: ${msg}`);
  }
  return res.json();
}

/**
 * Encode a mono Float32Array of PCM samples into a 16-bit WAV Blob.
 * @param {Float32Array} float32 - mono samples in [-1, 1]
 * @param {number} sampleRate - e.g. 16000
 * @returns {Blob}
 */
export function pcmToWavBlob(float32, sampleRate) {
  const numSamples = float32.length;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);       // PCM subchunk size
  view.setUint16(20, 1, true);        // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write int16 samples
  let offset = headerSize;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
