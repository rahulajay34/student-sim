import { memo, useEffect, useRef, useState } from "react";
import Orb from "./Orb";
import { scoreColor } from "../../../lib/format";
import { OPENAI_VOICES, loadStoredMicDevice } from "../../../voice/engines";

// ── In-call voice picker (audition voices live; a change reconnects briefly) ───
function VoicePicker({ voices, voice, onChange }) {
  const [open, setOpen] = useState(false);
  const current = voices.find((v) => v.id === voice) || voices[0];
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Change the student's voice (reconnects briefly)"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 9999,
          padding: "4px 12px", fontSize: "0.75rem", color: "#c7d2fe",
          background: "rgba(22,26,38,0.80)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(99,102,241,0.40)", cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden>🎙</span>
        <span>Voice: {current.label}</span>
        <span style={{ color: "#8b90a8", transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}>⌄</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20,
            width: 240, maxHeight: 280, overflowY: "auto", borderRadius: 12,
            background: "rgba(18,21,31,0.97)", backdropFilter: "blur(10px)",
            border: "1px solid #262a36", boxShadow: "0 12px 32px rgba(0,0,0,0.4)", padding: 4,
          }}
        >
          {voices.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => { onChange?.(v.id); setOpen(false); }}
              style={{
                width: "100%", textAlign: "left", display: "flex", flexDirection: "column",
                gap: 1, padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                background: v.id === voice ? "rgba(99,102,241,0.18)" : "transparent",
                color: v.id === voice ? "#c7d2fe" : "#e7e9f4",
              }}
            >
              <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{v.label}</span>
              <span style={{ fontSize: "0.66rem", color: "#8b90a8" }}>{v.note}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── In-call mic picker (switch input device live; replaceTrack, no reconnect) ──
// Mirrors VoicePicker's styling/behaviour. Enumerates audioinput devices fresh on
// open so a freshly-plugged headset shows up; the active device (from the stored
// preference) is checked. Selecting calls voice.changeMic(deviceId), which hot-
// swaps the track without re-minting the realtime token.
function shortMicLabel(label) {
  if (!label) return "Default";
  // Strip the common "(04d2:...)" hardware-id suffix browsers append, then trim.
  const clean = label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim() || label;
  return clean.length > 18 ? clean.slice(0, 17) + "…" : clean;
}

function MicPicker({ onChange }) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState([]); // [{ deviceId, label }]
  const [activeId, setActiveId] = useState(() => loadStoredMicDevice().deviceId || "default");
  const wrapRef = useRef(null);

  // Keep the checked item in sync with the stored preference (changeMic persists it).
  function syncActive() {
    setActiveId(loadStoredMicDevice().deviceId || "default");
  }

  async function enumerate() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === "audioinput");
      let n = 0;
      setDevices(inputs.map((d) => {
        n += 1;
        return { deviceId: d.deviceId, label: d.label || `Microphone ${n}` };
      }));
    } catch {
      setDevices([]);
    }
  }

  function toggleOpen() {
    setOpen((o) => {
      const next = !o;
      if (next) { syncActive(); enumerate(); } // fresh list each open
      return next;
    });
  }

  // Click-outside to close (the voice picker stays open until reselect; the mic
  // picker additionally dismisses on outside click per the device-switch UX).
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(d) {
    const id = d?.deviceId || "default";
    setActiveId(id || "default");
    onChange?.(id, d?.label || "");
    setOpen(false);
  }

  const activeLabel = activeId === "default"
    ? "Default"
    : shortMicLabel(devices.find((d) => d.deviceId === activeId)?.label || loadStoredMicDevice().label || "");

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change your microphone input (no reconnect)"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 9999,
          padding: "4px 12px", fontSize: "0.75rem", color: "#c7d2fe",
          background: "rgba(22,26,38,0.80)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(99,102,241,0.40)", cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden>🎤</span>
        <span>Mic: {activeLabel}</span>
        <span style={{ color: "#8b90a8", transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}>⌄</span>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 20,
            width: 240, maxHeight: 280, overflowY: "auto", borderRadius: 12,
            background: "rgba(18,21,31,0.97)", backdropFilter: "blur(10px)",
            border: "1px solid #262a36", boxShadow: "0 12px 32px rgba(0,0,0,0.4)", padding: 4,
          }}
        >
          {/* System default option */}
          <button
            type="button"
            role="option"
            aria-selected={activeId === "default"}
            onClick={() => pick({ deviceId: "default" })}
            style={{
              width: "100%", textAlign: "left", display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 8, padding: "7px 10px", borderRadius: 8,
              border: "none", cursor: "pointer",
              background: activeId === "default" ? "rgba(99,102,241,0.18)" : "transparent",
              color: activeId === "default" ? "#c7d2fe" : "#e7e9f4",
            }}
          >
            <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>System default</span>
            {activeId === "default" && <span aria-hidden style={{ color: "#818cf8" }}>✓</span>}
          </button>
          {devices.map((d, i) => {
            const checked = d.deviceId === activeId;
            return (
              <button
                key={d.deviceId || `mic-${i}`}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => pick(d)}
                style={{
                  width: "100%", textAlign: "left", display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: 8, padding: "7px 10px", borderRadius: 8,
                  border: "none", cursor: "pointer",
                  background: checked ? "rgba(99,102,241,0.18)" : "transparent",
                  color: checked ? "#c7d2fe" : "#e7e9f4",
                }}
              >
                <span style={{ fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.label}
                </span>
                {checked && <span aria-hidden style={{ color: "#818cf8", flexShrink: 0 }}>✓</span>}
              </button>
            );
          })}
          {devices.length === 0 && (
            <p style={{ margin: 0, padding: "8px 10px", fontSize: "0.72rem", color: "#8b90a8" }}>
              No microphones found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Phase labels (1-indexed, 5 phases) ────────────────────────────────────────
const PHASE_LABELS = {
  1: "Opening",
  2: "Discovery",
  3: "Presentation",
  4: "Objections",
  5: "Close",
};

// ── Emotion → emoji + label ────────────────────────────────────────────────────
const EMOTION_META = {
  neutral:    { emoji: "🙂", label: "Neutral",    color: "#818cf8" },
  happy:      { emoji: "😊", label: "Happy",      color: "#10b981" },
  excited:    { emoji: "🤩", label: "Excited",    color: "#8b5cf6" },
  hesitant:   { emoji: "😟", label: "Hesitant",   color: "#f59e0b" },
  worried:    { emoji: "😰", label: "Worried",    color: "#f97316" },
  frustrated: { emoji: "😤", label: "Frustrated", color: "#f43f5e" },
};

// ── Score color hex map ────────────────────────────────────────────────────────
const SCORE_COLOR_HEX = {
  success: "#10b981",
  warn:    "#f59e0b",
  danger:  "#f43f5e",
};

// ── Timer: mm:ss from a start timestamp ───────────────────────────────────────
function useTimer(startTs) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTs) return;
    const origin = typeof startTs === "number" ? startTs : new Date(startTs).getTime();

    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - origin) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startTs]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// ── Pill wrapper ───────────────────────────────────────────────────────────────
function Pill({ children, style }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 9999,
        padding: "4px 12px",
        fontSize: "0.75rem",
        color: "#8b90a8",
        background: "rgba(22,26,38,0.80)",
        backdropFilter: "blur(8px)",
        border: "1px solid #262a36",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Animated "thinking" dots subtitle ─────────────────────────────────────────
function ThinkingDots() {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", height: 24 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#8b90a8",
            animation: `orb-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            display: "inline-block",
          }}
        />
      ))}
    </div>
  );
}

// ── Inline SVG icons ───────────────────────────────────────────────────────────
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </svg>
  );
}

function PhoneDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.97.38 2.01.62 3.09.7a2 2 0 0 1 1.87 1.99V19.5a2 2 0 0 1-2.16 1.99C8.72 20.62 3.38 15.28 2.51 8.16A2 2 0 0 1 4.49 6H7.5a2 2 0 0 1 1.99 1.87c.08 1.08.32 2.12.7 3.09a2 2 0 0 1-.45 2.11L10.68 13.31Z" />
      <line x1="22" y1="2" x2="2" y2="22" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ── Circular control button ────────────────────────────────────────────────────
function CtrlBtn({ onClick, title, style, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        border: "1px solid #262a36",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "background 150ms ease",
        background: hovered ? "#1d2230" : "#161a26",
        color: "#e7e9f4",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ── Voice status pill (bottom-left) ───────────────────────────────────────────
function VoiceStatusPill({ voice }) {
  // Show error pill even when voice is not enabled (e.g. init failure).
  if (!voice.enabled && !voice.error) return null;

  let label = voice.status;
  if (voice.status === "loading") label = "Connecting…";
  else if (voice.status === "idle") label = "Voice ready";
  else if (voice.status === "listening") label = "Listening…";
  else if (voice.status === "speaking") label = "Speaking…";

  const isActive = voice.status === "speaking" || voice.status === "listening";

  return (
    <div style={{ position: "absolute", bottom: 20, left: 20, display: "flex", alignItems: "center", gap: 8 }}>
      {voice.enabled && (
        <Pill style={{ gap: 8 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isActive ? "#10b981" : "#8b90a8",
              display: "inline-block",
              animation: isActive ? "orb-pulse 1s ease-in-out infinite" : "none",
            }}
          />
          {label}
        </Pill>
      )}
      {voice.error && (
        <Pill style={{ color: "#f43f5e", borderColor: "#7f1d1d" }}>{voice.error}</Pill>
      )}
    </div>
  );
}

// ── Stage hint chip (dismissible one-liner near the bottom) ───────────────────
// Shows the live cue headline + first bullet with an "open coach" affordance.
// Sits above the bottom controls bar so it never overlaps the orb or controls.
function StageHintChip({ cue, onOpenCoach, onDismiss }) {
  const headline = typeof cue?.headline === "string" ? cue.headline.trim() : "";
  const firstPoint =
    Array.isArray(cue?.points) && typeof cue.points[0] === "string" ? cue.points[0].trim() : "";
  if (!headline && !firstPoint) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 104,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 5,
        width: "min(92vw, 560px)",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 12,
        background: "rgba(22,26,38,0.86)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(99,102,241,0.32)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.30)",
        animation: "fadeup 0.3s ease-out",
      }}
    >
      <span
        aria-hidden
        style={{
          marginTop: 3,
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          background: "#818cf8",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {headline && (
          <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 600, color: "#e7e9f4", lineHeight: 1.35 }}>
            {headline}
          </p>
        )}
        {firstPoint && (
          <p
            style={{
              margin: "2px 0 0",
              fontSize: "0.75rem",
              color: "#a8b0c8",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {firstPoint}
          </p>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onOpenCoach}
          style={{
            background: "rgba(99,102,241,0.18)",
            border: "1px solid rgba(99,102,241,0.40)",
            borderRadius: 8,
            padding: "3px 9px",
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "#c7d2fe",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Open coach
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss cue"
          title="Dismiss"
          style={{
            background: "transparent",
            border: "none",
            color: "#8b90a8",
            cursor: "pointer",
            fontSize: "1rem",
            lineHeight: 1,
            padding: "2px 4px",
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ── Info panel (S8): persistent, collapsible top-left brief ───────────────────
// Shows ONLY the realistic lead-card details a counsellor would actually have in
// front of them (name, age, current job or school/college, city) plus the course
// they are selling. No situation prose / coaching narrative. Sits BELOW the
// top-left pills so it never overlaps them.
function rupee(n) {
  return typeof n === "number" && Number.isFinite(n)
    ? "₹" + n.toLocaleString("en-IN")
    : null;
}

function InfoRow({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div style={{ display: "flex", gap: 6, fontSize: "0.7rem", lineHeight: 1.5 }}>
      <span style={{ color: "#8b90a8", flexShrink: 0 }}>{label}:</span>
      <span style={{ color: "#cdd2e4" }}>{value}</span>
    </div>
  );
}

function InfoPanel({ course, persona, leadCard, revealPersona }) {
  const [open, setOpen] = useState(true);

  // The student's real name (from the chosen lead profile), falling back to the
  // voice name for bare-persona sessions.
  const studentName = leadCard?.name || persona?.voiceName || persona?.name || null;
  const age = typeof leadCard?.age === "number" ? leadCard.age : null;
  // What they're doing now: current job if working, else current school/college
  // if studying, else the persona category as a soft fallback.
  const occupation = leadCard?.occupation || null;
  const education = leadCard?.education || null;
  const fallbackType =
    persona?.name && persona.name !== studentName ? persona.name : null;
  const city = leadCard?.city || null;

  // "Age · City" sub-line, only the parts we actually have.
  const metaLine = [age != null ? `${age} yrs` : null, city].filter(Boolean).join(" · ");

  // EMI / placement facts may live under a few possible snapshot keys; show what's there.
  const emi = course?.emi || course?.emiText || null;
  const placement = course?.placement || course?.placementText || null;

  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 20,
        zIndex: 4,
        width: "min(78vw, 256px)",
        borderRadius: 14,
        background: "rgba(18,21,31,0.86)",
        backdropFilter: "blur(10px)",
        border: "1px solid #262a36",
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        overflow: "hidden",
      }}
    >
      {/* Header / collapse toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Collapse brief" : "Expand brief"}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "#c7d2fe",
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <span>Call brief</span>
        <span style={{ color: "#8b90a8", transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}>
          ⌄
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Student */}
          <div>
            <p style={{ margin: "0 0 3px", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6f7590" }}>
              Student
            </p>
            {revealPersona === false ? (
              <p style={{ margin: 0, fontSize: "0.74rem", color: "#a8b0c8", fontStyle: "italic" }}>
                Blind call — student hidden
              </p>
            ) : (
              <>
                {studentName && (
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#e7e9f4" }}>
                    {studentName}
                  </p>
                )}
                {metaLine && (
                  <p style={{ margin: "1px 0 0", fontSize: "0.66rem", color: "#8b90a8" }}>
                    {metaLine}
                  </p>
                )}
                {occupation && <InfoRow label="Works as" value={occupation} />}
                {!occupation && education && <InfoRow label="Studying" value={education} />}
                {!occupation && !education && fallbackType && (
                  <p style={{ margin: "1px 0 0", fontSize: "0.66rem", color: "#8b90a8" }}>
                    {fallbackType}
                  </p>
                )}
                {!studentName && !metaLine && !occupation && !education && (
                  <p style={{ margin: 0, fontSize: "0.72rem", color: "#8b90a8" }}>—</p>
                )}
              </>
            )}
          </div>

          {/* Course facts — always shown (even in blind mode) */}
          {course && (
            <div>
              <p style={{ margin: "0 0 3px", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6f7590" }}>
                Course
              </p>
              {course.name && (
                <p style={{ margin: "0 0 3px", fontSize: "0.78rem", fontWeight: 600, color: "#e7e9f4" }}>
                  {course.name}
                </p>
              )}
              <InfoRow label="Fee" value={rupee(course.feeTotal)} />
              <InfoRow label="Seat block" value={rupee(course.feeBooking)} />
              <InfoRow label="Duration" value={course.duration} />
              <InfoRow label="EMI" value={emi} />
              <InfoRow label="Placement" value={placement} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main CallStage ─────────────────────────────────────────────────────────────
// Memoized (default export at the bottom) so per-token transcript streaming in
// the sidebar — which churns `messages` on the parent — does NOT re-render the
// orb / analyser subtree. CallStage only re-renders when its own props change.
function CallStage({
  // session info
  personaName,
  phase,
  emotion,
  satisfaction,
  // info panel (S8)
  course,
  persona,
  leadCard,
  revealPersona,
  // session mode ("voice" | "text") + thinking toggle (text mode)
  sessionMode = "voice",
  thinkingOn,
  onToggleThinking,
  // orb
  getAnalyser,
  orbState,
  subtitle,
  awaitingReply,
  hasMessages,
  // voice
  voice,
  onToggleMic,
  // openai realtime voice picker (voice mode)
  openaiVoice,
  onChangeOpenaiVoice,
  // mic input-device picker (voice mode, while connected)
  onChangeMic,
  // keyboard / sidebar
  onToggleKeyboard,
  sidebarOpen,
  // end call
  onEndCall,
  // satisfaction toggle
  showSat,
  onToggleSat,
  // timer
  timerStart,
  // live cue chip
  cue,
  onOpenCoach,
}) {
  const timer = useTimer(timerStart);
  const [micHintShown] = useState(true); // always show once; no need to hide
  const em = EMOTION_META[emotion] || EMOTION_META.neutral;
  const isVoice = sessionMode !== "text";

  // ── Score-change pulse: briefly scale + tint the live sat number on change ──
  const [satPulse, setSatPulse] = useState(false);
  // null sentinel: the first real value (e.g. 0 → 45 when a resumed session
  // hydrates) registers silently instead of firing the pulse on page load.
  const prevSatRef = useRef(null);
  useEffect(() => {
    if (prevSatRef.current === null) {
      prevSatRef.current = satisfaction;
      return;
    }
    if (prevSatRef.current !== satisfaction) {
      prevSatRef.current = satisfaction;
      setSatPulse(true);
      const t = setTimeout(() => setSatPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [satisfaction]);

  // ── Live cue chip: enable toggle (persisted) + per-cue dismissal ───────────
  const [cuesEnabled, setCuesEnabled] = useState(() => {
    try {
      return localStorage.getItem("mct_cues") !== "off";
    } catch {
      return true;
    }
  });
  function toggleCues() {
    setCuesEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("mct_cues", next ? "on" : "off");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Reset dismissal whenever a new cue arrives (keyed by headline + first point).
  const cueKey = cue ? `${cue.headline || ""}|${(cue.points && cue.points[0]) || ""}` : "";
  const [dismissedKey, setDismissedKey] = useState(null);
  const chipVisible = cuesEnabled && !!cueKey && dismissedKey !== cueKey;
  const satColorKey = scoreColor(satisfaction ?? 0);
  const satHex = SCORE_COLOR_HEX[satColorKey] || "#8b90a8";

  return (
    <div
      style={{
        flex: 1,
        background: "#0f1117",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* ── Top-left pills ─────────────────────────────────────────────── */}
      <div style={{ position: "absolute", top: 20, left: 20, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", maxWidth: "calc(100% - 40px)" }}>
        {/* Phase: current → next (S5) */}
        <Pill>
          <span style={{ color: "#818cf8", fontWeight: 600 }}>
            {PHASE_LABELS[phase] || `Phase ${phase}`}
          </span>
          {PHASE_LABELS[phase + 1] && (
            <span style={{ color: "#5b6178" }}>
              → Next: {PHASE_LABELS[phase + 1]}
            </span>
          )}
        </Pill>

        {/* Emotion */}
        <Pill style={{ color: em.color }}>
          <span>{em.emoji}</span>
          <span>{em.label}</span>
        </Pill>

        {/* Timer */}
        <Pill>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{timer}</span>
        </Pill>

        {/* Thinking toggle (text mode only — applies to the MiniMax /message reply) */}
        {!isVoice && (
          <button
            type="button"
            onClick={onToggleThinking}
            title="Thinking on = more deliberate student, slower replies."
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 9999,
              padding: "4px 12px",
              fontSize: "0.75rem",
              color: thinkingOn ? "#fcd9a5" : "#8b90a8",
              background: "rgba(22,26,38,0.80)",
              backdropFilter: "blur(8px)",
              border: `1px solid ${thinkingOn ? "rgba(245,158,11,0.45)" : "#262a36"}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "border-color 150ms ease, color 150ms ease",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                flexShrink: 0,
                background: thinkingOn ? "#f59e0b" : "#4b5167",
              }}
            />
            {thinkingOn ? "Thinking on" : "Thinking off"}
          </button>
        )}

        {/* Cue chips toggle */}
        <button
          type="button"
          onClick={toggleCues}
          title={cuesEnabled ? "Hide live coaching cues" : "Show live coaching cues"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 9999,
            padding: "4px 12px",
            fontSize: "0.75rem",
            color: cuesEnabled ? "#c7d2fe" : "#8b90a8",
            background: "rgba(22,26,38,0.80)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${cuesEnabled ? "rgba(99,102,241,0.40)" : "#262a36"}`,
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "border-color 150ms ease, color 150ms ease",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              flexShrink: 0,
              background: cuesEnabled ? "#818cf8" : "#4b5167",
            }}
          />
          {cuesEnabled ? "Cues on" : "Cues off"}
        </button>

        {/* Mode indicator (Voice / Text) */}
        <Pill
          style={{
            color: isVoice ? "#34d399" : "#8b90a8",
            borderColor: isVoice ? "rgba(16,185,129,0.40)" : "#262a36",
          }}
        >
          <span
            style={{
              width: 6, height: 6, borderRadius: "50%", display: "inline-block",
              background: isVoice ? "#10b981" : "#4b5167",
            }}
          />
          {isVoice ? "Voice" : "Text"}
        </Pill>

        {/* Live OpenAI voice picker (voice mode only) */}
        {isVoice && (
          <VoicePicker voices={OPENAI_VOICES} voice={openaiVoice} onChange={onChangeOpenaiVoice} />
        )}

        {/* Mic input-device picker (voice mode, while connected) */}
        {isVoice && voice.enabled && (
          <MicPicker onChange={onChangeMic} />
        )}
      </div>

      {/* ── Info panel (S8): persistent brief below the pills ───────────── */}
      <InfoPanel
        course={course}
        persona={persona}
        leadCard={leadCard}
        revealPersona={revealPersona}
      />

      {/* ── Top-right: satisfaction pill ───────────────────────────────── */}
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <button
          type="button"
          onClick={onToggleSat}
          title={showSat ? "Hide satisfaction score" : "Show satisfaction score"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 9999,
            padding: "4px 12px",
            fontSize: "0.75rem",
            background: "rgba(22,26,38,0.80)",
            backdropFilter: "blur(8px)",
            border: "1px solid #262a36",
            cursor: "pointer",
            transition: "border-color 150ms ease",
          }}
        >
          {showSat ? (
            <>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: satHex,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: satHex,
                  fontWeight: 600,
                  display: "inline-block",
                  fontVariantNumeric: "tabular-nums",
                  transform: satPulse ? "scale(1.45)" : "scale(1)",
                  textShadow: satPulse ? `0 0 10px ${satHex}` : "none",
                  transition: "transform 250ms cubic-bezier(0.34,1.56,0.64,1), text-shadow 250ms ease",
                }}
              >
                {satisfaction ?? 0}
              </span>
              <span style={{ color: "#8b90a8" }}>sat</span>
              <EyeIcon />
            </>
          ) : (
            <>
              <span style={{ color: "#8b90a8" }}>satisfaction hidden</span>
              <EyeOffIcon />
            </>
          )}
        </button>
      </div>

      {/* ── Center: Orb + subtitle ──────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
        <Orb getAnalyser={getAnalyser} active={orbState === "speaking"} emotion={emotion} state={orbState} name={personaName || "Student"} />

        {/* Subtitle area */}
        <div style={{ minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", maxWidth: 480, textAlign: "center" }}>
          {awaitingReply ? (
            <ThinkingDots />
          ) : subtitle ? (
            <p
              style={{
                color: "rgba(231,233,244,0.9)",
                fontSize: "0.9375rem",
                lineHeight: 1.6,
                margin: 0,
                animation: "fadeup 0.3s ease-out",
              }}
            >
              {subtitle}
            </p>
          ) : !hasMessages ? (
            // S6 counsellor-first: nothing has been said yet — prompt the counsellor
            // to open the call. Their first typed/spoken message starts it.
            <p
              style={{
                color: "rgba(168,176,200,0.95)",
                fontSize: "0.9375rem",
                lineHeight: 1.6,
                margin: 0,
                animation: "fadeup 0.3s ease-out",
              }}
            >
              You&apos;re connected — greet the student to begin.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Live cue hint chip (above the controls bar) ─────────────────── */}
      {chipVisible && (
        <StageHintChip
          cue={cue}
          onOpenCoach={() => onOpenCoach?.()}
          onDismiss={() => setDismissedKey(cueKey)}
        />
      )}

      {/* ── Bottom controls bar ─────────────────────────────────────────── */}
      <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* Mic button (voice mode): open mic; button toggles mute. */}
          {isVoice && (() => {
            const micActive = voice.enabled && !voice.muted;
            const micTitle = voice.enabled
              ? (voice.muted ? "Unmute mic" : "Mute mic")
              : "Connect voice";
            return (
              <CtrlBtn
                title={micTitle}
                onClick={onToggleMic}
                style={micActive ? { background: "#065f46", borderColor: "#10b981", color: "#10b981" } : {}}
              >
                <MicIcon />
              </CtrlBtn>
            );
          })()}

          {/* Keyboard / sidebar toggle */}
          <CtrlBtn
            title={sidebarOpen ? "Close panel" : "Open chat panel"}
            onClick={onToggleKeyboard}
            style={sidebarOpen ? { borderColor: "#818cf8", color: "#818cf8" } : {}}
          >
            <KeyboardIcon />
          </CtrlBtn>

          {/* End call */}
          <CtrlBtn
            title="End call"
            onClick={onEndCall}
            style={{ background: "#e0245e", borderColor: "#e0245e", color: "#fff" }}
          >
            <PhoneDownIcon />
          </CtrlBtn>
        </div>

        {/* Mic hint (voice mode) */}
        {isVoice && voice.enabled && micHintShown && (
          <p style={{ color: "#8b90a8", fontSize: "0.7rem", margin: 0 }}>
            {voice.muted ? (
              <>
                Hold{" "}
                <kbd style={{ background: "#161a26", border: "1px solid #262a36", borderRadius: 4, padding: "1px 5px", fontFamily: "inherit", fontSize: "0.7rem", color: "#e7e9f4" }}>Space</kbd>{" "}
                to talk · tap the mic for hands-free
              </>
            ) : "Mic open (hands-free) — tap the mic to mute"}
          </p>
        )}

        {/* Text-mode hint */}
        {!isVoice && (
          <p style={{ color: "#8b90a8", fontSize: "0.7rem", margin: 0 }}>
            Type in the panel to talk to the student
          </p>
        )}
      </div>

      {/* ── Voice status pill (bottom-left) ───────────────────────────── */}
      <VoiceStatusPill voice={voice} />
    </div>
  );
}

export default memo(CallStage);
