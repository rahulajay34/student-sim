import { useEffect, useState } from "react";
import Orb from "./Orb";
import { scoreColor } from "../../../lib/format";
import { sidecarStatus, capabilityReady } from "../../../voice/sidecarClient";

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

  const sc = sidecarStatus();
  const hasSidecar = sc?.ok && capabilityReady(sc?.capabilities?.tts);

  let label = voice.status;
  if (voice.status === "loading") label = `Loading ${voice.loadPct}%`;
  else if (voice.status === "idle") label = "Voice ready";
  else if (voice.status === "recording") label = "Recording…";
  else if (voice.status === "transcribing") label = "Transcribing…";
  else if (voice.status === "speaking") label = "Speaking…";

  const isActive = voice.status === "recording" || voice.status === "speaking";

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
          {hasSidecar && (
            <span style={{ color: "#10b981", marginLeft: 4 }}>· sidecar</span>
          )}
        </Pill>
      )}
      {voice.error && (
        <Pill style={{ color: "#f43f5e", borderColor: "#7f1d1d" }}>{voice.error}</Pill>
      )}
    </div>
  );
}

// ── Main CallStage ─────────────────────────────────────────────────────────────
export default function CallStage({
  // session info
  personaName,
  phase,
  emotion,
  satisfaction,
  // orb
  getAnalyser,
  orbState,
  subtitle,
  awaitingReply,
  // voice
  voice,
  onToggleMic,
  micLatched,
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
}) {
  const timer = useTimer(timerStart);
  const [micHintShown] = useState(true); // always show once; no need to hide
  const em = EMOTION_META[emotion] || EMOTION_META.neutral;
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
      <div style={{ position: "absolute", top: 20, left: 20, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {/* Phase */}
        <Pill>
          <span style={{ color: "#818cf8", fontWeight: 600 }}>
            {PHASE_LABELS[phase] || `Phase ${phase}`}
          </span>
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
      </div>

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
              <span style={{ color: satHex, fontWeight: 600 }}>
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
          ) : null}
        </div>
      </div>

      {/* ── Bottom controls bar ─────────────────────────────────────────── */}
      <div style={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* Mic button */}
          <CtrlBtn
            title={voice.enabled ? (micLatched ? "Mute mic" : "Activate mic") : "Enable voice first"}
            onClick={onToggleMic}
            style={
              micLatched
                ? { background: "#065f46", borderColor: "#10b981", color: "#10b981" }
                : {}
            }
          >
            <MicIcon />
          </CtrlBtn>

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

        {/* Mic hint */}
        {voice.enabled && micHintShown && (
          <p style={{ color: "#8b90a8", fontSize: "0.7rem", margin: 0 }}>
            Hold{" "}
            <kbd
              style={{
                background: "#161a26",
                border: "1px solid #262a36",
                borderRadius: 4,
                padding: "1px 5px",
                fontFamily: "inherit",
                fontSize: "0.7rem",
                color: "#e7e9f4",
              }}
            >
              Space
            </kbd>{" "}
            to talk
          </p>
        )}
      </div>

      {/* ── Voice status pill (bottom-left) ───────────────────────────── */}
      <VoiceStatusPill voice={voice} />
    </div>
  );
}
