import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useVoiceConversation } from "../../voice/useVoiceConversation";
import Button from "../../ui/Button";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import Avatar from "../../ui/Avatar";
import ScoreMeter from "../../ui/ScoreMeter";
import PhaseStepper from "../shared/PhaseStepper";

// Human-readable labels + color tokens for the voice pipeline status.
const VOICE_STATUS = {
  loading: { label: "Loading model", tone: "warn" },
  idle: { label: "Listening ready", tone: "brand" },
  recording: { label: "Recording", tone: "danger" },
  transcribing: { label: "Transcribing", tone: "warn" },
  speaking: { label: "Speaking", tone: "success" },
};

// A small Monexa-style animated waveform. Bars animate when active.
function Waveform({ active }) {
  const bars = [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="flex h-5 items-center gap-[3px]" aria-hidden="true">
      {bars.map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current"
          style={{
            height: active ? undefined : "5px",
            animation: active
              ? `mct-wave 900ms ease-in-out ${i * 90}ms infinite`
              : "none",
          }}
        />
      ))}
    </div>
  );
}

export default function Session() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [persona, setPersona] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [messages, setMessages] = useState([]);
  const [phase, setPhase] = useState(1);
  const [score, setScore] = useState(0);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const sendingRef = useRef(false);
  const submitRef = useRef(null);
  const spaceDownRef = useRef(false);

  // Voice pipeline: utterances are routed straight into the latest submit fn.
  const voice = useVoiceConversation({
    onUserUtterance: (t) => submitRef.current?.(t),
  });

  // --- Load the session on mount -------------------------------------------
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getSession(sessionId)
      .then((s) => {
        if (!alive) return;
        setPersona(s.personaSnapshot || null);
        setScenario(s.scenarioSnapshot || null);
        setPhase(s.currentPhase || 1);
        setScore(s.satisfactionScore ?? 0);
        const transcript = Array.isArray(s.transcript) ? s.transcript : [];
        setMessages(
          transcript.map((m, i) => ({
            id: `t${i}`,
            role: m.role,
            text: m.text,
          }))
        );
      })
      .catch((e) => {
        if (alive) setError(e?.message || "Could not load this session.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // --- Autoscroll to bottom on new messages / typing -----------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  // --- Send a message ------------------------------------------------------
  function submit(raw) {
    const text = (raw ?? "").trim();
    if (!text || sendingRef.current || ending) return;

    sendingRef.current = true;
    setSending(true);
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: `c${Date.now()}`, role: "counsellor", text },
    ]);

    api
      .sendMessage(sessionId, text)
      .then((res) => {
        const reply = res?.reply ?? "";
        setMessages((prev) => [
          ...prev,
          { id: `s${Date.now()}`, role: "student", text: reply },
        ]);
        if (res?.currentPhase) setPhase(res.currentPhase);
        if (typeof res?.satisfactionScore === "number")
          setScore(res.satisfactionScore);
        if (voice.enabled && reply) voice.speak(reply);
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
  // Keep submitRef pointing at the latest closure for voice utterances.
  useEffect(() => {
    submitRef.current = submit;
  });

  function onTextareaKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(draft);
    }
  }

  // --- Voice mode toggle + speak last student line on first enable ---------
  function toggleVoice() {
    if (voice.enabled) {
      voice.disable();
    } else {
      voice.enable().then(() => {
        const lastStudent = [...messages]
          .reverse()
          .find((m) => m.role === "student");
        if (lastStudent?.text) voice.speak(lastStudent.text);
      });
    }
  }

  // --- Hold SPACE to talk (push-to-talk) -----------------------------------
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
      voice.startListening();
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space") return;
      if (!spaceDownRef.current) return;
      e.preventDefault();
      spaceDownRef.current = false;
      voice.stopListening();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      spaceDownRef.current = false;
    };
  }, [voice.enabled, voice.startListening, voice.stopListening]);

  // --- End session ---------------------------------------------------------
  function endSession() {
    if (ending) return;
    setEnding(true);
    if (voice.enabled) voice.disable();
    api
      .endSession(sessionId)
      .then((res) => navigate("/app/reports/" + res.reportId))
      .catch((e) => {
        setError(e?.message || "Could not end the session.");
        setEnding(false);
      });
  }

  // --- Loading / error states ----------------------------------------------
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Spinner size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas px-6">
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

  const voiceInfo = VOICE_STATUS[voice.status] || null;
  const voiceActive = voice.status === "recording" || voice.status === "speaking";

  return (
    <div className="flex h-screen flex-col bg-canvas">
      {/* Inline keyframes for the waveform + typing dots (scoped, no extra files). */}
      <style>{`@keyframes mct-wave{0%,100%{height:5px;transform:translateY(0)}50%{height:18px;transform:translateY(0)}}`}</style>

      {/* ---------------------------- HEADER ---------------------------- */}
      <header className="border-b border-line bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          {/* Left: persona + scenario */}
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={persona?.name} size="md" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {persona?.name || "Student"}
              </div>
              <div className="truncate text-xs text-muted">
                {scenario?.title || "Practice session"}
              </div>
            </div>
          </div>

          {/* Right: satisfaction meter + controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden w-40 sm:block">
              <div className="mb-0.5 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Student satisfaction
                </span>
              </div>
              <ScoreMeter score={score} />
            </div>

            <button
              type="button"
              onClick={toggleVoice}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                voice.enabled
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-line bg-white text-muted hover:bg-canvas hover:text-ink"
              }`}
              aria-pressed={voice.enabled}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
              </svg>
              Voice mode
            </button>

            <Button variant="danger" size="sm" onClick={endSession} disabled={ending}>
              {ending ? "Ending…" : "End session"}
            </Button>
          </div>
        </div>

        {/* Phase stepper */}
        <div className="mt-3">
          <PhaseStepper current={phase} />
        </div>

        {/* Voice status row */}
        {voice.enabled && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                voiceInfo?.tone === "danger"
                  ? "bg-danger-soft text-danger"
                  : voiceInfo?.tone === "success"
                  ? "bg-success-soft text-success"
                  : voiceInfo?.tone === "warn"
                  ? "bg-warn-soft text-warn"
                  : "bg-brand-50 text-brand-700"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${voiceActive ? "animate-pulse" : ""}`}
                style={{ background: "currentColor" }}
              />
              {voice.status === "loading"
                ? `Loading model ${voice.loadPct}%`
                : voiceInfo?.label || voice.status}
            </span>

            <span className={voiceActive ? "text-brand-600" : "text-muted/60"}>
              <Waveform active={voiceActive} />
            </span>

            <span className="text-xs text-muted">
              Hold{" "}
              <kbd className="rounded border border-line bg-canvas px-1.5 py-0.5 font-sans text-[11px] text-ink">
                Space
              </kbd>{" "}
              to talk
            </span>

            {voice.error && <span className="text-xs text-danger">{voice.error}</span>}
          </div>
        )}
      </header>

      {/* ---------------------------- MESSAGES ---------------------------- */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <EmptyState
              title="Start the conversation"
              hint="Open with rapport, then guide the student through discovery, objections and a close."
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
                </svg>
              }
            />
          )}

          {messages.map((m) => {
            if (m.role === "system") {
              return (
                <div key={m.id} className="flex justify-center">
                  <span className="rounded-full bg-danger-soft px-3 py-1 text-xs font-medium text-danger">
                    {m.text}
                  </span>
                </div>
              );
            }
            const mine = m.role === "counsellor";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                    mine
                      ? "rounded-br-md bg-brand-600 text-white"
                      : "rounded-bl-md border border-line bg-white text-ink"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-line bg-white px-4 py-3 shadow-sm">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-muted"
                    style={{ animation: `mct-wave 900ms ease-in-out ${i * 150}ms infinite` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------- INPUT BAR ---------------------------- */}
      <div className="border-t border-line bg-white p-3 sm:p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-3">
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder="Type your message…  (Enter to send · Shift+Enter for a new line)"
            disabled={sending || ending}
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-canvas px-3.5 py-3 text-sm text-ink placeholder:text-muted focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:opacity-60"
          />
          <Button
            onClick={() => submit(draft)}
            disabled={sending || ending || !draft.trim()}
            className="h-[44px]"
          >
            {sending ? (
              <Spinner size={18} className="text-white" />
            ) : (
              <>
                <span>Send</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m22 2-7 20-4-9-9-4Z M22 2 11 13" />
                </svg>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
