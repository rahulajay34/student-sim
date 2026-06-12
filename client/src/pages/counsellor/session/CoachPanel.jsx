import { useEffect, useRef, useState } from "react";
import { scoreColor, TOKEN_HEX } from "../../../lib/format";

// ── Sparkline SVG ──────────────────────────────────────────────────────────────
function Sparkline({ data, colorHex }) {
  const W = 160;
  const H = 40;
  const THRESHOLD = 70;

  if (!data || data.length === 0) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line x1="0" y1={H - (THRESHOLD / 100) * H} x2={W} y2={H - (THRESHOLD / 100) * H}
          stroke="#262a36" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
    );
  }

  const points = data.slice(-20);
  const xs = points.map((_, i) => (i / Math.max(points.length - 1, 1)) * W);
  const ys = points.map((p) => H - (Math.max(0, Math.min(100, p.score)) / 100) * H);

  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const thresholdY = H - (THRESHOLD / 100) * H;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      {/* Threshold dashed line */}
      <line
        x1="0" y1={thresholdY} x2={W} y2={thresholdY}
        stroke="#8b90a8" strokeWidth="1" strokeDasharray="4 3" opacity="0.5"
      />
      {/* Sparkline */}
      <polyline
        points={polyline}
        fill="none"
        stroke={colorHex}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Last point dot */}
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3" fill={colorHex} />
    </svg>
  );
}

// ── Trend arrow ────────────────────────────────────────────────────────────────
function TrendArrow({ current, history }) {
  if (!history || history.length < 4) return null;
  const prev = history[history.length - 4]?.score ?? current;
  const delta = current - prev;
  if (Math.abs(delta) < 2) return <span style={{ color: "#8b90a8", fontSize: 12 }}>→</span>;
  return delta > 0
    ? <span style={{ color: "#10b981", fontSize: 12 }}>↑ +{Math.round(delta)}</span>
    : <span style={{ color: "#f43f5e", fontSize: 12 }}>↓ {Math.round(delta)}</span>;
}

// ── Verdict chip ───────────────────────────────────────────────────────────────
function VerdictChip({ verdict }) {
  if (!verdict) return null;
  const colorMap = {
    fast: { bg: "#4c1130", color: "#f87171", label: "ease up" },
    good: { bg: "#052e16", color: "#4ade80", label: "good pace" },
    slow: { bg: "#3b2000", color: "#fbbf24", label: "pick up" },
    high: { bg: "#052e16", color: "#4ade80", label: "energized" },
    low:  { bg: "#3b2000", color: "#fbbf24", label: "energy low" },
    warm: { bg: "#052e16", color: "#4ade80", label: "warm" },
    neutral: { bg: "#1a1f2e", color: "#818cf8", label: "neutral" },
    cold: { bg: "#1a1830", color: "#818cf8", label: "cold" },
  };
  const s = colorMap[verdict] || { bg: "#1a1f2e", color: "#8b90a8", label: verdict };
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 8px",
      borderRadius: 9999,
      fontSize: "0.6875rem",
      fontWeight: 600,
      background: s.bg,
      color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// ── Dark card wrapper ──────────────────────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div style={{
      background: "rgba(15,17,23,0.6)",
      border: "1px solid #262a36",
      borderRadius: 12,
      padding: "10px 12px",
    }}>
      <p style={{ margin: "0 0 8px 0", fontSize: "0.6875rem", fontWeight: 600, color: "#8b90a8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

// ── Milestone row ──────────────────────────────────────────────────────────────
function MilestoneRow({ done, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <span style={{
        width: 16, height: 16, borderRadius: "50%",
        background: done ? "#065f46" : "transparent",
        border: `1.5px solid ${done ? "#10b981" : "#262a36"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {done && (
          <svg viewBox="0 0 12 12" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 8, height: 8 }}>
            <polyline points="2,6 5,9 10,3" />
          </svg>
        )}
      </span>
      <span style={{ fontSize: "0.8125rem", color: done ? "#c9e8d4" : "#8b90a8" }}>{label}</span>
    </div>
  );
}

// ── Breakdown rating colors ─────────────────────────────────────────────────────
const RATING_STYLE = {
  1: { bg: "#2d0a0a", color: "#f87171", label: "Not useful" },
  2: { bg: "#3b1a00", color: "#fb923c", label: "Weak" },
  3: { bg: "#1a1f2e", color: "#8b90a8", label: "Neutral" },
  4: { bg: "#052e16", color: "#4ade80", label: "Useful" },
  5: { bg: "#064e3b", color: "#34d399", label: "Excellent" },
};

// ── Score breakdown card ────────────────────────────────────────────────────────
function ScoreBreakdownCard({ breakdown }) {
  if (!Array.isArray(breakdown) || !breakdown.length) return null;
  return (
    <Card title="Last message — info breakdown">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {breakdown.map((piece, i) => {
          const s = RATING_STYLE[piece.rating] || RATING_STYLE[3];
          return (
            <div key={i} style={{
              background: s.bg,
              border: `1px solid ${s.color}22`,
              borderRadius: 8,
              padding: "6px 10px",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: "0.75rem", color: "#c7cde8", lineHeight: 1.4, flex: 1 }}>
                  {piece.text}
                </span>
                <span style={{
                  flexShrink: 0,
                  fontSize: "0.625rem",
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 9999,
                  background: s.bg,
                  color: s.color,
                  border: `1px solid ${s.color}44`,
                }}>
                  {s.label}
                </span>
              </div>
              {piece.reason && (
                <p style={{ margin: "3px 0 0 0", fontSize: "0.6875rem", color: s.color, opacity: 0.8 }}>
                  {piece.reason}
                </p>
              )}
            </div>
          );
        })}
        <p style={{ margin: "2px 0 0 0", fontSize: "0.6875rem", color: "#8b90a8", fontStyle: "italic" }}>
          Give information one point at a time for better impact.
        </p>
      </div>
    </Card>
  );
}

// ── CoachPanel ─────────────────────────────────────────────────────────────────
export default function CoachPanel({ satisfaction, scoreHistory, deliveryMetrics, milestones, scoreBreakdown }) {
  const prevObjectionsRef = useRef(milestones?.objectionsRaised ?? 0);
  const [objectionFlash, setObjectionFlash] = useState(false);

  // Detect objection increment.
  useEffect(() => {
    const current = milestones?.objectionsRaised ?? 0;
    const prev = prevObjectionsRef.current;
    if (current > prev) {
      setObjectionFlash(true);
      const t = setTimeout(() => setObjectionFlash(false), 4000);
      prevObjectionsRef.current = current;
      return () => clearTimeout(t);
    }
    prevObjectionsRef.current = current;
  }, [milestones?.objectionsRaised]);

  const satColorKey = scoreColor(satisfaction ?? 0);
  const satHex = TOKEN_HEX[satColorKey] || "#8b90a8";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", overflowY: "auto" }}>
      {/* Objection flash */}
      {objectionFlash && (
        <div style={{
          background: "#3b2000",
          border: "1px solid #f59e0b",
          borderRadius: 10,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: "0.8125rem",
          color: "#fbbf24",
          animation: "fadeup 0.25s ease-out",
        }}>
          <span>⚠</span>
          <span>Objection raised — address it before moving on</span>
        </div>
      )}

      {/* Score breakdown (info-heavy turns) */}
      <ScoreBreakdownCard breakdown={scoreBreakdown} />

      {/* Satisfaction */}
      <Card title="Student satisfaction">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "2rem", fontWeight: 700, color: satHex, lineHeight: 1 }}>
            {satisfaction ?? 0}
          </span>
          <TrendArrow current={satisfaction ?? 0} history={scoreHistory} />
          <div style={{ marginLeft: "auto" }}>
            <Sparkline data={scoreHistory} colorHex={satHex} />
          </div>
        </div>
      </Card>

      {/* Delivery */}
      <Card title="Your delivery">
        {deliveryMetrics ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Tone */}
            {deliveryMetrics.tone && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.8125rem", color: "#8b90a8" }}>Tone</span>
                <VerdictChip verdict={deliveryMetrics.tone} />
              </div>
            )}
            {/* Pace */}
            {deliveryMetrics.wpm != null && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.8125rem", color: "#8b90a8" }}>{deliveryMetrics.wpm} wpm</span>
                <VerdictChip verdict={deliveryMetrics.paceVerdict} />
              </div>
            )}
            {/* Energy */}
            {deliveryMetrics.energyVerdict && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.8125rem", color: "#8b90a8" }}>Energy</span>
                <VerdictChip verdict={deliveryMetrics.energyVerdict} />
              </div>
            )}
            {/* Pauses microcopy */}
            {(deliveryMetrics.paceVerdict === "fast" || deliveryMetrics.energyVerdict === "high") && (
              <p style={{ margin: "2px 0 0 0", fontSize: "0.75rem", color: "#8b90a8", fontStyle: "italic" }}>
                Give more space — let the student process.
              </p>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "#8b90a8", fontStyle: "italic" }}>
            Speak with voice on to get live delivery feedback.
          </p>
        )}
      </Card>

      {/* Milestones */}
      <Card title="Call milestones">
        <MilestoneRow done={milestones?.discoveryDone} label="Discovery done" />
        <MilestoneRow done={milestones?.presentationDone} label="Programme presented" />
        <MilestoneRow done={milestones?.paymentAsked} label="Payment asked" />
        {/* Objection counter */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", marginTop: 2 }}>
          <span style={{
            width: 16, height: 16, borderRadius: "50%",
            background: "transparent",
            border: "1.5px solid #262a36",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            fontSize: "0.625rem",
            color: "#f59e0b",
            fontWeight: 700,
          }}>
            {milestones?.objectionsRaised ?? 0}
          </span>
          <span style={{ fontSize: "0.8125rem", color: "#8b90a8" }}>
            Objections raised: <span style={{ color: "#f59e0b", fontWeight: 600 }}>{milestones?.objectionsRaised ?? 0}</span>
          </span>
        </div>
      </Card>
    </div>
  );
}
