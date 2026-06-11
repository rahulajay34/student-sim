import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

// OpenAI Realtime speech-to-speech over WebRTC — the single voice engine.
//
// The student's voice AND conversation run directly browser↔OpenAI for minimal
// latency (no STT→LLM→TTS hops). The server only mints a short-lived ephemeral
// token (pre-loaded with the persona instructions + voice + input transcription);
// MiniMax keeps grading via POST /observe, fed by the transcript events surfaced
// here through onTranscript({ role, text, deliveryMetrics? }).
//
// Mid-call steering (C3): the server's /observe response carries a compact
// `steering` string. Because the connect-time BASE instructions are NOT returned
// to the client (the token endpoint only echoes value/model/voice), we CANNOT do
// a `session.update` instructions replace without dropping the persona. Instead we
// inject the live state non-destructively as a `conversation.item.create` system
// item — supported by the Realtime API, additive to (not replacing) the standing
// instructions. See `sendSteering`.
//
// Delivery metrics (C4): per counsellor utterance we compute { wpm, pauses,
// energyVar, durationMs } from the VAD speech_started/speech_stopped events
// (duration + segment/pause count), the transcription word count (WPM), and a
// local mic AnalyserNode sampled ~10 Hz while the counsellor speaks (energyVar).
// Unavailable metrics are omitted rather than faked. They ride out on the same
// onTranscript({ role:"counsellor", ... }) call so Session can attach them to the
// /observe POST for that turn.
//
// Exposes a `voice`-like surface compatible with CallStage (enabled/status/
// loadPct/error/enable/disable/getAnalyser) plus realtime extras (changeVoice,
// muted/setMuted, sendText, sendSteering).

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

  // ── Delivery-metrics state (per counsellor utterance) ──────────────────────
  // A "counsellor utterance" spans from the first speech_started after the last
  // emitted counsellor transcript up to the transcription.completed for that turn.
  // It may contain multiple speech segments (the counsellor pausing mid-thought).
  const micAnalyserRef = useRef(null);  // local mic AnalyserNode (energy variance)
  const micCtxRef = useRef(null);
  const utterRef = useRef(null); // { startMs, durMs, segments, speaking, segStartMs, rms: [] }
  const rmsTimerRef = useRef(null);

  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  function setStatusBoth(s) { statusRef.current = s; setStatus(s); }

  // Fresh per-utterance accumulator.
  function resetUtterance() {
    utterRef.current = { startMs: 0, durMs: 0, segments: 0, speaking: false, segStartMs: 0, rms: [] };
  }

  // Sample local-mic RMS ~10 Hz while the counsellor speaks (energy variance).
  function startRmsSampling() {
    if (rmsTimerRef.current) return;
    const buf = new Uint8Array(128);
    rmsTimerRef.current = setInterval(() => {
      const an = micAnalyserRef.current;
      const u = utterRef.current;
      if (!an || !u || !u.speaking) return;
      try {
        an.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        u.rms.push(Math.sqrt(sumSq / buf.length));
      } catch { /* analyser not ready */ }
    }, 100);
  }
  function stopRmsSampling() {
    if (rmsTimerRef.current) { clearInterval(rmsTimerRef.current); rmsTimerRef.current = null; }
  }

  // Compute the metrics object for the just-completed counsellor utterance from
  // the accumulated VAD timing + RMS samples and the transcript word count. Any
  // metric that can't be honestly computed is omitted.
  function computeDeliveryMetrics(text) {
    const u = utterRef.current;
    if (!u) return undefined;
    const out = {};
    const durMs = Math.round(u.durMs);
    if (durMs > 0) out.durationMs = durMs;

    const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
    if (words > 0 && durMs > 400) {
      out.wpm = Math.round((words / durMs) * 60000);
    }
    // pauses ≈ speech segments within the utterance minus 1 (never negative).
    if (u.segments > 0) out.pauses = Math.max(0, u.segments - 1);

    // energyVar = variance of the sampled RMS values.
    if (u.rms.length >= 2) {
      const mean = u.rms.reduce((a, b) => a + b, 0) / u.rms.length;
      const variance = u.rms.reduce((a, b) => a + (b - mean) * (b - mean), 0) / u.rms.length;
      out.energyVar = Number(variance.toFixed(5));
    }
    return Object.keys(out).length ? out : undefined;
  }

  const teardown = useCallback(() => {
    stopRmsSampling();
    try { dcRef.current?.close(); } catch { /* noop */ }
    try { pcRef.current?.getSenders?.().forEach((s) => { try { s.track?.stop(); } catch { /* noop */ } }); } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { audioCtxRef.current?.close(); } catch { /* noop */ }
    try { micCtxRef.current?.close(); } catch { /* noop */ }
    if (audioElRef.current) {
      try { audioElRef.current.srcObject = null; audioElRef.current.remove(); } catch { /* noop */ }
    }
    pcRef.current = null;
    dcRef.current = null;
    micStreamRef.current = null;
    audioElRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    micAnalyserRef.current = null;
    micCtxRef.current = null;
    utterRef.current = null;
  }, []);

  // Parse one realtime server event off the data channel.
  const handleEvent = useCallback((evt) => {
    const type = evt?.type;
    if (!type) return;
    switch (type) {
      case "input_audio_buffer.speech_started": {
        if (enabledRef.current) setStatusBoth("listening");
        // Begin (or continue) a counsellor utterance; track segment timing.
        const now = performance.now();
        if (!utterRef.current) resetUtterance();
        const u = utterRef.current;
        if (u.segments === 0 && u.durMs === 0) u.startMs = now;
        u.speaking = true;
        u.segStartMs = now;
        u.segments += 1;
        startRmsSampling();
        break;
      }
      case "input_audio_buffer.speech_stopped": {
        if (enabledRef.current && statusRef.current === "listening") setStatusBoth("idle");
        const u = utterRef.current;
        if (u && u.speaking) {
          u.durMs += Math.max(0, performance.now() - u.segStartMs);
          u.speaking = false;
        }
        break;
      }
      // The counsellor's audio, transcribed by the configured input model.
      case "conversation.item.input_audio_transcription.completed": {
        const text = (evt.transcript || "").trim();
        if (text) {
          const deliveryMetrics = computeDeliveryMetrics(text);
          onTranscriptRef.current?.({ role: "counsellor", text, deliveryMetrics });
        }
        // Close out the utterance window for the next counsellor turn.
        stopRmsSampling();
        resetUtterance();
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

    // Local mic AnalyserNode tap for delivery-metrics energy variance (separate
    // from the remote-audio analyser that drives the orb).
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const micCtx = new AC();
      micCtxRef.current = micCtx;
      micCtx.resume?.().catch(() => {});
      const micSrc = micCtx.createMediaStreamSource(micStream);
      const micAnalyser = micCtx.createAnalyser();
      micAnalyser.fftSize = 256;
      micSrc.connect(micAnalyser); // analyser only — not routed to output
      micAnalyserRef.current = micAnalyser;
    } catch (err) {
      console.warn("[openai-realtime] mic analyser setup failed (no energyVar):", err?.message);
    }
    resetUtterance();

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
        analyser.fftSize = 256; // frequencyBinCount 128, matches the orb level reader
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

  // Mid-call steering (C3, resolution (b)): inject the live CURRENT STATE block as
  // a non-destructive system conversation item. This does NOT replace the standing
  // instructions (which we never received client-side); it nudges the model with
  // fresh objection/disposition/phase context. Guarded: only when the data channel
  // is open; never throws.
  // Returns true if the steering was actually sent (dc open), false otherwise so
  // the caller can keep the value pending and retry on the next turn (newest wins).
  const sendSteering = useCallback((steering) => {
    const dc = dcRef.current;
    const s = (steering || "").trim();
    if (!s) return false;
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "## CURRENT STATE (live update)\n" + s }],
        },
      }));
      return true;
    } catch (err) {
      console.warn("[openai-realtime] steering send failed:", err?.message);
      return false;
    }
  }, []);

  const getAnalyser = useCallback(() => analyserRef.current, []);

  useEffect(() => () => { enabledRef.current = false; teardown(); }, [teardown]);

  return {
    engine: "openai",
    enabled, status, loadPct: 0, error, voice, muted,
    enable, disable, changeVoice, setMuted, getAnalyser, sendText, sendSteering,
    // classic-only no-ops so shared UI/handlers are safe when this engine is active
    speak: () => {}, speakChunk: () => {}, beginUtterance: () => {}, endUtterance: () => {},
    stopSpeaking: () => {}, startListening: () => {}, stopListening: () => {},
  };
}
