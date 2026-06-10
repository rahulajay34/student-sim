import { useCallback, useEffect, useRef, useState } from "react";
import { loadTTS, streamSpeak, DEFAULT_VOICE } from "./tts";
import { loadSTT, transcribe } from "./stt";
import { StreamingAudioPlayer } from "./audioPlayer";
import {
  probeSidecar,
  capabilityReady,
  sidecarTts,
  sidecarStt,
  sidecarAnalyze,
  pcmToWavBlob,
} from "./sidecarClient";

// Sample rate the MediaRecorder pipeline uses for STT (must match blobToFloat32).
const STT_SAMPLE_RATE = 16000;

export function useVoiceConversation({
  onUserUtterance,
  voice = DEFAULT_VOICE,
} = {}) {
  const [enabled, setEnabled] = useState(false);
  // off | loading | idle | recording | transcribing | speaking
  const [status, setStatus] = useState("off");
  const [loadPct, setLoadPct] = useState(0);
  const [error, setError] = useState(null);

  const playerRef = useRef(null);
  const ttsRef = useRef(null);
  const sttRef = useRef(null);
  const micStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const enabledRef = useRef(false);
  const statusRef = useRef("off");

  // Sidecar capability flags (mutated on probe + on per-call errors).
  // { tts: bool, stt: bool, analyze: bool, ttsEngine: string|null }
  const sidecarRef = useRef({ tts: false, stt: false, analyze: false, ttsEngine: null });

  const onUtterRef = useRef(onUserUtterance);
  const voiceRef = useRef(voice);
  useEffect(() => { onUtterRef.current = onUserUtterance; }, [onUserUtterance]);
  useEffect(() => { voiceRef.current = voice; }, [voice]);

  function setStatusBoth(s) {
    statusRef.current = s;
    setStatus(s);
  }

  const stopSpeaking = useCallback(() => {
    playerRef.current?.stop();
    if (enabledRef.current) setStatusBoth("idle");
  }, []);

  const speak = useCallback(async (text, emotion = "neutral") => {
    const player = playerRef.current;
    if (!player || !text?.trim()) return;

    player.stop();
    const epoch = player.epoch;
    setStatusBoth("speaking");

    let synthDone = false;
    const finish = () => {
      if (player.epoch !== epoch) return;
      if (enabledRef.current) setStatusBoth("idle");
    };
    player.onended = () => { if (synthDone) finish(); };

    try {
      if (sidecarRef.current.tts) {
        // --- Sidecar TTS path: fetch WAV → decode → enqueue into existing gapless player ---
        // Epoch is captured before the async fetch; barge-in semantics preserved:
        // player.stop() bumps epoch, so the enqueue after decode is a no-op if interrupted.
        try {
          const arrayBuffer = await sidecarTts(text, emotion);
          if (player.epoch !== epoch) {
            // Interrupted while fetching — honour barge-in, do not enqueue.
            return;
          }
          const ctx = player._ensureCtx();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          if (player.epoch !== epoch) return; // interrupted during decode
          // Enqueue the single decoded buffer into the existing gapless player.
          player.enqueue(audioBuffer.getChannelData(0), audioBuffer.sampleRate);
        } catch (e) {
          // Sidecar TTS failed — disable for this session and fall back to browser TTS.
          sidecarRef.current = { ...sidecarRef.current, tts: false };
          console.warn("[sidecar] TTS error, falling back to browser TTS:", e);
          const tts = ttsRef.current;
          if (tts && player.epoch === epoch) {
            await streamSpeak(tts, text, { voice: voiceRef.current, player });
          }
        }
      } else {
        // --- Browser TTS path (Kokoro-82M, sentence-streamed) ---
        const tts = ttsRef.current;
        if (!tts) return;
        await streamSpeak(tts, text, { voice: voiceRef.current, player });
      }
    } catch (e) {
      setError(e?.message || String(e));
    }
    synthDone = true;
    if (player.epoch === epoch && !player.playing) finish();
  }, []);

  // Space down — interrupt TTS if playing, then start recording.
  const startListening = useCallback(() => {
    if (!enabledRef.current) return;
    if (statusRef.current === "transcribing") return;
    if (statusRef.current === "recording") return;
    if (!micStreamRef.current) return;

    // Interrupt student speech so we can record immediately.
    if (statusRef.current === "speaking") playerRef.current?.stop();

    chunksRef.current = [];
    const mr = new MediaRecorder(micStreamRef.current);
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      if (!enabledRef.current) return;
      setStatusBoth("transcribing");
      try {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const float32 = await blobToFloat32(blob);
        if (float32.length < 1600) return; // < 100ms at 16kHz — discard silence

        let utteranceText = "";
        // Build a WAV blob from the float32 PCM — needed for both sidecar STT and analyze.
        const wavBlob = sidecarRef.current.stt || sidecarRef.current.analyze
          ? pcmToWavBlob(float32, STT_SAMPLE_RATE)
          : null;

        if (sidecarRef.current.stt) {
          // --- Sidecar STT path ---
          try {
            const result = await sidecarStt(wavBlob);
            utteranceText = (result?.text || "").trim();
          } catch (e) {
            // Fall back to browser whisper on error.
            sidecarRef.current = { ...sidecarRef.current, stt: false };
            console.warn("[sidecar] STT error, falling back to browser whisper:", e);
            if (!sttRef.current) {
              setStatusBoth("loading-stt");
              sttRef.current = await loadSTT({ onProgress: () => {} });
            }
            utteranceText = await transcribe(sttRef.current, float32);
          }
        } else {
          // --- Browser whisper-tiny path ---
          if (!sttRef.current) {
            setStatusBoth("loading-stt");
            sttRef.current = await loadSTT({ onProgress: () => {} });
          }
          utteranceText = await transcribe(sttRef.current, float32);
        }

        if (utteranceText && utteranceText.replace(/[^a-z0-9]/gi, "").length > 1) {
          // Pair the analyze promise with this exact utterance so the submit
          // path can race-await it with a 2.5-second timeout.
          let analyzePromise = null;
          if (sidecarRef.current.analyze && wavBlob) {
            analyzePromise = sidecarAnalyze(wavBlob, utteranceText).catch((e) => {
              sidecarRef.current = { ...sidecarRef.current, analyze: false };
              console.warn("[sidecar] analyze error, disabling for session:", e);
              return null;
            });
          }
          onUtterRef.current?.(utteranceText, { analyzePromise });
        }
      } catch (e) {
        setError(e?.message || String(e));
      } finally {
        if (enabledRef.current) setStatusBoth("idle");
      }
    };
    mediaRecorderRef.current = mr;
    mr.start();
    setStatusBoth("recording");
  }, []);

  // Space up — stop recording; onstop fires and kicks off transcription.
  const stopListening = useCallback(() => {
    if (statusRef.current !== "recording") return;
    try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
  }, []);

  const enable = useCallback(async () => {
    if (enabledRef.current) return;
    setError(null);
    setEnabled(true);
    enabledRef.current = true;
    setStatusBoth("loading");

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      micStreamRef.current = micStream;
      playerRef.current = new StreamingAudioPlayer();

      // Probe sidecar first (force-fresh; 1-second timeout; non-blocking on error).
      const probe = await probeSidecar(true);
      const caps = probe?.capabilities || {};
      sidecarRef.current = {
        tts: probe?.ok && capabilityReady(caps.tts),
        stt: probe?.ok && capabilityReady(caps.stt),
        analyze: probe?.ok && capabilityReady(caps.analyze),
        ttsEngine: probe?.ttsEngine || null,
      };

      const onProgress = (p) => {
        if (p && p.status === "progress" && typeof p.progress === "number") {
          setLoadPct(Math.round(p.progress));
        }
      };

      // Always load the browser TTS (Kokoro) — it's the fallback and stays cached.
      // Only load the browser STT (whisper-tiny) when sidecar STT is NOT ready,
      // to avoid a ~150-300 MB download that would go unused.
      const loaders = [loadTTS({ onProgress })];
      if (!sidecarRef.current.stt) {
        loaders.push(loadSTT({ onProgress }));
      }
      const results = await Promise.all(loaders);
      ttsRef.current = results[0];
      sttRef.current = sidecarRef.current.stt ? null : results[1];

      setStatusBoth("idle");
    } catch (e) {
      setError(e?.message || String(e));
      enabledRef.current = false;
      setEnabled(false);
      setStatusBoth("off");
    }
  }, []);

  const disable = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    setStatusBoth("off");
    try { mediaRecorderRef.current?.state === "recording" && mediaRecorderRef.current.stop(); } catch { /* noop */ }
    playerRef.current?.stop();
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    micStreamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      enabledRef.current = false;
      playerRef.current?.stop();
      try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    };
  }, []);

  // Expose analyser getter so the orb level hook can tap into the TTS player.
  const getAnalyser = useCallback(() => playerRef.current?.getAnalyser() ?? null, []);

  return { enabled, status, loadPct, error, enable, disable, speak, stopSpeaking, startListening, stopListening, getAnalyser };
}

async function blobToFloat32(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ sampleRate: 16000 });
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return audioBuffer.getChannelData(0);
  } finally {
    ctx.close();
  }
}
