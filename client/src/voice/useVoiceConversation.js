import { useCallback, useEffect, useRef, useState } from "react";
import { loadTTS, streamSpeak, DEFAULT_VOICE } from "./tts";
import { loadSTT, transcribe } from "./stt";
import { StreamingAudioPlayer } from "./audioPlayer";

export function useVoiceConversation({ onUserUtterance, voice = DEFAULT_VOICE } = {}) {
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

  const speak = useCallback(async (text) => {
    const player = playerRef.current;
    const tts = ttsRef.current;
    if (!player || !tts || !text?.trim()) return;

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
      await streamSpeak(tts, text, { voice: voiceRef.current, player });
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
        const text = await transcribe(sttRef.current, float32);
        if (text && text.replace(/[^a-z0-9]/gi, "").length > 1) {
          onUtterRef.current?.(text);
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

      const onProgress = (p) => {
        if (p && p.status === "progress" && typeof p.progress === "number") {
          setLoadPct(Math.round(p.progress));
        }
      };
      const [tts, stt] = await Promise.all([
        loadTTS({ onProgress }),
        loadSTT({ onProgress }),
      ]);
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

  return { enabled, status, loadPct, error, enable, disable, speak, stopSpeaking, startListening, stopListening };
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
