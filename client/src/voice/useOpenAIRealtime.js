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
// inject the live state non-destructively as a `conversation.item.create` item.
// We send it with role:"system" first; if the GA Realtime API rejects that role
// (it may only accept user/assistant conversation items), we detect the error
// event and fall back to role:"user" with an internal-state prefix, re-sending and
// using "user" for all subsequent steering. See `sendSteering`/`sendSteeringRaw`.
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
  // Monotonic connect generation. Each connect() bumps it; a stale invocation
  // (superseded by a newer connect/changeVoice while awaiting SDP) bails out and
  // cleans up only its own locally-captured allocations so it can't clobber the
  // newer call's refs or leak a mic stream.
  const connectGenRef = useRef(0);
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

  // Steering-role fallback (C3 defensive): we send the live-state item with
  // role:"system". If the GA Realtime API rejects that (it may only accept
  // user/assistant conversation items), an error event arrives within ~2s of the
  // send — we flip to role:"user" with an internal-state prefix and re-send, then
  // use "user" for all future steering. Module-lifetime via refs; never throws.
  const steerFallbackToUserRef = useRef(false);
  const lastSteerRef = useRef(null); // { text, atMs } of the most recent steering send
  const steerWarnedRef = useRef(false);
  const sendSteeringRawRef = useRef(null); // points at sendSteeringRaw (set below; lets handleEvent re-send)

  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  function setStatusBoth(s) { statusRef.current = s; setStatus(s); }

  // Fresh per-utterance accumulator.
  function resetUtterance() {
    utterRef.current = { startMs: 0, endMs: 0, durMs: 0, segments: 0, speaking: false, segStartMs: 0, rms: [] };
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
    const durMs = Math.round(u.durMs); // speech-only time (sum of VAD segments)
    if (durMs > 0) out.durationMs = durMs;

    // WPM uses wall-clock utterance duration (start→last speech_stopped, pauses
    // included) so a counsellor who pauses mid-sentence isn't over-rated. Falls
    // back to speech-only durMs if endMs was never captured.
    const wallMs = (u.startMs > 0 && u.endMs > u.startMs)
      ? Math.round(u.endMs - u.startMs)
      : durMs;
    const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
    if (words > 0 && wallMs > 400) {
      out.wpm = Math.round((words / wallMs) * 60000);
    }
    // pauses ≈ speech segments within the utterance minus 1 (never negative).
    if (u.segments > 0) out.pauses = Math.max(0, u.segments - 1);

    // energyVar = variance of the sampled RMS values.
    if (u.rms.length >= 2) {
      const mean = u.rms.reduce((a, b) => a + b, 0) / u.rms.length;
      const variance = u.rms.reduce((a, b) => a + (b - mean) * (b - mean), 0) / u.rms.length;
      out.energyVar = Number(variance.toFixed(5));
    }

    // Derived verdict/tone fields the CoachPanel + FootStrip chips read directly.
    if (out.wpm != null) {
      out.paceVerdict = out.wpm < 100 ? "slow" : out.wpm > 170 ? "fast" : "good";
    }
    if (out.energyVar != null) {
      out.energyVerdict = out.energyVar < 0.002 ? "low" : out.energyVar > 0.012 ? "high" : "good";
    }
    // tone maps to VerdictChip colorMap keys: "cold" | "neutral" | "warm".
    out.tone = (out.energyVerdict === "low" || out.paceVerdict === "slow") ? "cold"
      : (out.energyVerdict === "high" || out.paceVerdict === "fast") ? "warm"
        : "neutral";

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
          const now = performance.now();
          u.durMs += Math.max(0, now - u.segStartMs);
          u.endMs = now; // wall-clock end of the latest speech segment (pauses-inclusive WPM)
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
        // If this error plausibly references our most recent role:"system" steering
        // item (same item_id, or any error within ~2s of the send while still on the
        // system role), flip to role:"user" and re-send the live state defensively.
        const last = lastSteerRef.current;
        const recent = last && (performance.now() - last.atMs) < 2000;
        if (!steerFallbackToUserRef.current && recent) {
          steerFallbackToUserRef.current = true;
          if (!steerWarnedRef.current) {
            steerWarnedRef.current = true;
            console.warn(
              "[openai-realtime] steering item rejected with role:system; " +
              "falling back to role:user for live-state updates.",
            );
          }
          lastSteerRef.current = null; // consume so we don't loop on the re-send
          try { sendSteeringRawRef.current?.(last.text); } catch { /* never throw */ }
          // Swallow this error (it was our internal steering item, not a user-facing fault).
          break;
        }
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
    const gen = ++connectGenRef.current;
    const sid = sessionIdRef.current;
    if (!sid) throw new Error("No session id for realtime connection.");

    // Clean up only this invocation's local allocations when it has been superseded.
    const bailIfStale = (pc, micStream, micCtx, audioEl) => {
      if (gen === connectGenRef.current) return false;
      try { pc?.close(); } catch { /* noop */ }
      try { micStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      try { micCtx?.close(); } catch { /* noop */ }
      try { if (audioEl) { audioEl.srcObject = null; audioEl.remove(); } } catch { /* noop */ }
      return true;
    };

    // 1. Mint the ephemeral token (server pre-loads persona instructions + voice
    //    + model — all bound to the token, so the SDP POST below needs none of them).
    const tok = await api.getOpenAIRealtimeToken(sid, useVoice);
    if (gen !== connectGenRef.current) return; // stale — token minted but no resources held yet
    const ephemeral = tok.value;
    if (tok.voice) setVoice(tok.voice);

    // 2. Mic.
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    if (gen !== connectGenRef.current) {
      micStream.getTracks().forEach((t) => t.stop()); // local capture — don't touch refs
      return;
    }
    micStreamRef.current = micStream;

    // Local mic AnalyserNode tap for delivery-metrics energy variance (separate
    // from the remote-audio analyser that drives the orb).
    let micCtx = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      micCtx = new AC();
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
    if (bailIfStale(pc, micStream, micCtx, audioEl)) return;

    const sdpRes = await fetch(SDP_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${ephemeral}`, "Content-Type": "application/sdp" },
    });
    if (bailIfStale(pc, micStream, micCtx, audioEl)) return;

    if (!sdpRes.ok) {
      const detail = await sdpRes.text().catch(() => "");
      throw new Error(`OpenAI SDP exchange failed (${sdpRes.status}): ${detail.slice(0, 200)}`);
    }
    const answerSdp = await sdpRes.text();
    if (bailIfStale(pc, micStream, micCtx, audioEl)) return;

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
    if (!dc || dc.readyState !== "open") {
      // Voice not connected: do NOT surface a phantom transcript bubble or POST
      // /observe (which would score a turn the student never heard). Tell the
      // counsellor instead so they can enable the mic / retry.
      onErrorRef.current?.(new Error("Voice not connected — please enable the mic first."));
      return;
    }
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: t }] },
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
    onTranscriptRef.current?.({ role: "counsellor", text: t });
  }, []);

  // Mid-call steering (C3, resolution (b)): inject the live CURRENT STATE block as
  // a non-destructive system conversation item. This does NOT replace the standing
  // instructions (which we never received client-side); it nudges the model with
  // fresh objection/disposition/phase context. Guarded: only when the data channel
  // is open; never throws.
  // Returns true if the steering was actually sent (dc open), false otherwise so
  // the caller can keep the value pending and retry on the next turn (newest wins).
  const USER_STEER_PREFIX =
    "[INTERNAL STATE UPDATE — not spoken by the counsellor; do not reply to this " +
    "directly; it only updates how you feel]\n";

  // Low-level steering send. Uses role:"system" until the API rejects it (tracked
  // via steerFallbackToUserRef), then role:"user" with the internal-state prefix.
  // Records the send so the error handler can detect a steering-item rejection.
  const sendSteeringRaw = useCallback((s) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    const asUser = steerFallbackToUserRef.current;
    const text = asUser
      ? USER_STEER_PREFIX + "## CURRENT STATE (live update)\n" + s
      : "## CURRENT STATE (live update)\n" + s;
    try {
      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: asUser ? "user" : "system",
          content: [{ type: "input_text", text }],
        },
      }));
      lastSteerRef.current = { text: s, atMs: performance.now() };
      return true;
    } catch (err) {
      console.warn("[openai-realtime] steering send failed:", err?.message);
      return false;
    }
  }, [USER_STEER_PREFIX]);

  useEffect(() => { sendSteeringRawRef.current = sendSteeringRaw; }, [sendSteeringRaw]);

  const sendSteering = useCallback((steering) => {
    const s = (steering || "").trim();
    if (!s) return false;
    return sendSteeringRaw(s);
  }, [sendSteeringRaw]);

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
