import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth.jsx";
import { useVoiceConversation } from "../../voice/useVoiceConversation";
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

// ══════════════════════════════════════════════════════════════════════════════
// ── Main Session component ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // ── State machine ──────────────────────────────────────────────────────────
  // "greenroom" → "connecting" → "live"
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

  const sendingRef = useRef(false);
  const submitRef = useRef(null);
  const spaceDownRef = useRef(false);
  const sidebarInputRef = useRef(null);

  // ── Voice pipeline ─────────────────────────────────────────────────────────
  const voice = useVoiceConversation({
    onUserUtterance: (t, meta) => submitRef.current?.(t, meta),
  });

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
  } else if (pttHeld || (micLatched && voice.status === "recording")) {
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
        const { personaId, courseId, scenario: sc } = state;

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
  async function handleJoin(withVoice) {
    if (!grPayload) return;
    setJoinError(null);
    setJoining(true);
    setUiState("connecting");

    try {
      const res = await api.startSession(grPayload);
      const newId = res.sessionId;
      setActiveSessionId(newId);
      navigate(`/app/session/${newId}`, {
        replace: true,
        state: { autoVoice: withVoice },
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
        const assignmentFetch = s.assignmentId
          ? api.getAssignment(s.assignmentId).catch(() => null)
          : Promise.resolve(null);

        assignmentFetch.then((asn) => {
          if (!alive) return;
          if (asn && asn.revealPersona === false && resolvedPersona) {
            resolvedPersona = { ...resolvedPersona, name: "Prospective student" };
          }
          setPersona(resolvedPersona);
        });

        setPhase(s.currentPhase || 1);
        setScore(s.satisfactionScore ?? 0);
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

  // ── Auto-enable voice after join ───────────────────────────────────────────
  const autoVoiceHandled = useRef(false);
  useEffect(() => {
    if (isNewRoute) return;
    if (autoVoiceHandled.current) return;
    const autoVoice = location.state?.autoVoice;
    if (!autoVoice) return;
    if (loading) return;
    autoVoiceHandled.current = true;
    setTimerStart((t) => t || Date.now());
    voice.enable().catch(() => {});
    // Clear the autoVoice flag so back-navigation doesn't re-trigger it.
    navigate(location.pathname, { replace: true, state: {} });
  }, [isNewRoute, loading, location.state]); // eslint-disable-line react-hooks/exhaustive-deps

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
    api
      .sendMessage(sid, text, deliveryMetrics || undefined)
      .then((res) => {
        const reply = res?.reply ?? "";
        const newEmotion = res?.emotion ?? "neutral";
        setMessages((prev) => [
          ...prev,
          { id: `s${Date.now()}`, role: "student", text: reply, emotion: newEmotion },
        ]);
        if (res?.currentPhase) setPhase(res.currentPhase);
        if (typeof res?.satisfactionScore === "number") {
          setScore(res.satisfactionScore);
          setScoreHistory((prev) => [
            ...prev,
            { turn: prev.length, score: res.satisfactionScore },
          ]);
        }
        if (res?.milestones) setMilestones(res.milestones);
        setEmotion(newEmotion);
        if (voice.enabled && reply) voice.speak(reply, newEmotion);
      })
      .catch((e) => {
        setMessages((prev) => [
          ...prev,
          {
            id: `e${Date.now()}`,
            role: "system",
            text: e?.message || "Something went wrong sending that message.",
          },
        ]);
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  }
  useEffect(() => {
    submitRef.current = submit;
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

  // Mic button handler: toggle voice enable (latching); PTT is held-Space.
  function handleToggleMic() {
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
  useEffect(() => {
    if (!voice.enabled) return;

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
  }, [voice.enabled, voice.startListening, voice.stopListening]);

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
      .then((res) => navigate("/app/reports/" + res.reportId))
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
      {/* ── Call stage (takes remaining space) ── */}
      <CallStage
        personaName={persona?.name}
        phase={phase}
        emotion={emotion}
        satisfaction={score}
        getAnalyser={voice.getAnalyser}
        orbState={orbState}
        subtitle={subtitle}
        awaitingReply={awaitingReply}
        voice={voice}
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
      />

      {/* ── Glass sidebar: Transcript + Coach tabs ── */}
      <CallSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        tab={sidebarTab}
        onTab={setSidebarTab}
        messages={messages}
        awaitingReply={sending}
        onSend={(text) => submit(text)}
        satisfaction={score}
        scoreHistory={scoreHistory}
        deliveryMetrics={lastDeliveryMetrics}
        milestones={milestones}
        emotion={emotion}
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
