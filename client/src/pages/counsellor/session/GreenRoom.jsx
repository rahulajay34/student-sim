import { useState } from "react";
import Spinner from "../../../ui/Spinner";

const CATEGORY_LABEL = {
  studying: "Currently studying",
  graduate: "Recent graduate",
  "same-field": "Working — same field",
  "diff-field": "Working — different field",
  "non-working": "Non-working",
  custom: "Custom",
};

// ── Persona trait chips ───────────────────────────────────────────────────────
// Compact, human-readable summary of the persona's personality so the counsellor
// knows what kind of student they'll face before joining (mirrors the admin
// PersonalitySummary pattern). Shows nothing when the persona has no personality.
const TRAIT_CHIP = {
  talkativeness: { label: "Talkativeness", lo: "Terse", hi: "Chatty" },
  humour: { label: "Humour", lo: "Serious", hi: "Playful" },
  skepticism: { label: "Skepticism", lo: "Open", hi: "Hard to convince" },
  formality: { label: "Formality", lo: "Casual", hi: "Polished" },
};

function traitWord(trait, value) {
  const meta = TRAIT_CHIP[trait];
  if (!meta || typeof value !== "number") return null;
  if (value <= 2) return `${meta.label}: ${meta.lo}`;
  if (value >= 4) return `${meta.label}: ${meta.hi}`;
  return null; // mid-range (3) → omit to keep the chip row focused on what stands out
}

function PersonaTraitChips({ personality }) {
  if (!personality || typeof personality !== "object") return null;
  const chips = [
    traitWord("talkativeness", personality.talkativeness),
    traitWord("skepticism", personality.skepticism),
    traitWord("formality", personality.formality),
    traitWord("humour", personality.humour),
  ].filter(Boolean);
  const quirks = Array.isArray(personality.quirks) ? personality.quirks.slice(0, 2) : [];
  if (chips.length === 0 && quirks.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ background: "rgba(99,102,241,0.14)", color: "#c7d2fe", border: "1px solid rgba(99,102,241,0.30)" }}
        >
          {c}
        </span>
      ))}
      {quirks.map((q) => (
        <span
          key={q}
          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs"
          style={{ background: "#1a1e2a", color: "#a8b0c8", border: "1px solid #262a36" }}
          title={q}
        >
          {q.length > 36 ? q.slice(0, 34) + "…" : q}
        </span>
      ))}
    </div>
  );
}

// ── Mic permission probe ──────────────────────────────────────────────────────
function MicCheck() {
  const [state, setMicState] = useState("idle"); // idle | granted | denied | error

  async function testMic() {
    setMicState("testing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicState("granted");
    } catch {
      setMicState("denied");
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium" style={{ color: "#e7e9f4" }}>
          Microphone
        </p>
        <p className="text-xs" style={{ color: "#8b90a8" }}>
          {state === "granted"
            ? "Access granted"
            : state === "denied"
            ? "Access denied — check browser settings"
            : state === "error"
            ? "Could not test microphone"
            : "Not yet tested"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {state === "granted" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/60 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Ready
          </span>
        )}
        {state === "denied" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-900/60 px-2.5 py-0.5 text-xs font-medium text-red-300">
            Denied
          </span>
        )}
        <button
          type="button"
          onClick={testMic}
          disabled={state === "testing"}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          style={{
            borderColor: "#262a36",
            color: "#e7e9f4",
            background: "#161a26",
          }}
        >
          {state === "testing" ? "Testing…" : "Test mic"}
        </button>
      </div>
    </div>
  );
}

// ── Dark card wrapper ─────────────────────────────────────────────────────────
function DarkCard({ title, children }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "#161a26", border: "1px solid #262a36" }}
    >
      {title && (
        <p
          className="mb-3 text-xs font-semibold uppercase tracking-widest"
          style={{ color: "#8b90a8" }}
        >
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

// ── Main GreenRoom component ──────────────────────────────────────────────────
export default function GreenRoom({
  mode,
  assignment,
  persona,
  course,
  scenario,
  onJoin,
  joining,
  error,
}) {
  const revealPersona =
    !assignment || assignment.revealPersona !== false;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "#0f1117", color: "#e7e9f4" }}
    >
      {/* ── Header ── */}
      <div className="px-6 py-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#8b90a8" }}>
          {mode === "practice" ? "Free practice" : "Mock counselling call"}
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          You&apos;re about to join a mock counselling call
        </h1>
        <p className="mt-2 text-sm" style={{ color: "#8b90a8" }}>
          Review the brief, then join by voice — or practise by text.
        </p>
      </div>

      {/* ── Body ── */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 pb-10">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Left: Brief ── */}
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#8b90a8" }}>
              Brief
            </p>

            {/* Course card */}
            {course && (
              <DarkCard title="Course">
                <p className="text-base font-semibold">{course.name}</p>
                {course.institute && (
                  <p className="mt-1 text-sm" style={{ color: "#8b90a8" }}>
                    {course.institute}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-4 text-xs" style={{ color: "#8b90a8" }}>
                  {course.duration && (
                    <span>
                      <span className="font-medium" style={{ color: "#e7e9f4" }}>
                        Duration:
                      </span>{" "}
                      {course.duration}
                    </span>
                  )}
                  {course.feeTotal != null && (
                    <span>
                      <span className="font-medium" style={{ color: "#e7e9f4" }}>
                        Fee:
                      </span>{" "}
                      ₹{course.feeTotal.toLocaleString("en-IN")}
                    </span>
                  )}
                  {course.feeBooking != null && (
                    <span>
                      <span className="font-medium" style={{ color: "#e7e9f4" }}>
                        Seat block:
                      </span>{" "}
                      ₹{course.feeBooking.toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
              </DarkCard>
            )}

            {/* Scenario card */}
            {scenario && (
              <DarkCard title="Scenario">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold">{scenario.title}</p>
                  {scenario.difficulty && (
                    <DifficultyPill level={scenario.difficulty} />
                  )}
                </div>
                {scenario.situation && (
                  <p className="mt-2 text-sm" style={{ color: "#8b90a8" }}>
                    {scenario.situation}
                  </p>
                )}
              </DarkCard>
            )}

            {/* Student / Blind card */}
            {revealPersona ? (
              persona && (
                <DarkCard title="Student">
                  <p className="text-base font-semibold">{persona.name}</p>
                  {(persona.label || persona.category) && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {persona.category && (
                        <span className="inline-flex items-center rounded-full bg-indigo-900/60 px-2.5 py-0.5 text-xs font-medium text-indigo-300">
                          {CATEGORY_LABEL[persona.category] || persona.category}
                        </span>
                      )}
                      {persona.label && (
                        <span className="inline-flex items-center rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                          {persona.label}
                        </span>
                      )}
                    </div>
                  )}
                  {persona.description && (
                    <p className="mt-2 text-sm" style={{ color: "#8b90a8" }}>
                      {persona.description}
                    </p>
                  )}
                  {/* Personality trait chips — what kind of student to expect */}
                  <PersonaTraitChips personality={persona.personality} />
                </DarkCard>
              )
            ) : (
              <DarkCard title="Student">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-lg">
                    ?
                  </span>
                  <div>
                    <p className="font-semibold">Blind call</p>
                    <p className="text-sm" style={{ color: "#8b90a8" }}>
                      You&apos;ll discover who they are as the call unfolds.
                    </p>
                  </div>
                </div>
              </DarkCard>
            )}
          </div>

          {/* ── Right: System check ── */}
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#8b90a8" }}>
              Before you join
            </p>

            <DarkCard>
              <div className="space-y-2">
                <p className="text-sm font-medium" style={{ color: "#e7e9f4" }}>
                  Voice call
                </p>
                <p className="text-xs" style={{ color: "#8b90a8" }}>
                  Speak with the student in real time — the AI plays the prospective student and
                  replies in a natural Indian-English voice. Your coach scores every turn live.
                </p>
              </div>
            </DarkCard>

            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#8b90a8" }}>
              System check
            </p>

            <DarkCard>
              <MicCheck />
            </DarkCard>

            <div
              className="rounded-xl px-4 py-3 text-xs"
              style={{ background: "#161a26", border: "1px solid #262a36", color: "#8b90a8" }}
            >
              No mic? You can still practise by text — the chat runs the same coaching engine,
              just without spoken audio.
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div
            className="mt-6 rounded-xl px-4 py-3 text-sm"
            style={{
              background: "#2d1212",
              border: "1px solid #7f1d1d",
              color: "#fca5a5",
            }}
          >
            {error}
          </div>
        )}

        {/* ── Footer: join options (voice + text, equal prominence) ── */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          {/* Primary: Join voice call */}
          <button
            type="button"
            disabled={joining}
            onClick={() => onJoin("voice")}
            className="flex min-w-[220px] items-center justify-center gap-2 rounded-2xl px-8 py-3.5 text-base font-semibold transition-opacity disabled:opacity-60"
            style={{ background: "#4f46e5", color: "#fff" }}
          >
            {joining ? (
              <>
                <Spinner size={18} />
                Joining…
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24 11.47 11.47 0 003.58.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.58a1 1 0 01-.24 1.01l-2.21 2.2z" />
                </svg>
                Join call
              </>
            )}
          </button>

          {/* Secondary-but-visible: Practice by text (same size row, secondary variant) */}
          <button
            type="button"
            disabled={joining}
            onClick={() => onJoin("text")}
            className="flex min-w-[220px] items-center justify-center gap-2 rounded-2xl px-8 py-3.5 text-base font-semibold transition-colors disabled:opacity-60"
            style={{ background: "#161a26", color: "#e7e9f4", border: "1px solid #3a3f52" }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Practice by text
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline difficulty pill (avoids importing DifficultyBadge which imports format.js) ──
function DifficultyPill({ level }) {
  const map = {
    easy: { bg: "bg-emerald-900/60", text: "text-emerald-300", label: "Easy" },
    medium: { bg: "bg-amber-900/60", text: "text-amber-300", label: "Medium" },
    hard: { bg: "bg-red-900/60", text: "text-red-300", label: "Hard" },
  };
  const s = map[level] || map.medium;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}
