import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/react";
import { api } from "../lib/api";

// ElevenLabs Conversational AI speech-to-speech over WebRTC.
//
// Uses the framework-agnostic `Conversation` class (re-exported by
// @elevenlabs/react) directly rather than the `useConversation` hook — the hook
// requires a <ConversationProvider> ancestor, which we don't want to thread
// through the app just for one optional engine. The class needs no provider.
//
// The provider owns the full low-latency voice loop (ASR + LLM + authentic Indian
// TTS); the server mints a per-conversation WebRTC token and the per-session
// overrides (persona prompt + the session's matching Indian student voice).
// MiniMax keeps grading via /observe, fed by transcript events surfaced through
// onTranscript({ role, text }).
//
// Exposes the same `voice`-like surface as the OpenAI realtime hook so CallStage
// and the shared call UI work unchanged.

export function useElevenLabsRealtime({ sessionId, onTranscript, onError, defaultVoice = "auto" } = {}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("off"); // off | loading | idle | listening | speaking
  const [error, setError] = useState(null);
  const [muted, setMutedState] = useState(true); // START MUTED — push-to-talk (hold Space)
  const [voice, setVoice] = useState(defaultVoice);

  const convRef = useRef(null);
  const enabledRef = useRef(false);
  const statusRef = useRef("off");
  const voiceRef = useRef(defaultVoice);
  // Desired mic-mute state. setMicMuted posts to an audio worklet that may not be
  // ready right after startSession (the SDK swallows that error), so we re-assert
  // this desired state on every lifecycle event (connect / mode change).
  const desiredMutedRef = useRef(true);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const sessionIdRef = useRef(sessionId);
  const lastBySourceRef = useRef({ user: "", ai: "" }); // de-dupe repeated finals
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  function setStatusBoth(s) { statusRef.current = s; setStatus(s); }

  // (Re-)assert the desired mic-mute state on the live conversation. Safe to call
  // repeatedly; tolerates the worklet-not-ready-yet error the SDK swallows.
  const applyMute = useCallback(() => {
    try { convRef.current?.setMicMuted?.(desiredMutedRef.current); } catch { /* noop */ }
  }, []);

  // Open a conversation with the given voice (voiceId or "auto"). Shared by enable()
  // and changeVoice() (which tears down + reopens with a new voice).
  const open = useCallback(async (useVoice) => {
    const sid = sessionIdRef.current;
    if (!sid) throw new Error("No session id for realtime connection.");
    const v = useVoice ?? voiceRef.current;
    const { token, overrides } = await api.getElevenLabsRealtimeToken(sid, v && v !== "auto" ? v : undefined);
    const conv = await Conversation.startSession({
      conversationToken: token,
      connectionType: "webrtc",
      overrides,
      onConnect: () => { if (enabledRef.current) setStatusBoth("idle"); applyMute(); },
      onDisconnect: () => {
        if (enabledRef.current) { enabledRef.current = false; setEnabled(false); setStatusBoth("off"); }
      },
      onError: (msg) => {
        const m = typeof msg === "string" ? msg : (msg?.message || msg?.reason || "ElevenLabs conversation error");
        setError(String(m));
        onErrorRef.current?.(new Error(String(m)));
      },
      onModeChange: ({ mode }) => {
        if (!enabledRef.current) return;
        setStatusBoth(mode === "speaking" ? "speaking" : "listening");
        applyMute(); // keep the worklet mute in sync once audio is live
      },
      onMessage: (m) => {
        const src = m?.source || m?.role;
        const text = (m?.message || m?.text || "").trim();
        if (!text || (src !== "user" && src !== "ai")) return;
        if (lastBySourceRef.current[src] === text) return;
        lastBySourceRef.current[src] = text;
        onTranscriptRef.current?.({ role: src === "user" ? "counsellor" : "student", text });
      },
    });
    convRef.current = conv;
    applyMute(); // assert the desired (muted) state as soon as the session is up
  }, [applyMute]);

  const enable = useCallback(async (useVoice) => {
    if (enabledRef.current) return;
    const sid = sessionIdRef.current;
    if (!sid) throw new Error("No session id for realtime connection.");
    setError(null);
    setEnabled(true);
    enabledRef.current = true;
    setStatusBoth("loading");
    if (useVoice) { voiceRef.current = useVoice; setVoice(useVoice); }
    try {
      await open(voiceRef.current);
      if (enabledRef.current && statusRef.current === "loading") setStatusBoth("idle");
    } catch (e) {
      console.error("[elevenlabs-realtime] enable failed:", e);
      setError(e?.message || String(e));
      enabledRef.current = false;
      setEnabled(false);
      setStatusBoth("off");
      throw e;
    }
  }, [open]);

  const disable = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    setStatusBoth("off");
    try { convRef.current?.endSession?.(); } catch { /* noop */ }
    convRef.current = null;
  }, []);

  // Live voice change: tear down + reopen with the new voice (the EL agent's voice
  // is set via the per-conversation override at start, so a change means reconnect).
  const changeVoice = useCallback(async (nextVoice) => {
    voiceRef.current = nextVoice;
    setVoice(nextVoice);
    if (!enabledRef.current) return;
    setStatusBoth("loading");
    try { convRef.current?.endSession?.(); } catch { /* noop */ }
    convRef.current = null;
    lastBySourceRef.current = { user: "", ai: "" };
    try {
      await open(nextVoice);
      if (enabledRef.current) setStatusBoth("idle");
    } catch (e) {
      setError(e?.message || String(e));
      enabledRef.current = false;
      setEnabled(false);
      setStatusBoth("off");
    }
  }, [open]);

  const setMuted = useCallback((m) => {
    desiredMutedRef.current = m;
    setMutedState(m);
    applyMute();
  }, [applyMute]);

  // Typed counsellor input → send to the agent and surface it ourselves (the
  // dedupe guard in onMessage skips any echo the SDK emits for the same text).
  const sendText = useCallback((text) => {
    const t = (text || "").trim();
    if (!t) return;
    try { convRef.current?.sendUserMessage?.(t); } catch { /* noop */ }
    lastBySourceRef.current.user = t;
    onTranscriptRef.current?.({ role: "counsellor", text: t });
  }, []);

  // Orb adapter: synthesise a centred pseudo-waveform whose RMS tracks the agent's
  // output frequency energy so the shared useCallAudioLevel (which expects an
  // AnalyserNode) reacts — visually faithful, not sample-accurate.
  const analyserAdapter = useMemo(() => ({
    frequencyBinCount: 128,
    getByteTimeDomainData(arr) {
      let energy = 0;
      try {
        const f = convRef.current?.getOutputByteFrequencyData?.();
        if (f && f.length) {
          let s = 0;
          for (let i = 0; i < f.length; i++) s += f[i];
          energy = (s / f.length) / 255;
        }
      } catch { /* not ready */ }
      const amp = Math.min(8, energy * 18);
      for (let i = 0; i < arr.length; i++) arr[i] = 128 + (i % 2 ? amp : -amp);
    },
  }), []);
  const getAnalyser = useCallback(() => (enabledRef.current ? analyserAdapter : null), [analyserAdapter]);

  useEffect(() => () => { try { convRef.current?.endSession?.(); } catch { /* noop */ } }, []);

  return {
    engine: "elevenlabs",
    enabled, status, loadPct: 0, error, muted, voice,
    enable, disable, setMuted, getAnalyser, sendText, changeVoice,
    // classic-only no-ops so shared UI/handlers are safe.
    speak: () => {}, speakChunk: () => {}, beginUtterance: () => {}, endUtterance: () => {},
    stopSpeaking: () => {}, startListening: () => {}, stopListening: () => {},
  };
}
