import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { loadStoredMicDevice, saveStoredMicDevice } from "./engines";

// Build the getUserMedia audio constraints, layering the optional preferred
// device on top of the standard echo-cancellation/noise-suppression/mono config.
// We use deviceId.ideal (NOT exact) so a vanished device falls back to the system
// default instead of throwing OverconstrainedError.
function micConstraints(deviceId) {
  const audio = { echoCancellation: true, noiseSuppression: true, channelCount: 1 };
  if (deviceId) audio.deviceId = { ideal: deviceId };
  return { audio };
}

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
//
// Periodic accent RE-PROMPT (issue #1 — accent must not fade): on a long call the
// connect-time accent instructions slide out of the model's working context and the
// voice drifts to neutral. A one-line nudge was not enough, so every ~3 completed
// student turns we RE-INJECT the WHOLE Indian-accent instruction block again — not a
// short reminder — through the same non-destructive system-injection path as
// steering. Cheap relative to the call; far cheaper than re-minting the token.
const ACCENT_REPROMPT_EVERY = 3;

// The detailed accent rules — restated IN FULL each time. This is the single
// client-side source of truth for the re-prompt; it mirrors INDIAN_ACCENT_BLOCK in
// server/realtime.js (the client bundle cannot import server code). If you change
// the wording, change it in both places.
const INDIAN_ACCENT_BLOCK = [
  "ACCENT — THE #1 RULE, NEVER RELAX IT:",
  "- Speak with an authentic, natural INDIAN ENGLISH accent for EVERY word of EVERY turn — this is the single most important thing about how you sound, and it NEVER fades.",
  "- As the call runs long it is easy to slip toward a neutral, American or British accent. DO NOT. The moment you notice yourself flattening out, pull straight back. Your accent now must sound exactly as Indian as at the start of the call.",
  "- Rhythm is SYLLABLE-TIMED: give each syllable roughly equal weight; do NOT stress syllables the American/British way. Pronounce \"v\" and \"w\" the same. Question tags (\"isn't it?\", \"na?\", \"right?\") rise on the last syllable; sentence ends stay flat or slightly rising, not falling sharply.",
  "- Keep the natural Indian-English texture: light Hindi particles (haan, thoda, achha, matlab, sentence-final \"na\"), an occasional filler, the syllable-timed rhythm. This is your home base — do not drift to a flat neutral voice.",
].join("\n");

// A short lead-in that varies each time so the re-prompt does not read as an
// identical stuck loop. The full accent block above follows it verbatim.
const ACCENT_REPROMPT_LEADINS = [
  "Reminder on how you must sound for the rest of this call:",
  "Hold your voice exactly here — re-read these accent rules and apply them right now:",
  "Your accent may be drifting as the call runs long. Reset to these rules in full:",
  "Quick voice check — stay anchored to all of this, not just part of it:",
];

// Build one full re-prompt message: a varied lead-in + the WHOLE accent block.
function buildAccentReprompt(seq) {
  const lead = ACCENT_REPROMPT_LEADINS[seq % ACCENT_REPROMPT_LEADINS.length];
  return `${lead}\n\n${INDIAN_ACCENT_BLOCK}`;
}

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
  // Whole-call counsellor-audio recorder (for spoken-English fluency analysis).
  const recorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
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
  const micSrcRef = useRef(null);       // MediaStreamSource feeding the mic analyser (disconnect on re-point)
  const utterRef = useRef(null); // { startMs, durMs, segments, speaking, segStartMs, rms: [], responseLatencyMs? }
  // Timestamp (performance.now()) when the AI's audio last stopped — used to
  // measure how long the counsellor waited before starting their reply.
  const aiStoppedAtRef = useRef(null);
  // OpenAI realtime usage from the latest response.done — attached to the next
  // student transcript so the server can record voice cost.
  const lastResponseUsageRef = useRef(null);
  // A finished utterance whose transcription hasn't arrived yet. OpenAI can fire
  // speech_started(N+1) BEFORE transcription.completed(N); without this snapshot
  // the late transcript would read (and then reset) N+1's accumulator, corrupting
  // both utterances' metrics.
  const pendingUtterRef = useRef(null);
  const rmsTimerRef = useRef(null);

  // Steering-role fallback (C3 defensive): we send the live-state item with
  // role:"system". If the GA Realtime API rejects that (it may only accept
  // user/assistant conversation items), an error event arrives within ~2s of the
  // send — we flip to role:"user" with an internal-state prefix and re-send, then
  // use "user" for all future steering. Module-lifetime via refs; never throws.
  const steerFallbackToUserRef = useRef(false);
  const lastSteerRef = useRef(null); // { text, atMs, eventId } of the most recent steering send
  const steerSeqRef = useRef(0); // client event_id sequence for steering sends
  const steerWarnedRef = useRef(false);
  const sendSteeringRawRef = useRef(null); // points at sendSteeringRaw (set below; lets handleEvent re-send)

  // Periodic accent RE-PROMPT (issue #1): the standing voice instructions set the
  // Indian-English accent at connect time, but over a long call that fades from
  // context and the accent drifts to neutral. Every ~3 completed student turns we
  // re-inject the WHOLE Indian-accent instruction block (varied lead-in, full rules
  // re-stated) through the same non-destructive system-injection path as steering.
  const studentTurnCountRef = useRef(0);
  const accentReminderSeqRef = useRef(0);

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

  // (Re)point the local-mic AnalyserNode (delivery-metrics energy sampler) at the
  // given stream. Reuses the existing AudioContext on a mic switch so we don't leak
  // contexts; disconnects the prior source node first. The analyser is tap-only
  // (never routed to output). Returns the AudioContext (or null on failure) so the
  // initial connect can register it on micCtxRef for teardown. Never throws.
  function setupMicAnalyser(stream) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      let ctx = micCtxRef.current;
      if (!ctx) {
        ctx = new AC();
        micCtxRef.current = ctx;
      }
      ctx.resume?.().catch(() => {});
      try { micSrcRef.current?.disconnect(); } catch { /* old source already gone */ }
      const micSrc = ctx.createMediaStreamSource(stream);
      let analyser = micAnalyserRef.current;
      if (!analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        micAnalyserRef.current = analyser;
      }
      micSrc.connect(analyser); // analyser only — not routed to output
      micSrcRef.current = micSrc;
      return ctx;
    } catch (err) {
      console.warn("[openai-realtime] mic analyser setup failed (no energyVar):", err?.message);
      return null;
    }
  }

  // Compute the metrics object for the just-completed counsellor utterance from
  // the accumulated VAD timing + RMS samples and the transcript word count. Any
  // metric that can't be honestly computed is omitted.
  function computeDeliveryMetrics(text) {
    // Prefer the pending (already-finished) utterance: a late transcription
    // belongs to it, not to whatever the counsellor is saying right now.
    const u = pendingUtterRef.current || utterRef.current;
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

    // Response latency: time between AI stopping and counsellor starting to speak.
    if (u.responseLatencyMs != null) out.responseLatencyMs = u.responseLatencyMs;

    // Derived verdict/tone fields forwarded to /observe for voice_delivery grading.
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

  // ── Whole-call counsellor-audio recording (fluency analysis) ──
  // Records the SAME mic track already sent over WebRTC (no second getUserMedia).
  // Records only the counsellor — never the student's synthesized voice.
  function startCallRecording(stream) {
    try {
      const track = stream?.getAudioTracks?.()[0];
      if (!track || typeof MediaRecorder === "undefined") return;
      recordedChunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : (MediaRecorder.isTypeSupported?.("audio/webm") ? "audio/webm" : "");
      const rec = new MediaRecorder(
        new MediaStream([track]),
        mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 },
      );
      rec.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunksRef.current.push(e.data); };
      rec.start(3000); // 3s timeslice so chunks accrue even if the tab is killed
      recorderRef.current = rec;
    } catch {
      recorderRef.current = null; // recording is best-effort — never block the call
    }
  }

  // Stop the recorder and resolve the assembled blob (null if nothing recorded).
  // Call this BEFORE disable()/teardown so the final chunk flushes.
  const finishRecording = useCallback(() => new Promise((resolve) => {
    const rec = recorderRef.current;
    const assemble = () => {
      const chunks = recordedChunksRef.current;
      if (!chunks.length) return null;
      return new Blob(chunks, { type: rec?.mimeType || chunks[0]?.type || "audio/webm" });
    };
    if (!rec || rec.state === "inactive") { resolve(assemble()); return; }
    rec.onstop = () => resolve(assemble());
    try { rec.requestData?.(); } catch { /* noop */ }
    try { rec.stop(); } catch { resolve(assemble()); }
  }), []);

  const teardown = useCallback(() => {
    stopRmsSampling();
    try { if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* noop */ }
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
    micSrcRef.current = null;
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
        // If the previous utterance finished but its transcription hasn't landed
        // yet, park it so the late transcript reads the right accumulator and
        // this new utterance starts clean.
        const prev = utterRef.current;
        if (prev && !prev.speaking && prev.durMs > 0 && prev.segments > 0) {
          pendingUtterRef.current = prev;
          resetUtterance();
        }
        const u = utterRef.current;
        if (u.segments === 0 && u.durMs === 0) {
          u.startMs = now;
          // Measure how long after the AI stopped speaking the counsellor started.
          // Only record for the first segment of this utterance (segments === 0).
          if (aiStoppedAtRef.current != null) {
            const latencyMs = now - aiStoppedAtRef.current;
            if (latencyMs >= 0) u.responseLatencyMs = Math.round(latencyMs);
            aiStoppedAtRef.current = null; // consumed
          }
        }
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
        const wasPending = !!pendingUtterRef.current;
        if (text) {
          const deliveryMetrics = computeDeliveryMetrics(text);
          const transcriptionUsage = evt.usage || null;
          onTranscriptRef.current?.({ role: "counsellor", text, deliveryMetrics, transcriptionUsage });
        }
        if (wasPending) {
          // The transcript belonged to the parked utterance — the live accumulator
          // is the NEXT utterance (possibly mid-speech); leave it and its sampler alone.
          pendingUtterRef.current = null;
        } else {
          // Close out the utterance window for the next counsellor turn.
          stopRmsSampling();
          resetUtterance();
        }
        break;
      }
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
        if (enabledRef.current) setStatusBoth("speaking");
        break;
      case "output_audio_buffer.stopped":
        // Record when AI audio ends — used to measure counsellor response latency.
        aiStoppedAtRef.current = performance.now();
        if (enabledRef.current && statusRef.current === "speaking") setStatusBoth("idle");
        break;
      case "response.done":
        if (enabledRef.current && statusRef.current === "speaking") setStatusBoth("idle");
        // Capture token usage for this response; attached to the student transcript below.
        if (evt.response?.usage) lastResponseUsageRef.current = evt.response.usage;
        break;
      // The student's spoken reply, transcribed — marks a completed turn pair.
      case "response.output_audio_transcript.done": {
        const text = (evt.transcript || "").trim();
        const realtimeUsage = lastResponseUsageRef.current;
        lastResponseUsageRef.current = null;
        if (text) onTranscriptRef.current?.({ role: "student", text, realtimeUsage });
        // Periodic accent RE-PROMPT: every ~3 completed student turns, re-inject the
        // WHOLE Indian-accent instruction block (with a varied lead-in) back into the
        // model's context through the non-destructive injection path, so the accent
        // never fades on a long call.
        studentTurnCountRef.current += 1;
        if (studentTurnCountRef.current % ACCENT_REPROMPT_EVERY === 0) {
          const msg = buildAccentReprompt(accentReminderSeqRef.current++);
          sendSteeringRawRef.current?.(msg);
        }
        break;
      }
      case "error": {
        const msg = evt.error?.message || "OpenAI realtime error";
        // Attribute this error to our steering item ONLY when the API echoes the
        // client event_id of the steering send (or, for servers that omit it, when
        // the message clearly references the role/item AND the send was recent).
        // Anything else is a real error and must surface — the old pure-timing
        // heuristic swallowed unrelated errors and flipped to user-role forever.
        const last = lastSteerRef.current;
        const recent = last && (performance.now() - last.atMs) < 2000;
        const echoedId = evt.error?.event_id || evt.event_id;
        const mentionsSteering = /\brole\b|\bsystem\b|\bitem\b/i.test(msg);
        const isSteeringRejection =
          (last && echoedId && echoedId === last.eventId) ||
          (recent && !echoedId && mentionsSteering);
        if (!steerFallbackToUserRef.current && isSteeringRejection) {
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

    // Fresh peer connection — restart the periodic accent-reminder cadence so a
    // reconnect (e.g. live voice swap) does not fire one immediately or skip it.
    studentTurnCountRef.current = 0;

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

    // 2. Mic. Honour the counsellor's stored input-device choice (ideal → falls
    //    back to the system default if that device is gone).
    const storedMic = loadStoredMicDevice();
    const micStream = await navigator.mediaDevices.getUserMedia(micConstraints(storedMic.deviceId));
    if (gen !== connectGenRef.current) {
      micStream.getTracks().forEach((t) => t.stop()); // local capture — don't touch refs
      return;
    }
    micStreamRef.current = micStream;
    startCallRecording(micStream);

    // Local mic AnalyserNode tap for delivery-metrics energy variance (separate
    // from the remote-audio analyser that drives the orb).
    const micCtx = setupMicAnalyser(micStream);
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

  // Hot-swap the microphone input device WITHOUT reconnecting: getUserMedia the
  // new device, replaceTrack() on the existing audio RTCRtpSender (so the WebRTC
  // call keeps running and the ephemeral token is not re-minted), stop the old mic
  // track(s), and re-point the local delivery-metrics analyser at the new stream.
  // The new track inherits the current mute state. Persists the choice. On any
  // failure the old track keeps running and we surface the error via onError —
  // never throws.
  const changeMic = useCallback(async (deviceId, label = "") => {
    const id = deviceId && deviceId !== "default" ? deviceId : null;
    const pc = pcRef.current;
    // Persist the preference regardless — so the next connect honours it even if
    // we're not currently live (no peer connection to replaceTrack on yet).
    saveStoredMicDevice(id, label);
    if (!enabledRef.current || !pc) return;

    let newStream = null;
    try {
      newStream = await navigator.mediaDevices.getUserMedia(micConstraints(id));
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) throw new Error("Selected microphone produced no audio track.");

      // Match the live mute state before the track goes on the wire.
      newTrack.enabled = !mutedRef.current;

      // Swap into the existing audio sender (no renegotiation needed for same-kind
      // track replacement). If for some reason there's no audio sender, bail
      // without disturbing the current mic.
      const sender = pc.getSenders?.().find((s) => s.track && s.track.kind === "audio");
      if (!sender) throw new Error("No audio sender on the peer connection.");
      await sender.replaceTrack(newTrack);

      // Stop the OLD mic track(s) only after the swap succeeds.
      const oldStream = micStreamRef.current;
      micStreamRef.current = newStream;
      try { oldStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }

      // Re-point the delivery-metrics energy analyser at the new stream so WPM/
      // pauses keep working and energyVar tracks the new input.
      setupMicAnalyser(newStream);
    } catch (err) {
      // Keep the existing mic running; clean up the half-acquired new stream.
      try { newStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      const msg = err?.message || "Could not switch microphone.";
      console.warn("[openai-realtime] changeMic failed:", msg);
      setError(msg);
      onErrorRef.current?.(new Error(msg));
    }
  }, []);

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
      // Client event_id lets the error handler attribute a rejection to THIS
      // send specifically instead of guessing from timing alone.
      const eventId = `steer_${++steerSeqRef.current}`;
      dc.send(JSON.stringify({
        event_id: eventId,
        type: "conversation.item.create",
        item: {
          type: "message",
          role: asUser ? "user" : "system",
          content: [{ type: "input_text", text }],
        },
      }));
      lastSteerRef.current = { text: s, atMs: performance.now(), eventId };
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

  useEffect(() => () => {
    enabledRef.current = false;
    // Mark any in-flight connect() stale BEFORE teardown: a token fetch resolving
    // after unmount would otherwise pass its generation checks and stand up a
    // zombie peer connection + live mic on a dead component.
    ++connectGenRef.current;
    teardown();
  }, [teardown]);

  return {
    engine: "openai",
    enabled, status, loadPct: 0, error, voice, muted,
    enable, disable, changeVoice, changeMic, setMuted, getAnalyser, sendText, sendSteering, finishRecording,
    // classic-only no-ops so shared UI/handlers are safe when this engine is active
    speak: () => {}, speakChunk: () => {}, beginUtterance: () => {}, endUtterance: () => {},
    stopSpeaking: () => {}, startListening: () => {}, stopListening: () => {},
  };
}
