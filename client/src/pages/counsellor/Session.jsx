import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { postMessageStream, stripStreamingEmotionTag } from "../../lib/stream";
import { useAuth } from "../../lib/auth.jsx";
import { useOpenAIRealtime } from "../../voice/useOpenAIRealtime";
import { DEFAULT_OPENAI_VOICE } from "../../voice/engines";
import { useToast } from "../../ui/Toast";
import { toUserMessage } from "../../lib/asyncError";
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

// ── Ended session screen ──────────────────────────────────────────────────────
function EndedScreen({ onViewReports, onBack, reportId, reportPath }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-stage px-6">
      <div className="w-full max-w-sm rounded-2xl border border-stage-line bg-stage-raised p-8 text-center shadow-xl">
        <p className="text-base font-semibold text-stage-text">This call has ended.</p>
        <p className="mt-2 text-sm text-stage-muted">
          The session is complete. You can view your coaching report or return to your mocks.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          {reportId && reportPath ? (
            <Link
              to={reportPath}
              className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity inline-block"
            >
              View report
            </Link>
          ) : (
            <button
              onClick={onViewReports}
              className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              View reports
            </button>
          )}
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

// ── Wrapping transition (C4) ──────────────────────────────────────────────────
// End-call now navigates to the report PAGE immediately (the report fills live
// there). This is only a brief, elapsed-time-aware transition shown for up to
// ~1.5s while /end returns the report id — never a 20s wait. On error, it offers
// a retry / back-to-call escape hatch.
function WrappingScreen({ error, elapsedLabel, onRetry, onBackToCall }) {
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
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "radial-gradient(circle, #6366f1 0%, #4338ca 60%, transparent 100%)",
          opacity: 0.55,
          animation: "orb-pulse 1.6s ease-in-out infinite",
        }}
      />
      <div className="text-center">
        <p className="text-base font-semibold text-stage-text">Wrapping up your call…</p>
        <p className="mt-1 text-sm text-stage-muted">
          {elapsedLabel
            ? `Great work over ${elapsedLabel} — taking you to your report.`
            : "Taking you to your coaching report."}
        </p>
      </div>
    </div>
  );
}

// (Local ToastStack removed — replaced by shared useToast / ToastProvider)

// ══════════════════════════════════════════════════════════════════════════════
// ── Main Session component ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { pushToast } = useToast();

  // Role-aware navigation helpers.
  const isAdminUser = user?.role === "admin";
  // Admin post-end lands on admin reports; counsellor on app reports.
  const reportPathFor = (id) => isAdminUser ? `/admin/reports/${id}` : `/app/reports/${id}`;
  // "Back to mocks" equivalent: admin goes to admin home; counsellor goes to mocks.
  const homePath = isAdminUser ? "/admin" : "/app/mocks";

  // ── State machine ──────────────────────────────────────────────────────────
  // "greenroom" → "connecting" → "live"   (voice and text both land in "live")
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
  // phase is tracked server-side (drives report logic) but not displayed on screen (pill removed).
  // eslint-disable-next-line no-unused-vars
  const [phase, setPhase] = useState(1);
  const [score, setScore] = useState(0);
  const [emotion, setEmotion] = useState("neutral");
  const [activeSessionId, setActiveSessionId] = useState(sessionId || null);
  const [timerStart, setTimerStart] = useState(null);

  // ── Session mode: "voice" (OpenAI Realtime) | "text" (MiniMax /message chat) ──
  // Resolved from the green-room choice (router state) on join, then authoritative
  // from the session record on the live route.
  const [sessionMode, setSessionMode] = useState(location.state?.sessionMode || "voice");
  const isVoice = sessionMode === "voice";

  // ── OpenAI realtime voice (voice mode only) ─────────────────────────────────
  const [openaiVoice, setOpenaiVoice] = useState(location.state?.openaiVoice || DEFAULT_OPENAI_VOICE);
  const openaiVoiceRef = useRef(openaiVoice);
  useEffect(() => { openaiVoiceRef.current = openaiVoice; }, [openaiVoice]);

  // ── Info panel data (course facts / scenario / blind-mode flag) ─────────────
  const [course, setCourse] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [leadCard, setLeadCard] = useState(null);
  const [revealPersona, setRevealPersona] = useState(true);

  // ── Thinking mode (text mode): default OFF; an in-call toggle flips it. ──────
  const [thinkingOn, setThinkingOn] = useState(false);
  const thinkingOnRef = useRef(false);
  useEffect(() => { thinkingOnRef.current = thinkingOn; }, [thinkingOn]);

  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [wrappingError, setWrappingError] = useState(null);
  const [wrappingElapsed, setWrappingElapsed] = useState("");

  // ── Ended-screen: report id for the deep-link button ─────────────────────
  const [endedReportId, setEndedReportId] = useState(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  // Voice sessions start with sidebar CLOSED (call stage is the focus);
  // text sessions start with it OPEN (the typed input is the primary interface).
  // sessionMode may resolve after the live-load effect, so we also apply this
  // in the live-load effect after resolvedMode is known (see sidebarInitialized).
  const [sidebarOpen, setSidebarOpen] = useState(!isVoice);
  const sidebarInitializedRef = useRef(false);
  const [showSat, setShowSat] = useState(true);
  const [pttHeld, setPttHeld] = useState(false);


  // In-flight text-reply stream; aborted on end-call/unmount so a late reply
  // can't mutate wrapping-screen state or fire a stale cue fetch.
  const streamAbortRef = useRef(null);
  useEffect(() => () => { try { streamAbortRef.current?.abort(); } catch { /* settled */ } }, []);

  // ── Observe failure counter (voice mode) ───────────────────────────────────
  const observeFailCountRef = useRef(0);
  const observeFailToastShownRef = useRef(false);

  const sendingRef = useRef(false);
  const spaceDownRef = useRef(false);
  const sidebarInputRef = useRef(null);
  // Streaming-text sink: the in-flight student reply is rendered by a dedicated,
  // isolated child (StreamingBubble) that registers its setter here. Per-token
  // updates go through this ref — NOT through `messages` — so token churn never
  // re-renders the transcript list, CallStage, or the orb. The canonical reply is
  // committed to `messages` only on `done`.
  const streamSinkRef = useRef(null);
  // Realtime transcript handler + a sequential queue so /observe calls land in
  // transcript order. Assigned after the handler is defined (like submitRef).
  const realtimeTranscriptRef = useRef(null);
  const observeChainRef = useRef(Promise.resolve());

  // ── Steering (C3): debounce to the latest steering string and inject it over
  // the data channel once per student turn. We keep only the newest pending value
  // so a fresh observe before send supersedes the old one. ──────────────────────
  const pendingSteeringRef = useRef(null);

  // ── Voice pipeline (OpenAI realtime; voice mode only) ───────────────────────
  // The hook is always created (hook rules), but in text mode it is never enabled.
  const voice = useOpenAIRealtime({
    sessionId: activeSessionId,
    defaultVoice: openaiVoice,
    onTranscript: (e) => realtimeTranscriptRef.current?.(e),
    onError: (msg) =>
      pushToast(typeof msg === "string" ? msg : toUserMessage(msg), { tone: "danger" }),
  });

  // ── Derived orbState ───────────────────────────────────────────────────────
  const awaitingReply = sending;
  let orbState = "idle";
  if (awaitingReply) {
    orbState = "thinking";
  } else if (isVoice && voice.status === "speaking") {
    orbState = "speaking";
  } else if (isVoice && (voice.status === "listening" || pttHeld)) {
    orbState = "listening";
  }

  // Subtitle (voice mode only): last student message text. In text mode the
  // streamed reply lives in the sidebar, so the stage subtitle stays empty to keep
  // CallStage out of the per-token render path.
  const lastStudentMsg = [...messages].reverse().find((m) => m.role === "student");
  const subtitle = isVoice ? (lastStudentMsg?.text || "") : "";

  // ── Green room: resolve data from router state ─────────────────────────────
  useEffect(() => {
    if (!isNewRoute) return;

    const state = location.state;
    if (!state) {
      navigate(homePath, { replace: true });
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
  // `mode` is "voice" | "text" (C5). Voice → OpenAI Realtime + /observe; text →
  // MiniMax /message chat. The chosen OpenAI voice rides along for voice joins.
  async function handleJoin(mode, opts = {}) {
    if (!grPayload) return;
    const chosenMode = mode === "text" ? "text" : "voice";
    const oaVoice = opts.openaiVoice || openaiVoice;
    setSessionMode(chosenMode);
    setOpenaiVoice(oaVoice);
    setJoinError(null);
    setJoining(true);
    setUiState("connecting");

    try {
      // counsellor-first: the counsellor opens the call (no student-first opener).
      // thinking defaults OFF for the live conversation.
      const res = await api.startSession({
        ...grPayload,
        mode: chosenMode,
        counsellorFirst: true,
        thinkingMode: "off",
        openaiVoice: oaVoice,
      });
      const newId = res.sessionId;
      setActiveSessionId(newId);
      navigate(`/app/session/${newId}`, {
        replace: true,
        state: { autoVoice: chosenMode === "voice", sessionMode: chosenMode, openaiVoice: oaVoice },
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
        if (s.status === "ended") {
          setUiState("ended");
          // Fetch the report for this session so the ended screen can deep-link to it.
          api.getReports(null, sessionId)
            .then((reports) => {
              if (!alive) return;
              const found = Array.isArray(reports) && reports.length > 0 ? reports[0] : null;
              if (found?.id) setEndedReportId(found.id);
            })
            .catch(() => { /* fall back to reports-list link */ });
          setLoading(false);
          return;
        }
        let resolvedPersona = s.personaSnapshot || null;
        setCourse(s.courseSnapshot || null);
        setScenario(s.scenarioSnapshot || null);
        setLeadCard(s.leadCard || null);
        const sessionReveal =
          typeof s.revealPersona === "boolean" ? s.revealPersona : null;
        if (sessionReveal !== null) setRevealPersona(sessionReveal);

        const assignmentFetch = s.assignmentId
          ? api.getAssignment(s.assignmentId).catch(() => null)
          : Promise.resolve(null);

        assignmentFetch.then((asn) => {
          if (!alive) return;
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
        // Session mode is authoritative from the record on the live route.
        // Only OpenAI Realtime sessions resume as voice; every other engine
        // (text / legacy classic|elevenlabs / missing) resumes as text so typed
        // turns go through submit()→/message and actually produce a student reply.
        const resolvedMode = s.voiceEngine === "openai" ? "voice" : "text";
        setSessionMode(resolvedMode);
        // Sidebar default: CLOSED for voice (call stage focus), OPEN for text.
        // Apply once after mode is resolved; the initial useState used the pre-load
        // mode guess which may have been wrong on a resume/refresh.
        if (!sidebarInitializedRef.current) {
          sidebarInitializedRef.current = true;
          setSidebarOpen(resolvedMode === "text");
        }
        if (s.openaiVoice) setOpenaiVoice(s.openaiVoice);
        setTimerStart(s.startedAt ? new Date(s.startedAt).getTime() : Date.now());
        const transcript = Array.isArray(s.transcript) ? s.transcript : [];
        const msgs = transcript.map((m, i) => ({
          id: `t${i}`,
          role: m.role,
          text: m.text,
          emotion: m.emotion ?? "neutral",
        }));
        setMessages(msgs);
        const lastStudent = [...msgs].reverse().find((m) => m.role === "student");
        if (lastStudent?.emotion) setEmotion(lastStudent.emotion);
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

  // ── Auto-enable voice after join ───────────────────────────────────────────
  // Voice mode connects the OpenAI realtime session as soon as the live record is
  // loaded. Unlike the old browser pipeline there is no model download, so there
  // is no loading-percentage gate — connect runs in the background and the call UI
  // is usable immediately (mic starts muted → hold Space to talk). Text joins skip
  // this entirely (no voice hook is enabled).
  const autoVoiceHandled = useRef(false);
  useEffect(() => {
    if (isNewRoute) return;
    if (autoVoiceHandled.current) return;
    if (loading) return;
    autoVoiceHandled.current = true;
    setTimerStart((t) => t || Date.now());
    // Voice sessions always (re)connect — router state survives only the initial
    // join navigation, so gating on autoVoice left refresh/resume/bookmark loads
    // with the live call UI mounted but a dead connection. isVoice alone decides.
    if (isVoice) {
      voice.enable(openaiVoiceRef.current)
        .then(() => voice.setMuted?.(true))
        .catch(() => {
          // Mic denied / connection failed: don't leave a dead voice UI — degrade
          // to text chat (same coaching engine) and say so. The mic button still
          // lets them retry voice once they fix permissions.
          setSessionMode("text");
          pushToast(
            "Couldn't start voice (mic blocked or connection failed) — switched to text chat. Allow mic access and refresh the page to retry voice.",
            { tone: "warn", ttl: 10000 },
          );
        });
    }
    // Clear the autoVoice flag so back-navigation doesn't re-trigger it.
    navigate(location.pathname, { replace: true, state: {} });
    // Stable primitive dep: depending on the location.state OBJECT re-ran this
    // effect when the state-clearing navigate below swapped the reference (the
    // ref guard held, but only by luck of never being reset).
  }, [isNewRoute, loading, sessionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Send a message (TEXT mode: MiniMax /message SSE) ───────────────────────
  async function submit(raw) {
    const text = (raw ?? "").trim();
    if (!text || sendingRef.current || ending) return;

    sendingRef.current = true;
    setSending(true);
    setMessages((prev) => [
      ...prev,
      { id: `c${Date.now()}`, role: "counsellor", text },
    ]);

    const sid = activeSessionId || sessionId;
    const thinkingFlag = thinkingOnRef.current ? "on" : "off";
    const body = { message: text, thinking: thinkingFlag };

    const streamId = `s${Date.now()}`;
    let streamBuf = "";

    const applyDone = (res) => {
      const reply = res?.reply ?? "";
      const newEmotion = res?.emotion ?? "neutral";
      // Clear the isolated streaming bubble and commit the canonical reply to the
      // transcript list in a single update.
      streamSinkRef.current?.("");
      setMessages((prev) => [...prev, { id: streamId, role: "student", text: reply, emotion: newEmotion }]);
      if (res?.currentPhase) setPhase(res.currentPhase);
      if (typeof res?.satisfactionScore === "number") {
        setScore(res.satisfactionScore);
      }
      setEmotion(newEmotion);

      // ── Student hung up — auto-navigate to ended screen ───────────────────
      if (res?.studentHungUp) {
        setTimeout(() => setUiState("ended"), 1800);
        return;
      }
      // Server still returns `cue` fields — we ignore them (cue feature removed).
    };

    const applyError = (e) => {
      streamSinkRef.current?.("");
      setMessages((prev) => prev.concat({
        id: `e${Date.now()}`,
        role: "system",
        text: e?.message || "Something went wrong sending that message.",
      }));
    };

    try {
      const ac = new AbortController();
      streamAbortRef.current = ac;
      await postMessageStream(sid, body, {
        signal: ac.signal,
        onToken: (chunk) => {
          streamBuf += chunk;
          const { display } = stripStreamingEmotionTag(streamBuf);
          // Drive the isolated streaming bubble only — no `messages` churn.
          streamSinkRef.current?.(display);
        },
        onDone: (res) => applyDone(res),
      });
    } catch (streamErr) {
      if (streamErr?.name === "AbortError") {
        // Deliberate cancel (end-call or unmount): clear the streaming bubble and
        // stop — no error toast, no JSON retry against an ended session.
        streamSinkRef.current?.("");
      } else if (streamErr?.sseError) {
        pushToast(
          /timeout|timed out|LLM_TIMEOUT/i.test(streamErr.message || "")
            ? "Student reply timed out — try again."
            : (streamErr.message || "Student reply failed — try again."),
          { tone: "danger" },
        );
        applyError(streamErr);
      } else {
        try {
          const res = await api.sendMessage(sid, text, undefined, thinkingFlag);
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

  // ══ Realtime (voice) coaching loop ═════════════════════════════════════════
  // In voice mode OpenAI owns the spoken conversation. Each final transcript
  // (counsellor or student) is shown as a bubble and posted to /observe so MiniMax
  // keeps the live score/phase/milestones updating. Counsellor turns carry delivery
  // metrics; student-turn responses carry the steering string we inject back into
  // the realtime model. Posts run through observeChainRef → transcript order.
  function applyObserve(res, role) {
    if (!res) return;
    if (res.currentPhase) setPhase(res.currentPhase);
    if (typeof res.satisfactionScore === "number") {
      setScore(res.satisfactionScore);
    }

    // Steering (C3, resolution (b)): after a STUDENT turn observe, inject the
    // newest steering over the data channel as a non-destructive system item.
    // Debounce to the latest value — overwrite any still-pending steering with the
    // freshest one, then attempt to send. If the dc isn't open yet, keep it pending
    // so the next turn (or a later send) carries the newest state. Never throws.
    if (role === "student" && typeof res.steering === "string" && res.steering.trim()) {
      pendingSteeringRef.current = res.steering.trim();
    }
    if (pendingSteeringRef.current) {
      const sent = voice.sendSteering?.(pendingSteeringRef.current);
      if (sent) pendingSteeringRef.current = null;
    }
    // Server still returns `cue` fields — ignored (cue feature removed).
  }

  // Phrases that indicate the counsellor is requesting time to think — these
  // are genuine real-time reactions and should NOT be penalized for latency.
  const STALL_PHRASES = [
    "give me", "one second", "one moment", "just a second", "just a minute",
    "hold on", "let me think", "wait", "give me some time", "can i get",
    "need a moment", "thinking", "umm", "uh", "hmm",
  ];
  function isStallPhrase(text) {
    const t = text.toLowerCase();
    return STALL_PHRASES.some((p) => t.includes(p));
  }

  const RESPONSE_LATENCY_LIMIT_MS = 15_000;

  function handleRealtimeTranscript({ role, text, deliveryMetrics, realtimeUsage, transcriptionUsage }) {
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

    // Detect a suspiciously slow response: counsellor took >15s to start speaking
    // after the AI stopped. Exempt stall/filler phrases ("give me some time" etc.)
    // since those are genuine real-time reactions, not looked-up answers.
    const responseDelayed =
      role === "counsellor" &&
      typeof deliveryMetrics?.responseLatencyMs === "number" &&
      deliveryMetrics.responseLatencyMs > RESPONSE_LATENCY_LIMIT_MS &&
      !isStallPhrase(clean);

    const body = role === "counsellor"
      ? {
          counsellorText: clean,
          ...(deliveryMetrics ? { deliveryMetrics } : {}),
          ...(responseDelayed ? { responseDelayed: true } : {}),
          ...(transcriptionUsage ? { transcriptionUsage } : {}),
        }
      : {
          studentText: clean,
          ...(realtimeUsage ? { realtimeUsage } : {}),
        };
    observeChainRef.current = observeChainRef.current
      .catch(() => {})
      .then(() => api.observeTurn(sid, body))
      .then((res) => {
        // Reset consecutive failure count on success.
        observeFailCountRef.current = 0;
        observeFailToastShownRef.current = false;
        applyObserve(res, role);
      })
      .catch((e) => {
        console.warn("[observe] failed:", e?.message);
        observeFailCountRef.current += 1;
        if (observeFailCountRef.current >= 3 && !observeFailToastShownRef.current) {
          observeFailToastShownRef.current = true;
          pushToast(
            "Live scoring paused — the call audio still works; scoring resumes automatically.",
            { tone: "warn", ttl: 10000 },
          );
        }
      });
  }
  useEffect(() => {
    realtimeTranscriptRef.current = handleRealtimeTranscript;
  });

  // Mic button (voice mode): the realtime connection IS the call, so the button
  // connects (if not yet enabled) or toggles mute (hands-free open mic ↔ muted/PTT).
  function handleToggleMic() {
    if (!isVoice) return;
    if (!voice.enabled) {
      voice.enable(openaiVoiceRef.current)
        .then(() => voice.setMuted?.(true))
        .catch((e) => {
          pushToast(
            typeof e?.message === "string" && e.message
              ? e.message
              : "Mic connection failed — check mic permissions and try again.",
            { tone: "warn" },
          );
        });
    } else {
      voice.setMuted?.(!voice.muted);
    }
  }

  // ── Space PTT (voice mode): mic starts muted; hold Space to unmute (talk),
  // release to re-mute. Restores the prior mute state so "hands-free" stays open. ──
  const mutedRef = useRef(false);
  const pttPrevMuteRef = useRef(true);
  useEffect(() => { mutedRef.current = voice.muted; }, [voice.muted]);
  useEffect(() => {
    if (!isVoice || !voice.enabled) return;

    const isTyping = (el) => {
      const tag = el?.tagName;
      // BUTTON/A/SELECT included: Space ACTIVATES a focused button — hijacking it
      // for push-to-talk made every control unreachable for keyboard users.
      return tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON" || tag === "A" || tag === "SELECT" || el?.isContentEditable;
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
  }, [isVoice, voice.enabled, voice.setMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── End session (C4: navigate to the report immediately) ───────────────────
  function confirmEnd() {
    setShowEndConfirm(true);
  }

  function doEndSession() {
    if (ending) return;
    setShowEndConfirm(false);
    setEnding(true);
    setWrappingError(null);
    // Cancel any in-flight student reply stream — its late events must not
    // mutate the wrapping screen or fetch a cue for an ended session.
    try { streamAbortRef.current?.abort(); } catch { /* already settled */ }
    // Compute an elapsed-time-aware label for the brief transition copy.
    if (timerStart) {
      const secs = Math.max(0, Math.floor((Date.now() - timerStart) / 1000));
      const mm = Math.floor(secs / 60);
      const ss = secs % 60;
      setWrappingElapsed(mm > 0 ? `${mm}m ${ss}s` : `${ss}s`);
    }
    // Disable voice before entering the wrapping transition.
    if (isVoice && voice.enabled) voice.disable();
    setUiState("wrapping");
    const sid = activeSessionId || sessionId;
    // C4: /end returns { reportId, status } immediately; navigate to the report
    // page right away (ReportDetail renders the live-fill skeletons + polls).
    // Drain the observe chain FIRST: a final spoken turn whose /observe was
    // queued before disable would otherwise race /end at the server lock and,
    // losing, be absent from the report transcript.
    observeChainRef.current
      .catch(() => {})
      .then(() => api.endSession(sid))
      .then((res) => {
        navigate(reportPathFor(res.reportId));
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
              onClick={() => navigate(homePath)}
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
  // ── Render: Ended session ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (uiState === "ended") {
    return (
      <EndedScreen
        onViewReports={() => navigate(isAdminUser ? "/admin/reports" : "/app/reports")}
        onBack={() => navigate(homePath)}
        reportId={endedReportId}
        reportPath={endedReportId ? reportPathFor(endedReportId) : null}
      />
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── Render: Wrapping transition ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  if (uiState === "wrapping") {
    return (
      <WrappingScreen
        error={wrappingError}
        elapsedLabel={wrappingElapsed}
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
            <Button as={Link} to={homePath} variant="secondary" size="sm">
              Back to my mocks
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-stage">
      {/* ── Call stage (takes remaining space) ── */}
      <CallStage
        personaName={leadCard?.name || persona?.voiceName || persona?.name}
        emotion={emotion}
        satisfaction={score}
        // ── Info panel ──
        course={course}
        scenario={scenario}
        persona={persona}
        leadCard={leadCard}
        revealPersona={revealPersona}
        // ── Thinking toggle (text mode) ──
        sessionMode={sessionMode}
        thinkingOn={thinkingOn}
        onToggleThinking={() => setThinkingOn((t) => !t)}
        getAnalyser={voice.getAnalyser}
        orbState={orbState}
        subtitle={subtitle}
        awaitingReply={awaitingReply}
        hasMessages={messages.length > 0}
        voice={voice}
        onChangeMic={(deviceId, label) => voice.changeMic?.(deviceId, label)}
        onToggleMic={handleToggleMic}
        onEndCall={confirmEnd}
        showSat={showSat}
        onToggleSat={() => setShowSat((s) => !s)}
        timerStart={timerStart}
      />

      {/* ── Glass sidebar: Transcript ── */}
      <CallSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        messages={messages}
        awaitingReply={sending}
        onSend={(text) => submit(text)}
        allowInput={!isVoice}
        registerStreamSink={streamSinkRef}
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
