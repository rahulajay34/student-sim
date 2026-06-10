// Audio-reactive, emotion-tinted orb for the call stage.
// Props:
//   getAnalyser – function returning AnalyserNode|null (from voice pipeline)
//   active       – boolean, pause the audio loop when false
//   emotion  – 'neutral' | 'happy' | 'excited' | 'hesitant' | 'worried' | 'frustrated'
//   state    – 'idle' | 'speaking' | 'thinking' | 'listening'
//   name     – student name string
import useCallAudioLevel from "./useCallAudioLevel";

const EMOTION_TINTS = {
  neutral:    "#6366f1",
  happy:      "#10b981",
  excited:    "#8b5cf6",
  hesitant:   "#f59e0b",
  worried:    "#f97316",
  frustrated: "#f43f5e",
};

const STATE_CAPTION = {
  speaking:  "Speaking…",
  thinking:  "Thinking…",
  listening: "Listening to you…",
  idle:      "—",
};

function hexWithAlpha(hex, alpha) {
  // Expand shorthand hex if needed and return rgba(r,g,b,alpha).
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function Orb({ getAnalyser, active = true, emotion = "neutral", state = "idle", name = "Student" }) {
  const level = useCallAudioLevel(getAnalyser, active);
  const tint = EMOTION_TINTS[emotion] || EMOTION_TINTS.neutral;

  // Scale reacts to audio level only while speaking.
  const scale = state === "speaking" ? 1 + 0.18 * Math.min(level, 1) : 1;

  // Combine animation + transition styles by state.
  const orbAnimation = state === "thinking" ? "orb-pulse 2.4s ease-in-out infinite" : "none";
  const orbOpacity   = state === "thinking" ? 0.75 : 1;

  const glowIntensity = state === "speaking" ? 0.55 + 0.3 * level : 0.35;

  const orbStyle = {
    width:  160,
    height: 160,
    borderRadius: "50%",
    background: `radial-gradient(circle at 35% 30%, ${hexWithAlpha(tint, 0.9)} 0%, ${tint} 40%, #0f1117 100%)`,
    boxShadow: [
      `0 0 ${40 + 30 * level}px ${hexWithAlpha(tint, glowIntensity)}`,
      `0 0 ${80 + 40 * level}px ${hexWithAlpha(tint, glowIntensity * 0.5)}`,
    ].join(", "),
    transform: `scale(${scale.toFixed(4)})`,
    transition: "transform 80ms linear, box-shadow 300ms ease, background 600ms ease",
    animation: orbAnimation,
    opacity: orbOpacity,
    position: "relative",
    flexShrink: 0,
  };

  const ringStyle = {
    position: "absolute",
    inset: -20,
    borderRadius: "50%",
    border: "2px solid #10b981",
    animation: "subtle-ring 1.8s ease-out infinite",
    pointerEvents: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
      {/* Orb + listening ring */}
      <div style={{ position: "relative", width: 160, height: 160, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={orbStyle} />
        {state === "listening" && <div style={ringStyle} />}
      </div>

      {/* Name + state caption */}
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "#e7e9f4", fontWeight: 500, fontSize: "1rem", margin: 0 }}>
          {name}
        </p>
        <p style={{ color: "#8b90a8", fontSize: "0.875rem", marginTop: 4 }}>
          {STATE_CAPTION[state] ?? STATE_CAPTION.idle}
        </p>
      </div>
    </div>
  );
}
