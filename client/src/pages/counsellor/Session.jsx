import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { postMessageStream, stripStreamingEmotionTag, createSentenceChunker } from "../../lib/stream";
import { useAuth } from "../../lib/auth.jsx";
import { useVoiceConversation } from "../../voice/useVoiceConversation";
import { useOpenAIRealtime } from "../../voice/useOpenAIRealtime";
import { useElevenLabsRealtime } from "../../voice/useElevenLabsRealtime";
import {
  isS2SEngine, ENGINE_CLASSIC, DEFAULT_OPENAI_VOICE, DEFAULT_ELEVEN_VOICE,
  OPENAI_VOICE_STORAGE_KEY, ELEVEN_VOICE_STORAGE_KEY,
} from "../../voice/engines";
import Button from "../../ui/Button";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import Modal from "../../ui/Modal";
import GreenRoom from "./session/GreenRoom";
import CallStage from "./session/CallStage";
import CallSidebar from "./session/CallSidebar";

// ── Connecting overlay ────────────────────────────────────────────────────────
function ConnectingScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-stage">
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "radial-gradient(circle, #6366f1 0%, #4338ca 60%, transparent 100%)",
          animation: "orb-pulse 2s ease-in-out infinite",
        }}
      />
      <p className="text-base font-medium text-stage-muted">
        Connecting you to the student…
      </p>
    </div>
  );
}

// ── Voice-loading gate (S7) ───────────────────────────────────────────────────
// Full-screen overlay while the TTS/STT pipeline downloads/initialises. Blocks
// all call interaction until voice.status leaves 'loading'. Shows a progress ring.
function VoiceLoadingScreen({ pct = 0 }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const R = 34;
  const C = 2 * Math.PI * R;
  const dash = (clamped / 100) * C;
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-stage">
      <svg width="88" height="88" viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="44" cy="44" r={R} fill="none" stroke="#262a36" strokeWidth="6" />
        <circle
          cx="44"
          cy="44"
          r={R}
          fill="none"
          stroke="#6366f1"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
          style={{ transition: "stroke-dasharray 250ms ease" }}
        />
      </svg>
      <div className="text-center">
        <p className="text-base font-semibold text-stage-text">
          Preparing the call… {clamped}%
        </p>
        <p className="mt-1 text-sm text-stage-muted">
          Loading the voice models — this happens once, then they&apos;re cached.
        </p>
      </div>
    </div>
  );
}

// ── Ended session screen ──────────────────────────────────────────────────────
function EndedScreen({ onViewReports, onBack }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-stage px-6">
      <div className="w-full max-w-sm rounded-2xl border border-stage-line bg-stage-raised p-8 text-center shadow-xl">
        <p className="text-base font-semibold text-stage-text">This call has ended.</p>
        <p className="mt-2 text-sm text-stage-muted">
          The session is complete. You can view your coaching report or return to your mocks.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={onViewReports}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            View reports
          </button>
          <button
            onClick={onBack}
            className="w-full rounded-xl border border-stage-line bg-transparent px-4 py-2.5 text-sm font-medium text-stage-muted hover:text-stage-text transition-colors"
          >
            Back to My Mocks
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Wrapping overlay ──────────────────────────────────────────────────────────
function WrappingScreen({ error, onRetry, onBackToCall }) {
  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-stage px-6">
        <div className="w-full max-w-sm rounded-2xl border border-stage-line bg-stage-raised p-8 text-center shadow-xl">
          <p className="text-base font-semibold text-stage-text">
            Report generation hit a snag.
          </p>
          <p className="mt-2 text-sm text-stage-muted">
            Your call is safe — try again.
          </p>
          <p className="mt-3 text-xs text-danger opacity-80">{error}</p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={onRetry}
              className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              Try again
            </button>
            <button
              onClick={onBackToCall}
              className="w-full rounded-xl border border-stage-line bg-transparent px-4 py-2.5 text-sm font-medium text-stage-muted hover:text-stage-text transition-colors"
            >
              Back to call
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-stage">
      {/* Dimmed / pulsing orb */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "radial-gradient(circle, #6366f1 0%, #4338ca 60%, transparent 100%)",
          opacity: 0.45,
          animation: "orb-pulse 2s ease-in-out infinite",
        }}
      />
      {/* Skeleton shimmer blocks */}
      <div className="flex flex-col items-center gap-3">
        <div
          style={{ width: 200, height: 12, borderRadius: 6 }}
          className="animate-pulse bg-stage-raised"
        />
        <div
          style={{ width: 140, height: 10, borderRadius: 6 }}
          className="animate-pulse bg-stage-raised opacity-60"
        />
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-stage-text">Wrapping up the call…</p>
        <p className="mt-1 text-sm text-stage-muted">
          Generating your coaching report — usually takes ~20 seconds.
        </p>
      </div>
    </div>
  );
}

// ── Degradation toast stack ───────────────────────────────────────────────────
// Lightweight, dependency-free banner stack for degradation notices:
//   - SSE error events (e.g. reply timed out)
//   - report fallback after session end (LLM unreachable → report degraded)
function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "min(92vw, 460px)",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 12,
            background: t.tone === "danger" ? "rgba(45,18,18,0.96)" : "rgba(38,30,12,0.96)",
            border: `1px solid ${t.tone === "danger" ? "#7f1d1d" : "#854d0e"}`,
            color: t.tone === "danger" ? "#fca5a5" : "#fcd9a5",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            fontSize: "0.8125rem",
            lineHeight: 1.45,
          }}
        >
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              opacity: 0.7,
              fontSize: "0.9375rem",
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Main Session component ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // ── State machine ──────────────────────────────────────────────────────────
  // "greenroom" → "connecting" → ("voice-loading" →) "live"
  const isNewRoute = !sessionId;
  const [uiState, setUiState] = useState(isNewRoute ? "greenroom" : "live");

  // ── Green room data ────────────────────────────────────────────────────────
  const [grAssignment, setGrAssignment] = useState(null);
  const [grPersona, setGrPersona] = useState(null);
  const [grCourse, setGrCourse] = useState(null);
  const [grScenario, setGrScenario] = useState(null);
  const [grMode, setGrMode] = useState(null);
  const [grPayload, setGrPayload] = useState(null);
  const [grLoading, setGrLoading] = useState(isNewRoute);
  const [grError, setGrError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);

  // ── Live session data ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState(!isNewRoute);
  const [error, setError] = useState(null);
  const [persona, setPersona] = useState(null);
  const [messages, setMessages] = useState([]);
  const [phase, setPhase] = useState(1);
  const [score, setScore] = useState(0);
  const [emotion, setEmotion] = useState("neutral");
  const [activeSessionId, setActiveSessionId] = useState(sessionId || null);
  const [timerStart, setTimerStart] = useState(null);
  const [studentVoiceId, setStudentVoiceId] = useState(null);

  // ── Voice engine (classic | openai | elevenlabs) ───────────────────────────
  // Resolved from the green-room choice (router state) on join, then authoritative
  // from the session record on the live route. The two S2S engines run the voice
  // browser↔provider; MiniMax grades each turn via /observe.
  const [voiceEngine, setVoiceEngine] = useState(location.state?.voiceEngine || ENGINE_CLASSIC);
  const [openaiVoice, setOpenaiVoice] = useState(location.state?.openaiVoice || DEFAULT_OPENAI_VOICE);
  const [elevenVoice, setElevenVoice] = useState(location.state?.elevenVoice || DEFAULT_ELEVEN_VOICE);
  const openaiVoiceRef = useRef(openaiVoice);
  const elevenVoiceRef = useRef(elevenVoice);
  useEffect(() => { openaiVoiceRef.current = openaiVoice; }, [openaiVoice]);
  useEffect(() => { elevenVoiceRef.current = elevenVoice; }, [elevenVoice]);
  // The engine-appropriate voice to enable the active S2S hook with.
  const engineVoiceFor = (eng) => (eng === "openai" ? openaiVoiceRef.current : eng === "elevenlabs" ? elevenVoiceRef.current : undefined);

  // ── Info panel data (course facts / scenario / blind-mode flag) ─────────────
  const [course, setCourse] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [leadCard, setLeadCard] = useState(null);
  const [revealPersona, setRevealPersona] = useState(true);

  // ── Thinking mode (S1): default OFF; an in-call toggle flips it. Threaded into
  // the message body so the student reply call re-enables MiniMax reasoning. ────
  const [thinkingOn, setThinkingOn] = useState(false);
  const thinkingOnRef = useRef(false);
  useEffect(() => { thinkingOnRef.current = thinkingOn; }, [thinkingOn]);

  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [wrappingError, setWrappingError] = useState(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState("transcript");
  const [showSat, setShowSat] = useState(true);
  const [micLatched, setMicLatched] = useState(false);
  const [pttHeld, setPttHeld] = useState(false);

  // ── Coach data ─────────────────────────────────────────────────────────────
  const [scoreHistory, setScoreHistory] = useState([]);
  const [milestones, setMilestones] = useState(null);
  const [lastDeliveryMetrics, setLastDeliveryMetrics] = useState(null);

  // ── Live coaching cue ──────────────────────────────────────────────────────
  // The instant (corpus) cue lands on each message done payload; we then
  // fire-and-forget a richer LLM cue and swap it in — but only if no newer turn
  // has arrived since (guarded by turnCounterRef).
  const [cue, setCue] = useState(null);
  const [cueRefining, setCueRefining] = useState(false);
  const turnCounterRef = useRef(0);

  // ── Degradation toasts ─────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  function pushToast(message, { tone = "warn", ttl = 6000 } = {}) {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    if (ttl) setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl);
  }
  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const sendingRef = useRef(false);
  const submitRef = useRef(null);
  const spaceDownRef = useRef(false);
  const sidebarInputRef = useRef(null);
  // Realtime (S2S) transcript handler + a sequential queue so /observe calls land
  // in transcript order. Assigned after the handler is defined (like submitRef).
  const realtimeTranscriptRef = useRef(null);
  const observeChainRef = useRef(Promise.resolve());

  // ── Voice pipelines ────────────────────────────────────────────────────────
  // All three hooks are created unconditionally (hook rules); only the selected
  // engine is enabled. `voice` is the active one, passed to the shared call UI.
  const classicVoice = useVoiceConversation({
    onUserUtterance: (t, meta) => submitRef.current?.(t, meta),
    ttsVoiceId: studentVoiceId,
  });
  const openaiRT = useOpenAIRealtime({
    sessionId: activeSessionId,
    defaultVoice: openaiVoice,
    onTranscript: (e) => realtimeTranscriptRef.current?.(e),
  });
  const elevenRT = useElevenLabsRealtime({
    sessionId: activeSessionId,
    defaultVoice: elevenVoice,
    onTranscript: (e) => realtimeTranscriptRef.current?.(e),
  });
  const s2s = isS2SEngine(voiceEngine);
  const voice = voiceEngine === "openai" ? openaiRT : voiceEngine === "elevenlabs" ? elevenRT : classicVoice;

  // ── Derived orbState ───────────────────────────────────────────────────────
  // awaitingReply (sending=true) → "thinking"
  // voice speaking  → "speaking"
  // PTT held / mic latched + recording  → "listening"
  // else → "idle"
  const awaitingReply = sending;
  let orbState = "idle";
  if (awaitingReply) {
    orbState = "thinking";
  } else if (voice.status === "speaking") {
    orbState = "speaking";
  } else if (voice.status === "listening" || pttHeld || (micLatched && voice.status === "recording")) {
    // "listening" is emitted by the S2S engines while the counsellor is speaking.
    orbState = "listening";
  }

  // Subtitle: last student message text.
  const lastStudentMsg = [...messages].reverse().find((m) => m.role === "student");
  const subtitle = lastStudentMsg?.text || "";

  // ── Green room: resolve data from router state ─────────────────────────────
  useEffect(() => {
    if (!isNewRoute) return;

    const state = location.state;
    if (!state) {
      navigate("/app/mocks", { replace: true });
      return;
    }

    const mode = state.mode || "practice";
    setGrMode(mode);

    let alive = true;
    setGrLoading(true);
    setGrError(null);

    async function resolve() {
      if (mode === "assigned") {
        const { assignmentId } = state;
        if (!assignmentId) throw new Error("No assignment specified.");

        const assignment = await api.getAssignment(assignmentId);
        if (!alive) return;
        setGrAssignment(assignment);

        let resolvedPersona = null;
        if (assignment.personaId) {
          const personas = await api.getPersonas();
          if (!alive) return;
          resolvedPersona = personas.find((p) => p.id === assignment.personaId) || null;
        }
        setGrPersona(resolvedPersona);

        let resolvedCourse = null;
        if (assignment.courseId) {
          const courses = await api.getCourses();
          if (!alive) return;
          resolvedCourse = courses.find((c) => c.id === assignment.courseId) || null;
        }
        setGrCourse(resolvedCourse);

        setGrScenario(assignment.scenario || null);

        setGrPayload({
          mode: "assigned",
          assignmentId,
          counsellorId: user?.id,
        });
      } else {
        const { personaId, courseId, profileId, scenario: sc } = state;

        let resolvedPersona = null;
        if (personaId) {
          const personas = await api.getPersonas();
          if (!alive) return;
          resolvedPersona = personas.find((p) => p.id === personaId) || null;
        }
        setGrPersona(resolvedPersona);

        let resolvedCourse = null;
        if (courseId) {
          const courses = await api.getCourses();
          if (!alive) return;
          resolvedCourse = courses.find((c) => c.id === courseId) || null;
        }
        setGrCourse(resolvedCourse);

        setGrScenario(sc || null);

        setGrPayload({
          mode: "practice",
          counsellorId: user?.id,
          personaId: personaId || undefined,
          courseId: courseId || undefined,
          profileId: profileId || undefined,
          scenario: sc || undefined,
        });
      }
    }

    resolve()
      .catch((err) => {
        if (alive) setGrError(err?.message || "Could not load session brief.");
      })
      .finally(() => {
        if (alive) setGrLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [isNewRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Green room join handler ────────────────────────────────────────────────
  async function handleJoin(withVoice, opts = {}) {
    if (!grPayload) return;
    const engine = opts.engine || voiceEngine || ENGINE_CLASSIC;
    const oaVoice = opts.openaiVoice || openaiVoice;
    const elVoice = opts.elevenVoice || elevenVoice;
    // The two S2S engines are voice-native (the provider owns the conversation),
    // so a "join without voice" still connects the realtime session.
    const useVoice = isS2SEngine(engine) ? true : withVoice;
    setVoiceEngine(engine);
    setOpenaiVoice(oaVoice);
    setElevenVoice(elVoice);
    setJoinError(null);
    setJoining(true);
    setUiState("connecting");

    try {
      // S6: counsellor opens the call (no student-first opening message).
      // S1: thinking defaults OFF for the live conversation.
      const res = await api.startSession({
        ...grPayload,
        counsellorFirst: true,
        thinkingMode: "off",
        voiceEngine: engine,
        openaiVoice: oaVoice,
        elevenVoiceId: elVoice,
      });
      const newId = res.sessionId;
      setActiveSessionId(newId);
      navigate(`/app/session/${newId}`, {
        replace: true,
        state: { autoVoice: useVoice, voiceEngine: engine, openaiVoice: oaVoice, elevenVoice: elVoice },
      });
    } catch (err) {
      setJoinError(err?.message || "Could not start the session. Please try again.");
      setJoining(false);
      setUiState("greenroom");
    }
  }

  // ── Live session: load on mount ────────────────────────────────────────────
  useEffect(() => {
    if (isNewRoute) return;

    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getSession(sessionId)
      .then((s) => {
        if (!alive) return;
        // Ended session: render a dedicated "call has ended" screen instead of live UI.
        if (s.status === "ended") {
          setUiState("ended");
          setLoading(false);
          return;
        }
        // Resolve persona snapshot, masking name for blind assignments.
        let resolvedPersona = s.personaSnapshot || null;
        // S8: course facts + scenario for the persistent info panel (snapshotted
        // at session start so library edits don't rewrite the live brief).
        setCourse(s.courseSnapshot || null);
        setScenario(s.scenarioSnapshot || null);
        setLeadCard(s.leadCard || null);
        // revealPersona: prefer the session snapshot; fall back to the assignment.
        const sessionReveal =
          typeof s.revealPersona === "boolean" ? s.revealPersona : null;
        if (sessionReveal !== null) setRevealPersona(sessionReveal);

        const assignmentFetch = s.assignmentId
          ? api.getAssignment(s.assignmentId).catch(() => null)
          : Promise.resolve(null);

        assignmentFetch.then((asn) => {
          if (!alive) return;
          // Fall back to the assignment's revealPersona when the session lacks one.
          const blind =
            sessionReveal !== null
              ? sessionReveal === false
              : asn?.revealPersona === false;
          if (sessionReveal === null && asn) {
            setRevealPersona(asn.revealPersona !== false);
          }
          if (blind && resolvedPersona) {
            resolvedPersona = { ...resolvedPersona, name: "Prospective student" };
          }
          setPersona(resolvedPersona);
        });

        setPhase(s.currentPhase || 1);
        setScore(s.satisfactionScore ?? 0);
        setStudentVoiceId(s.voice?.elevenLabsVoiceId ?? null);
        // Voice engine is authoritative from the session record on the live route.
        if (s.voiceEngine) setVoiceEngine(s.voiceEngine);
        if (s.openaiVoice) setOpenaiVoice(s.openaiVoice);
        if (s.elevenVoiceId) setElevenVoice(s.elevenVoiceId);
        setTimerStart(s.startedAt ? new Date(s.startedAt).getTime() : Date.now());
        const transcript = Array.isArray(s.transcript) ? s.transcript : [];
        const msgs = transcript.map((m, i) => ({
          id: `t${i}`,
          role: m.role,
          text: m.text,
          emotion: m.emotion ?? "neutral",
        }));
        setMessages(msgs);
        // Seed scoreHistory from transcript scores if available.
        if (Array.isArray(s.scoreHistory)) {
          setScoreHistory(s.scoreHistory);
        } else if (s.satisfactionScore != null) {
          setScoreHistory([{ turn: 0, score: s.satisfactionScore }]);
        }
        // Seed milestones from session data.
        if (s.milestones) setMilestones(s.milestones);
        // Set initial emotion from last student message.
        const lastStudent = [...msgs].reverse().find((m) => m.role === "student");
        if (lastStudent?.emotion) setEmotion(lastStudent.emotion);
        // The /new and /:sessionId routes share this component instance, so a
        // join's "connecting" state survives the navigate — flip to live here.
        setJoining(false);
        setUiState("live");
      })
      .catch((e) => {
        if (alive) {
          setError(e?.message || "Could not load this session.");
          setJoining(false);
          setUiState("live");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionId, isNewRoute]);

  // ── Auto-enable voice after join (S7: hold on a load gate) ─────────────────
  // When the counsellor joined WITH voice, enable the pipeline and HOLD on a
  // full-screen loading overlay (voice.loadPct) so they can't interact before
  // the TTS/STT models are ready. Text-only joins skip straight to live.
  const autoVoiceHandled = useRef(false);
  const voiceGatePending = useRef(false);
  const voiceGateSawLoading = useRef(false);
  useEffect(() => {
    if (isNewRoute) return;
    if (autoVoiceHandled.current) return;
    const autoVoice = location.state?.autoVoice;
    if (!autoVoice) return;
    if (loading) return;
    autoVoiceHandled.current = true;
    voiceGatePending.current = true;
    voiceGateSawLoading.current = false;
    setTimerStart((t) => t || Date.now());
    // Gate on the loading overlay until the pipeline is ready (handled below).
    setUiState("voice-loading");
    // Enable the active engine with its engine-appropriate voice.
    voice.enable(engineVoiceFor(voiceEngine)).then(() => {
      // S2S starts MUTED — the counsellor holds Space to talk (push-to-talk).
      if (isS2SEngine(voiceEngine)) voice.setMuted?.(true);
    }).catch(() => {
      // Enable failed — drop the gate and let the counsellor proceed text-first.
      voiceGatePending.current = false;
      setUiState("live");
    });
    // Clear the autoVoice flag so back-navigation doesn't re-trigger it.
    navigate(location.pathname, { replace: true, state: {} });
  }, [isNewRoute, loading, location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Release the voice load gate once the pipeline finishes loading. enable()
  // flips status to 'loading' then 'idle' on success, or back to 'off' on error.
  // We wait until we've SEEN 'loading' (so the initial 'off' before enable's
  // state flush doesn't release us prematurely), then go live on the next status.
  useEffect(() => {
    if (!voiceGatePending.current) return;
    if (voice.status === "loading") {
      voiceGateSawLoading.current = true;
      return;
    }
    if (!voiceGateSawLoading.current && voice.status === "off") return;
    // 'idle' (ready) or 'off' (enable failed) after loading → release the gate.
    voiceGatePending.current = false;
    setUiState("live");
  }, [voice.status]);

  // ── Send a message ─────────────────────────────────────────────────────────
  async function submit(raw, meta) {
    const text = (raw ?? "").trim();
    if (!text || sendingRef.current || ending) return;

    sendingRef.current = true;
    setSending(true);
    setMessages((prev) => [
      ...prev,
      { id: `c${Date.now()}`, role: "counsellor", text },
    ]);

    let deliveryMetrics;
    if (meta?.analyzePromise) {
      deliveryMetrics = await Promise.race([
        meta.analyzePromise,
        new Promise((r) => setTimeout(() => r(null), 2500)),
      ]);
    }
    // Capture delivery metrics for the Coach panel (only when voice was used).
    if (deliveryMetrics) setLastDeliveryMetrics(deliveryMetrics);

    const sid = activeSessionId || sessionId;
    // S1: thread the thinking flag into BOTH paths. The server reads body.thinking
    // ('on'|'off') and persists session.thinkingMode before generating the reply.
    const thinkingFlag = thinkingOnRef.current ? "on" : "off";
    const body = deliveryMetrics
      ? { message: text, deliveryMetrics, thinking: thinkingFlag }
      : { message: text, thinking: thinkingFlag };

    // Stable id for the progressively-rendered student bubble. While streaming we
    // mutate this single message in place; on `done` we overwrite its text/emotion
    // with the CANONICAL reply (the coherence gate may have substituted it).
    const streamId = `s${Date.now()}`;
    let streamBuf = ""; // full raw streamed text so far (emotion tag still embedded)

    // Apply the canonical done payload: reconcile bubble text + drive phase/score/
    // milestones/emotion/TTS from the payload ONLY (never from streamed tokens).
    //
    // `streamCtx` (SSE path only) carries the sentence-streamed audio state:
    //   { spoke: bool, streamedText: string, chunker }
    // When the student already started speaking sentence-by-sentence, we reconcile
    // the live audio against the canonical reply instead of re-speaking from scratch.
    const applyDone = (res, streamCtx = null) => {
      const reply = res?.reply ?? "";
      const newEmotion = res?.emotion ?? "neutral";
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === streamId);
        const entry = { id: streamId, role: "student", text: reply, emotion: newEmotion };
        if (idx === -1) return [...prev, entry];
        const next = [...prev];
        next[idx] = entry;
        return next;
      });
      if (res?.currentPhase) setPhase(res.currentPhase);
      if (typeof res?.satisfactionScore === "number") {
        setScore(res.satisfactionScore);
        setScoreHistory((prev) => [...prev, { turn: prev.length, score: res.satisfactionScore }]);
      }
      if (res?.milestones) setMilestones(res.milestones);
      setEmotion(newEmotion);

      // ── TTS reconciliation ───────────────────────────────────────────────────
      // SSE + sentence-streamed audio already in progress: compare the canonical
      // reply against what we actually streamed (whitespace-normalized). If the
      // coherence gate substituted a different reply, stop and re-speak fresh;
      // otherwise flush the tail sentence and let the in-flight read finish.
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      if (streamCtx?.spoke) {
        if (norm(streamCtx.streamedText) === norm(reply)) {
          // Same reply: flush any trailing remainder, then finalize the utterance.
          // #25: flush the CANONICAL reply (not the streamed text) so the tail
          // sentence matches exactly what's displayed/persisted.
          if (voice.enabled && reply) {
            for (const sentence of streamCtx.chunker.flush(reply)) {
              voice.speakChunk(sentence, newEmotion);
            }
          }
          voice.endUtterance();
        } else if (voice.enabled && reply) {
          // Substituted reply: discard the partial read and speak the canonical one.
          voice.stopSpeaking();
          voice.speak(reply, newEmotion);
        } else {
          voice.endUtterance();
        }
      } else if (voice.enabled && reply) {
        // Non-streamed path (non-SSE fallback, or voice toggled mid-turn): TTS
        // always consumes the FINAL canonical reply — never partial tokens.
        voice.speak(reply, newEmotion);
      }

      // ── Live coaching cue ──────────────────────────────────────────────────
      // Bump the turn counter; capture it so a stale LLM-cue response can't
      // clobber a fresher instant cue. Old sessions / missing cue → leave the
      // last cue untouched (the payload simply omits it).
      const turn = ++turnCounterRef.current;
      if (res?.cue && typeof res.cue === "object") {
        setCue(res.cue);
        // Fire-and-forget the richer LLM cue; swap in only if still the latest turn.
        setCueRefining(true);
        api
          .getSessionCue(sid)
          .then((out) => {
            if (turnCounterRef.current !== turn) return; // a newer turn arrived
            if (out?.cue && typeof out.cue === "object") setCue(out.cue);
          })
          .catch(() => {
            /* keep the instant cue on any failure */
          })
          .finally(() => {
            if (turnCounterRef.current === turn) setCueRefining(false);
          });
      }
    };

    const applyError = (e) => {
      setMessages((prev) => prev.filter((m) => m.id !== streamId).concat({
        id: `e${Date.now()}`,
        role: "system",
        text: e?.message || "Something went wrong sending that message.",
      }));
    };

    // ── Sentence-streamed speech state ─────────────────────────────────────────
    // When voice is on, the student starts SPEAKING on their first complete
    // sentence instead of after the whole reply. We feed the emotion-suppressed
    // display text through a sentence chunker and speakChunk() each sentence into
    // the gapless player; on `done` we reconcile against the canonical reply.
    const streamCtx = {
      spoke: false,
      streamedText: "", // concatenated text actually handed to the chunker (= display)
      chunker: createSentenceChunker(),
    };
    // lastKnownEmotion: the live tag arrives trailing, so during streaming we use
    // the current student emotion (defaulting to neutral) per the spec.
    const lastKnownEmotion = emotion || "neutral";

    try {
      await postMessageStream(sid, body, {
        onToken: (chunk) => {
          streamBuf += chunk;
          // Re-derive display text from the full buffer each token so a tag split
          // across chunks is always suppressed (see stripStreamingEmotionTag).
          const { display } = stripStreamingEmotionTag(streamBuf);
          // Updater stays pure (keyed by streamId), so a double-invoke can't dup.
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === streamId);
            if (idx === -1) {
              return [...prev, { id: streamId, role: "student", text: display, emotion: "neutral", streaming: true }];
            }
            const next = [...prev];
            next[idx] = { ...next[idx], text: display };
            return next;
          });

          // Feed complete sentences to TTS as they arrive (voice only).
          if (voice.enabled) {
            streamCtx.streamedText = display;
            const sentences = streamCtx.chunker.push(display);
            if (sentences.length) {
              if (!streamCtx.spoke) {
                voice.beginUtterance(); // bumps epoch once; chunks append after this
                streamCtx.spoke = true;
              }
              for (const sentence of sentences) {
                voice.speakChunk(sentence, lastKnownEmotion);
              }
            }
          }
        },
        onDone: (res) => applyDone(res, streamCtx),
      });
    } catch (streamErr) {
      // SSE failed. If the server emitted a structured `error` event (e.g.
      // LLM_TIMEOUT), surface a toast and DON'T blindly re-fire the LLM — but to
      // guarantee a turn is never lost on a transport-level failure, retry once
      // via the plain JSON endpoint.
      if (streamErr?.sseError) {
        pushToast(
          /timeout|timed out|LLM_TIMEOUT/i.test(streamErr.message || "")
            ? "Student reply timed out — try again."
            : (streamErr.message || "Student reply failed — try again."),
          { tone: "danger" },
        );
        applyError(streamErr);
      } else {
        // Transport/fetch-level failure: retry once via the non-streaming path.
        try {
          const res = await api.sendMessage(sid, text, deliveryMetrics || undefined, thinkingFlag);
          applyDone({
            reply: res?.reply,
            emotion: res?.emotion,
            currentPhase: res?.currentPhase,
            satisfactionScore: res?.satisfactionScore,
            milestones: res?.milestones,
            cue: res?.cue,
          });
        } catch (jsonErr) {
          pushToast("Couldn't reach the student — connection issue.", { tone: "danger" });
          applyError(jsonErr);
        }
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  useEffect(() => {
    submitRef.current = submit;
  });

  // ══ Realtime (S2S) coaching loop ═══════════════════════════════════════════
  // In the openai/elevenlabs engines the provider owns the spoken conversation.
  // Each final transcript (counsellor or student) is shown as a bubble and posted
  // to /observe so MiniMax keeps the live score/cue/phase/milestones updating. The
  // posts run through observeChainRef so they hit the server in transcript order.
  function applyObserve(res) {
    if (!res) return;
    if (res.currentPhase) setPhase(res.currentPhase);
    if (typeof res.satisfactionScore === "number") {
      setScore(res.satisfactionScore);
      // Only add a history point when a counsellor turn was actually scored
      // (student-only observes carry the unchanged score for meter sync).
      if (res.turnType) setScoreHistory((prev) => [...prev, { turn: prev.length, score: res.satisfactionScore }]);
    }
    if (res.milestones) setMilestones(res.milestones);

    const turn = ++turnCounterRef.current;
    if (res.cue && typeof res.cue === "object") {
      setCue(res.cue);
      setCueRefining(true);
      api.getSessionCue(activeSessionId || sessionId)
        .then((out) => { if (turnCounterRef.current === turn && out?.cue) setCue(out.cue); })
        .catch(() => { /* keep instant cue */ })
        .finally(() => { if (turnCounterRef.current === turn) setCueRefining(false); });
    }
  }

  function handleRealtimeTranscript({ role, text }) {
    // Defensively strip any leaked [emotion:X] tag so it never reaches the bubble,
    // /observe, or the report (the realtime prompt already forbids it).
    const clean = (text || "").replace(/\[emotion:[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
    if (!clean || (role !== "counsellor" && role !== "student")) return;
    setMessages((prev) => [
      ...prev,
      { id: `${role[0]}${Date.now()}-${prev.length}`, role, text: clean, emotion: "neutral" },
    ]);
    if (role === "student") setEmotion("neutral");
    const sid = activeSessionId || sessionId;
    const body = role === "counsellor" ? { counsellorText: clean } : { studentText: clean };
    observeChainRef.current = observeChainRef.current
      .catch(() => {})
      .then(() => api.observeTurn(sid, body))
      .then((res) => applyObserve(res))
      .catch((e) => { console.warn("[observe] failed:", e?.message); });
  }
  useEffect(() => {
    realtimeTranscriptRef.current = handleRealtimeTranscript;
  });

  // ── Voice mode toggle ──────────────────────────────────────────────────────
  function toggleVoice() {
    if (voice.enabled) {
      voice.disable();
      setMicLatched(false);
    } else {
      voice.enable().then(() => {
        const lastStudent = [...messages].reverse().find((m) => m.role === "student");
        if (lastStudent?.text) voice.speak(lastStudent.text, lastStudent.emotion ?? "neutral");
      });
    }
  }

  // Mic button handler. Classic: latch voice enable/disable (PTT is held-Space).
  // S2S: the realtime connection is the call itself, so the button mutes/unmutes.
  function handleToggleMic() {
    if (s2s) {
      if (!voice.enabled) {
        voice.enable(engineVoiceFor(voiceEngine)).then(() => voice.setMuted?.(true)).catch(() => {});
      } else {
        // Toggle mute (hands-free open mic ↔ muted/push-to-talk).
        voice.setMuted?.(!voice.muted);
      }
      return;
    }
    if (!voice.enabled) {
      // Enable voice first.
      toggleVoice();
      setMicLatched(true);
    } else {
      voice.disable();
      setMicLatched(false);
    }
  }

  // ── Hold SPACE to talk (push-to-talk) ─────────────────────────────────────
  // Classic engine only — the S2S engines keep the mic open with provider-side
  // turn detection, so there is no push-to-talk.
  useEffect(() => {
    if (!voice.enabled || s2s) return;

    const isTyping = (el) => {
      const tag = el?.tagName;
      return tag === "TEXTAREA" || tag === "INPUT" || el?.isContentEditable;
    };

    const onKeyDown = (e) => {
      if (e.code !== "Space" || e.repeat) return;
      if (isTyping(document.activeElement)) return;
      e.preventDefault();
      if (spaceDownRef.current) return;
      spaceDownRef.current = true;
      setPttHeld(true);
      voice.startListening();
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space") return;
      if (!spaceDownRef.current) return;
      e.preventDefault();
      spaceDownRef.current = false;
      setPttHeld(false);
      voice.stopListening();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      spaceDownRef.current = false;
      setPttHeld(false);
    };
  }, [voice.enabled, voice.startListening, voice.stopListening, s2s]);

  // ── S2S push-to-talk: mic starts muted; hold SPACE to unmute (talk), release to
  // re-mute. Restores the prior mute state on release so "hands-free" (mic button
  // unmuted) stays open. ───────────────────────────────────────────────────────
  const mutedRef = useRef(false);
  const pttPrevMuteRef = useRef(true);
  useEffect(() => { mutedRef.current = voice.muted; }, [voice.muted]);
  useEffect(() => {
    if (!voice.enabled || !s2s) return;

    const isTyping = (el) => {
      const tag = el?.tagName;
      return tag === "TEXTAREA" || tag === "INPUT" || el?.isContentEditable;
    };
    const onKeyDown = (e) => {
      if (e.code !== "Space" || e.repeat) return;
      if (isTyping(document.activeElement)) return;
      e.preventDefault();
      if (spaceDownRef.current) return;
      spaceDownRef.current = true;
      setPttHeld(true);
      pttPrevMuteRef.current = mutedRef.current; // remember (keep hands-free open mic)
      voice.setMuted?.(false);
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space" || !spaceDownRef.current) return;
      e.preventDefault();
      spaceDownRef.current = false;
      setPttHeld(false);
      voice.setMuted?.(pttPrevMuteRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      spaceDownRef.current = false;
      setPttHeld(false);
    };
  }, [voice.enabled, s2s, voice.setMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── End session ───────────────────────────────────────────────────────────
  function confirmEnd() {
    setShowEndConfirm(true);
  }

  function doEndSession() {
    if (ending) return;
    setShowEndConfirm(false);
    setEnding(true);
    setWrappingError(null);
    // Disable voice before entering the wrapping screen.
    if (voice.enabled) voice.disable();
    setUiState("wrapping");
    const sid = activeSessionId || sessionId;
    api
      .endSession(sid)
      .then(async (res) => {
        // Probe the freshly-generated report for a degraded (fallback) state so we
        // can warn the counsellor. A failed probe must not block navigation.
        let degraded = false;
        try {
          const report = await api.getReport(res.reportId);
          degraded = report?.fallback === true;
        } catch {
          /* non-fatal — navigate anyway */
        }
        navigate("/app/reports/" + res.reportId, {
          state: degraded
            ? {
                degradedNotice:
                  "Coaching report degraded — LLM was unreachable; it can be regenerated.",
              }
            : undefined,
        });
      })
      .catch((e) => {
        setWrappingError(e?.message || "Could not generate the report.");
        setEnding(false);
      });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Render: Green room ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (uiState === "greenroom") {
    if (grLoading) {
      return (
        <div className="flex h-screen items-center justify-center bg-stage">
          <Spinner size={28} />
        </div>
      );
    }
    if (grError && !grPayload) {
      return (
        <div className="flex h-screen items-center justify-center bg-stage px-6">
          <div className="text-center">
            <p className="text-lg font-semibold text-stage-text">Could not load session brief</p>
            <p className="mt-2 text-sm text-stage-muted">{grError}</p>
            <button
              className="mt-6 rounded-xl border border-stage-line bg-stage-raised px-4 py-2 text-sm font-medium text-stage-text"
              onClick={() => navigate("/app/mocks")}
            >
              Back to my mocks
            </button>
          </div>
        </div>
      );
    }
    return (
      <GreenRoom
        mode={grMode}
        assignment={grAssignment}
        persona={grPersona}
        course={grCourse}
        scenario={grScenario}
        onJoin={handleJoin}
        joining={joining}
        error={joinError || grError}
      />
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Render: Connecting screen ─────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (uiState === "connecting") {
    return <ConnectingScreen />;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Render: Voice load gate (S7) ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (uiState === "voice-loading") {
    return <VoiceLoadingScreen pct={voice.loadPct} />;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Render: Ended session ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (uiState === "ended") {
    return (
      <EndedScreen
        onViewReports={() => navigate("/app/reports")}
        onBack={() => navigate("/app/mocks")}
      />
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Render: Wrapping screen ───────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (uiState === "wrapping") {
    return (
      <WrappingScreen
        error={wrappingError}
        onRetry={() => {
          setEnding(false);
          doEndSession();
        }}
        onBackToCall={() => {
          setWrappingError(null);
          setEnding(false);
          setUiState("live");
        }}
      />
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Render: Live session ──────────────────────────────────════════════════
  // ══════════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-stage">
        <Spinner size={28} />
      </div>
    );
  }

  if (error && !ending) {
    return (
      <div className="flex h-screen items-center justify-center bg-stage px-6">
        <EmptyState
          title="Session unavailable"
          hint={error}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          }
          action={
            <Button as={Link} to="/app/mocks" variant="secondary" size="sm">
              Back to my mocks
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-stage">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {/* ── Call stage (takes remaining space) ── */}
      <CallStage
        personaName={leadCard?.name || persona?.voiceName || persona?.name}
        phase={phase}
        emotion={emotion}
        satisfaction={score}
        // ── Info panel (S8) ──
        course={course}
        scenario={scenario}
        persona={persona}
        leadCard={leadCard}
        revealPersona={revealPersona}
        // ── Thinking toggle (S1) ──
        thinkingOn={thinkingOn}
        onToggleThinking={() => setThinkingOn((t) => !t)}
        getAnalyser={voice.getAnalyser}
        orbState={orbState}
        subtitle={subtitle}
        awaitingReply={awaitingReply}
        hasMessages={messages.length > 0}
        voice={voice}
        // ── Voice engine (S2S) ──
        voiceEngine={voiceEngine}
        openaiVoice={openaiVoice}
        onChangeOpenaiVoice={(v) => {
          setOpenaiVoice(v);
          try { localStorage.setItem(OPENAI_VOICE_STORAGE_KEY, v); } catch { /* noop */ }
          voice.changeVoice?.(v);
        }}
        elevenVoice={elevenVoice}
        onChangeElevenVoice={(v) => {
          setElevenVoice(v);
          try { localStorage.setItem(ELEVEN_VOICE_STORAGE_KEY, v); } catch { /* noop */ }
          voice.changeVoice?.(v);
        }}
        onToggleMic={handleToggleMic}
        micLatched={micLatched}
        onToggleKeyboard={() => {
          if (!sidebarOpen) {
            setSidebarOpen(true);
            setSidebarTab("transcript");
            setTimeout(() => sidebarInputRef.current?.focus(), 80);
          } else {
            setSidebarOpen(false);
          }
        }}
        sidebarOpen={sidebarOpen}
        onEndCall={confirmEnd}
        showSat={showSat}
        onToggleSat={() => setShowSat((s) => !s)}
        timerStart={timerStart}
        cue={cue}
        onOpenCoach={() => {
          setSidebarOpen(true);
          setSidebarTab("coach");
        }}
      />

      {/* ── Glass sidebar: Transcript + Coach tabs ── */}
      <CallSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        tab={sidebarTab}
        onTab={setSidebarTab}
        messages={messages}
        awaitingReply={sending}
        onSend={(text) => (s2s ? voice.sendText?.(text) : submit(text))}
        satisfaction={score}
        scoreHistory={scoreHistory}
        deliveryMetrics={lastDeliveryMetrics}
        milestones={milestones}
        emotion={emotion}
        cue={cue}
        cueRefining={cueRefining}
        inputRef={sidebarInputRef}
      />

      {/* ── End call confirm modal ── */}
      <Modal
        open={showEndConfirm}
        onClose={() => setShowEndConfirm(false)}
        title="End this call?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowEndConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={doEndSession} disabled={ending}>
              {ending ? "Ending…" : "End call & generate report"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Ending the call will stop the session and generate your coaching report. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
