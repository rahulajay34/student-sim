import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

// OpenAI Realtime speech-to-speech over WebRTC.
//
// The student's voice AND conversation run directly browser↔OpenAI for minimal
// latency (no STT→LLM→TTS hops). The server only mints a short-lived ephemeral
// token (pre-loaded with the persona instructions + voice + input transcription);
// MiniMax keeps grading via POST /observe, fed by the transcript events surfaced
// here through onTranscript({ role, text }).
//
// Exposes a `voice`-like surface compatible with CallStage (enabled/status/
// loadPct/error/enable/disable/getAnalyser) plus realtime extras (changeVoice,
// muted/setMuted). The classic-only methods are no-op stubs so shared UI is safe.

const SDP_URL = "https://api.openai.com/v1/realtime/calls";

export function useOpenAIRealtime({ sessionId, onTranscript, onError, defaultVoice = "marin" } = {}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("off"); // off | loading | idle | listening | speaking
  const [error, setError] = useState(null);
  const [voice, setVoice] = useState(defaultVoice);
  const [muted, setMutedState] = useState(true); // START MUTED — push-to-talk (hold Space)
  const mutedRef = useRef(true);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const micStreamRef = useRef(null);
  const audioElRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const enabledRef = useRef(false);
  const statusRef = useRef("off");

  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  function setStatusBoth(s) { statusRef.current = s; setStatus(s); }

  const teardown = useCallback(() => {
    try { dcRef.current?.close(); } catch { /* noop */ }
    try { pcRef.current?.getSenders?.().forEach((s) => { try { s.track?.stop(); } catch { /* noop */ } }); } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { audioCtxRef.current?.close(); } catch { /* noop */ }
    if (audioElRef.current) {
      try { audioElRef.current.srcObject = null; audioElRef.current.remove(); } catch { /* noop */ }
    }
    pcRef.current = null;
    dcRef.current = null;
    micStreamRef.current = null;
    audioElRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  // Parse one realtime server event off the data channel.
  const handleEvent = useCallback((evt) => {
    const type = evt?.type;
    if (!type) return;
    switch (type) {
      case "input_audio_buffer.speech_started":
        if (enabledRef.current) setStatusBoth("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        if (enabledRef.current && statusRef.current === "listening") setStatusBoth("idle");
        break;
      // The counsellor's audio, transcribed by the configured input model.
      case "conversation.item.input_audio_transcription.completed": {
        const text = (evt.transcript || "").trim();
        if (text) onTranscriptRef.current?.({ role: "counsellor", text });
        break;
      }
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
        if (enabledRef.current) setStatusBoth("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "response.done":
        if (enabledRef.current && statusRef.current === "speaking") setStatusBoth("idle");
        break;
      // The student's spoken reply, transcribed.
      case "response.output_audio_transcript.done": {
        const text = (evt.transcript || "").trim();
        if (text) onTranscriptRef.current?.({ role: "student", text });
        break;
      }
      case "error": {
        const msg = evt.error?.message || "OpenAI realtime error";
        console.warn("[openai-realtime] error event:", msg);
        setError(msg);
        onErrorRef.current?.(new Error(msg));
        break;
      }
      default:
        break;
    }
  }, []);

  // Establish the WebRTC peer connection for the given voice.
  const connect = useCallback(async (useVoice) => {
    const sid = sessionIdRef.current;
    if (!sid) throw new Error("No session id for realtime connection.");

    // 1. Mint the ephemeral token (server pre-loads persona instructions + voice
    //    + model — all bound to the token, so the SDP POST below needs none of them).
    const tok = await api.getOpenAIRealtimeToken(sid, useVoice);
    const ephemeral = tok.value;
    if (tok.voice) setVoice(tok.voice);

    // 2. Mic.
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    micStreamRef.current = micStream;

    // 3. Peer connection + remote audio playback + analyser tap (for the orb).
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
    audioElRef.current = audioEl;

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (!stream) return;
      audioEl.srcObject = stream;
      audioEl.play?.().catch(() => { /* autoplay may need a gesture; join is one */ });
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        audioCtxRef.current = ctx;
        ctx.resume?.().catch(() => {});
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256; // frequencyBinCount 128, matches the classic player
        src.connect(analyser); // analyser only — playback stays on the <audio> element
        analyserRef.current = analyser;
      } catch (err) {
        console.warn("[openai-realtime] analyser setup failed (orb stays calm):", err?.message);
      }
    };

    pc.addTrack(micStream.getAudioTracks()[0], micStream);
    // Honour the current mute state immediately (start muted → push-to-talk).
    micStream.getAudioTracks().forEach((t) => { t.enabled = !mutedRef.current; });

    // 4. Data channel for realtime events.
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (e) => {
      let evt;
      try { evt = JSON.parse(e.data); } catch { return; }
      handleEvent(evt);
    };

    // 5. SDP offer → OpenAI → answer. The GA /calls endpoint binds the model to
    // the ephemeral token — do NOT pass ?model= (the beta query param now 400s).
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpRes = await fetch(SDP_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${ephemeral}`, "Content-Type": "application/sdp" },
    });
    if (!sdpRes.ok) {
      const detail = await sdpRes.text().catch(() => "");
      throw new Error(`OpenAI SDP exchange failed (${sdpRes.status}): ${detail.slice(0, 200)}`);
    }
    const answerSdp = await sdpRes.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }, [handleEvent]);

  const enable = useCallback(async (useVoice) => {
    if (enabledRef.current) return;
    setError(null);
    setEnabled(true);
    enabledRef.current = true;
    setStatusBoth("loading");
    try {
      await connect(useVoice || voice);
      setStatusBoth("idle");
    } catch (e) {
      console.error("[openai-realtime] enable failed:", e);
      setError(e?.message || String(e));
      teardown();
      enabledRef.current = false;
      setEnabled(false);
      setStatusBoth("off");
      throw e;
    }
  }, [connect, teardown, voice]);

  const disable = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    setStatusBoth("off");
    teardown();
  }, [teardown]);

  // Re-establish the connection with a different voice (the voice is baked into
  // the session config at token-mint time, so a live change means a quick reconnect).
  const changeVoice = useCallback(async (nextVoice) => {
    setVoice(nextVoice);
    if (!enabledRef.current) return;
    teardown();
    setStatusBoth("loading");
    try {
      await connect(nextVoice);
      setStatusBoth("idle");
    } catch (e) {
      setError(e?.message || String(e));
      enabledRef.current = false;
      setEnabled(false);
      setStatusBoth("off");
    }
  }, [connect, teardown]);

  const setMuted = useCallback((m) => {
    mutedRef.current = m;
    setMutedState(m);
    try { micStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !m; }); } catch { /* noop */ }
  }, []);

  // Typed counsellor input → inject as a user turn and ask the model to respond.
  // Surface the counsellor text ourselves (no STT event fires for typed input) so
  // it gets a bubble + is scored via /observe; the student reply flows back as audio.
  const sendText = useCallback((text) => {
    const dc = dcRef.current;
    const t = (text || "").trim();
    if (!t) return;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: t }] },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
    }
    onTranscriptRef.current?.({ role: "counsellor", text: t });
  }, []);

  const getAnalyser = useCallback(() => analyserRef.current, []);

  useEffect(() => () => { enabledRef.current = false; teardown(); }, [teardown]);

  return {
    engine: "openai",
    enabled, status, loadPct: 0, error, voice, muted,
    enable, disable, changeVoice, setMuted, getAnalyser, sendText,
    // classic-only no-ops so shared UI/handlers are safe when this engine is active
    speak: () => {}, speakChunk: () => {}, beginUtterance: () => {}, endUtterance: () => {},
    stopSpeaking: () => {}, startListening: () => {}, stopListening: () => {},
  };
}
