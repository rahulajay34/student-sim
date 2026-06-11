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
  ttsVoiceId = null, // ElevenLabs voice ID for the sidecar path (per-session student voice)
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

  // ── Sentence-streamed utterance state ──────────────────────────────────────
  // A "begun" utterance (beginUtterance) captures an epoch; speakChunk appends
  // TTS-rendered sentences into the gapless player WITHOUT bumping the epoch, so
  // playback flows continuously. Chunk TTS requests are kept SEQUENTIAL (one in
  // flight, FIFO queue) so audio order matches sentence order from the sidecar.
  // endUtterance finalizes the read: once the queue and playback both drain,
  // status returns to idle.
  const utteranceEpochRef = useRef(null); // epoch captured at beginUtterance, or null
  const chunkQueueRef = useRef([]);       // [{ text, emotion, epoch }]
  const chunkPumpingRef = useRef(false);  // true while a chunk is being synth/enqueued
  const utteranceEndedRef = useRef(false); // endUtterance called; drain → idle when done
  const maybeFinishRef = useRef(null);     // latest beginUtterance's drain→idle checker

  // Sidecar capability flags (mutated on probe + on per-call errors).
  // { tts: bool, stt: bool, analyze: bool, ttsEngine: string|null, sttEngine: string|null }
  // stt is set to true only when sttEngine === 'scribe' (fast HTTP API, no local model stall).
  // On any per-request STT error it is permanently flipped to false for the session.
  const sidecarRef = useRef({ tts: false, stt: false, analyze: false, ttsEngine: null, sttEngine: null });

  const onUtterRef = useRef(onUserUtterance);
  const voiceRef = useRef(voice);
  const ttsVoiceIdRef = useRef(ttsVoiceId);
  useEffect(() => { onUtterRef.current = onUserUtterance; }, [onUserUtterance]);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => { ttsVoiceIdRef.current = ttsVoiceId; }, [ttsVoiceId]);

  function setStatusBoth(s) {
    statusRef.current = s;
    setStatus(s);
  }

  const stopSpeaking = useCallback(() => {
    // Cancel any in-flight / queued sentence chunks too (epoch-guarded barge-in).
    chunkQueueRef.current = [];
    utteranceEpochRef.current = null;
    utteranceEndedRef.current = false;
    playerRef.current?.stop();
    if (enabledRef.current) setStatusBoth("idle");
  }, []);

  // Synthesize one text segment into the gapless player, honouring `epoch`
  // (barge-in: if player.epoch drifts, stop feeding). Reuses the sidecar→browser
  // fallback. Does NOT bump the epoch or touch status — callers own lifecycle.
  // Returns when the segment is fully enqueued (not when playback finishes).
  const synthInto = useCallback(async (text, emotion, epoch) => {
    const player = playerRef.current;
    if (!player || !text?.trim()) return;
    if (player.epoch !== epoch) return; // already interrupted

    if (sidecarRef.current.tts) {
      // --- Sidecar TTS path: fetch WAV → decode → enqueue into gapless player ---
      try {
        const arrayBuffer = await sidecarTts(text, emotion, ttsVoiceIdRef.current);
        if (player.epoch !== epoch) return; // interrupted while fetching
        const ctx = player._ensureCtx();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (player.epoch !== epoch) return; // interrupted during decode
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
  }, []);

  const speak = useCallback(async (text, emotion = "neutral") => {
    const player = playerRef.current;
    if (!player || !text?.trim()) return;

    // speak() is the "fresh utterance" entry point: cancel any sentence-stream in
    // progress and bump the epoch so this becomes the sole active read.
    chunkQueueRef.current = [];
    utteranceEpochRef.current = null;
    utteranceEndedRef.current = false;

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
      await synthInto(text, emotion, epoch);
    } catch (e) {
      setError(e?.message || String(e));
    }
    synthDone = true;
    if (player.epoch === epoch && !player.playing) finish();
  }, [synthInto]);

  // ── Sentence-streamed utterance API ─────────────────────────────────────────
  // beginUtterance(): start a fresh read. Bumps the epoch ONCE (via player.stop),
  // captures it, flips status to 'speaking', and wires the drain→idle callback so
  // playback returns to idle once the queue empties AND audio finishes — but only
  // after endUtterance() has been called (we don't want a momentary gap between
  // sentences to be read as "done").
  const beginUtterance = useCallback(() => {
    const player = playerRef.current;
    if (!player) return null;

    chunkQueueRef.current = [];
    chunkPumpingRef.current = false;
    utteranceEndedRef.current = false;

    player.stop();
    const epoch = player.epoch;
    utteranceEpochRef.current = epoch;
    setStatusBoth("speaking");

    const maybeFinish = () => {
      if (player.epoch !== epoch) return;            // superseded / barged-in
      if (!utteranceEndedRef.current) return;        // more sentences may still come
      if (chunkPumpingRef.current) return;           // a chunk is mid-flight
      if (chunkQueueRef.current.length > 0) return;  // queued chunks remain
      if (player.playing) return;                    // audio still draining
      if (enabledRef.current) setStatusBoth("idle");
    };
    // The player fires onended whenever its queue drains to zero; re-check there.
    player.onended = maybeFinish;
    maybeFinishRef.current = maybeFinish;
    return epoch;
  }, []);

  // Pump the chunk queue one at a time (sequential, FIFO) so audio order matches
  // sentence order. Each chunk is epoch-guarded so a barge-in cancels pending work.
  const pumpChunks = useCallback(async () => {
    if (chunkPumpingRef.current) return;
    chunkPumpingRef.current = true;
    try {
      for (;;) {
        const next = chunkQueueRef.current.shift();
        if (!next) break;
        const player = playerRef.current;
        if (!player || player.epoch !== next.epoch) {
          // Epoch drifted (barge-in / new utterance) — drop the rest.
          chunkQueueRef.current = [];
          break;
        }
        try {
          await synthInto(next.text, next.emotion, next.epoch);
        } catch (e) {
          setError(e?.message || String(e));
        }
      }
    } finally {
      chunkPumpingRef.current = false;
      maybeFinishRef.current?.();
    }
  }, [synthInto]);

  // speakChunk(text, emotion): enqueue one sentence into the CURRENT utterance
  // without bumping the epoch (append semantics). No-op if no utterance is active.
  const speakChunk = useCallback((text, emotion = "neutral") => {
    const player = playerRef.current;
    if (!player || !text?.trim()) return;
    const epoch = utteranceEpochRef.current;
    if (epoch == null) return;        // no active utterance (must beginUtterance first)
    if (player.epoch !== epoch) return; // utterance already superseded
    chunkQueueRef.current.push({ text, emotion, epoch });
    pumpChunks();
  }, [pumpChunks]);

  // endUtterance(): no more sentences will be enqueued. Once the queue + playback
  // drain, status returns to idle (handled by maybeFinish).
  const endUtterance = useCallback(() => {
    utteranceEndedRef.current = true;
    maybeFinishRef.current?.();
  }, []);

  // Space down — interrupt TTS if playing, then start recording.
  const startListening = useCallback(() => {
    if (!enabledRef.current) return;
    if (statusRef.current === "transcribing") return;
    if (statusRef.current === "recording") return;
    if (!micStreamRef.current) return;

    // Interrupt student speech so we can record immediately. stop() bumps the
    // epoch (cancels in-flight chunk fetches via epoch guards); also clear the
    // sentence-stream queue so nothing resumes after barge-in.
    if (statusRef.current === "speaking") {
      chunkQueueRef.current = [];
      utteranceEpochRef.current = null;
      utteranceEndedRef.current = false;
      playerRef.current?.stop();
    }

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

        // Build a WAV blob from the float32 PCM.
        // Needed when sidecar STT (scribe) is active OR sidecar analyze is active.
        const wavBlob = (sidecarRef.current.stt || sidecarRef.current.analyze)
          ? pcmToWavBlob(float32, STT_SAMPLE_RATE)
          : null;

        // --- STT: sidecar Scribe path (only when sttEngine === 'scribe') ---
        // Scribe is a fast HTTP API call — no local model download stall.
        // On any per-request error, log + permanently fall back to browser whisper
        // for the remainder of this session.
        // Browser whisper-tiny is ALWAYS preloaded at enable() (it is the fallback).
        let utteranceText;
        if (sidecarRef.current.stt && wavBlob) {
          try {
            const result = await sidecarStt(wavBlob);
            utteranceText = result?.text ?? "";
          } catch (sttErr) {
            console.warn("[sidecar] STT error, permanently falling back to browser whisper for this session:", sttErr);
            sidecarRef.current = { ...sidecarRef.current, stt: false };
            utteranceText = await transcribe(sttRef.current, float32);
          }
        } else {
          // --- Browser whisper-tiny STT fallback ---
          if (!sttRef.current) {
            // Should not normally happen since enable() preloads whisper, but guard anyway.
            setStatusBoth("loading-stt");
            sttRef.current = await loadSTT({ onProgress: () => {} });
          }
          utteranceText = await transcribe(sttRef.current, float32);
        }

        // Noise guard: require at least 2 letters/digits in ANY script.
        // (An ASCII-only [a-z0-9] check here used to silently discard Hindi
        // utterances — Scribe transcribes Hindi words in Devanagari.)
        if (utteranceText && utteranceText.replace(/[^\p{L}\p{N}]/gu, "").length > 1) {
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
      // Route counsellor STT to the sidecar ONLY when sttEngine === 'scribe'.
      // Scribe is a fast HTTP API (no local model download) so it won't stall the
      // first utterance. When sttEngine === 'whisper', the sidecar's faster-whisper
      // lazy-downloads on first request and stalls real calls — keep browser whisper.
      const useSidecarStt = probe?.ok && capabilityReady(caps.stt) && probe?.sttEngine === "scribe";
      sidecarRef.current = {
        tts: probe?.ok && capabilityReady(caps.tts),
        stt: useSidecarStt,
        analyze: probe?.ok && capabilityReady(caps.analyze),
        ttsEngine: probe?.ttsEngine || null,
        sttEngine: probe?.sttEngine || null,
      };

      const onProgress = (p) => {
        if (p && p.status === "progress" && typeof p.progress === "number") {
          setLoadPct(Math.round(p.progress));
        }
      };

      // Always preload browser TTS (Kokoro, TTS fallback) and browser STT
      // (whisper-tiny, STT fallback for when sidecar Scribe is unavailable or
      // errors per-request). Both are browser-cached after the first session.
      const [tts, stt] = await Promise.all([loadTTS({ onProgress }), loadSTT({ onProgress })]);
      ttsRef.current = tts;
      sttRef.current = stt;

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
    chunkQueueRef.current = [];
    utteranceEpochRef.current = null;
    utteranceEndedRef.current = false;
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

  return { enabled, status, loadPct, error, enable, disable, speak, speakChunk, beginUtterance, endUtterance, stopSpeaking, startListening, stopListening, getAnalyser };
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
