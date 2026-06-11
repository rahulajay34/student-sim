// ── CueCard ───────────────────────────────────────────────────────────────────
// Live coaching cue card rendered in the Coach tab of CallSidebar.
//
// A cue is the object returned on the message done/JSON payload (`cue`) and by
// POST /sessions/:id/cue. Shape (see server/cues.js):
//   { source: 'corpus'|'llm', headline: string, points: string[], example: string|null }
//
// Old sessions / a missing cue field → render nothing (no crash). While the LLM
// refines an instant cue, we show the last/instant cue with a subtle skeleton
// shimmer rather than blanking the panel.

// ── Source badge ───────────────────────────────────────────────────────────────
function SourceBadge({ source, refining }) {
  const isLlm = source === "llm";
  const label = refining ? "refining…" : isLlm ? "ai coach" : "corpus";
  const color = refining ? "#8b90a8" : isLlm ? "#a5b4fc" : "#7dd3a8";
  const bg = refining
    ? "rgba(139,144,168,0.12)"
    : isLlm
      ? "rgba(99,102,241,0.14)"
      : "rgba(16,185,129,0.12)";
  const border = refining
    ? "rgba(139,144,168,0.30)"
    : isLlm
      ? "rgba(99,102,241,0.40)"
      : "rgba(16,185,129,0.35)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        flexShrink: 0,
        borderRadius: 9999,
        padding: "2px 9px",
        fontSize: "0.625rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        color,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      {refining && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: color,
            animation: "orb-pulse 1s ease-in-out infinite",
          }}
        />
      )}
      {label}
    </span>
  );
}

// ── Skeleton (no cue yet, but a turn is in flight) ────────────────────────────
function CueSkeleton() {
  return (
    <div
      style={{
        margin: "12px 14px",
        borderRadius: 14,
        border: "1px solid rgba(99,102,241,0.18)",
        background: "rgba(29,39,64,0.45)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div className="animate-pulse" style={{ height: 13, width: "70%", borderRadius: 6, background: "rgba(139,144,168,0.18)" }} />
      <div className="animate-pulse" style={{ height: 10, width: "90%", borderRadius: 6, background: "rgba(139,144,168,0.12)" }} />
      <div className="animate-pulse" style={{ height: 10, width: "82%", borderRadius: 6, background: "rgba(139,144,168,0.12)" }} />
      <div className="animate-pulse" style={{ height: 10, width: "60%", borderRadius: 6, background: "rgba(139,144,168,0.12)" }} />
    </div>
  );
}

// ── Bullet ──────────────────────────────────────────────────────────────────
function Bullet({ children }) {
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5 }}>
      <span
        aria-hidden
        style={{
          marginTop: 7,
          width: 5,
          height: 5,
          borderRadius: "50%",
          flexShrink: 0,
          background: "#818cf8",
        }}
      />
      <span style={{ color: "#cdd6f4", fontSize: "0.8125rem" }}>{children}</span>
    </li>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── CueCard ───────────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export default function CueCard({ cue, refining = false }) {
  // No cue at all → render the skeleton only while a turn is in flight (refining);
  // otherwise render nothing so old sessions / missing cue fields stay blank.
  if (!cue || typeof cue !== "object") {
    return refining ? <CueSkeleton /> : null;
  }

  const headline = typeof cue.headline === "string" ? cue.headline : "";
  const points = Array.isArray(cue.points) ? cue.points.filter((p) => typeof p === "string" && p.trim()) : [];
  const example = typeof cue.example === "string" && cue.example.trim() ? cue.example.trim() : null;
  const source = cue.source === "llm" ? "llm" : "corpus";

  if (!headline && !points.length && !example) {
    return refining ? <CueSkeleton /> : null;
  }

  return (
    <div
      style={{
        margin: "12px 14px",
        borderRadius: 14,
        border: "1px solid rgba(99,102,241,0.22)",
        background: "rgba(29,39,64,0.55)",
        backdropFilter: "blur(8px)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: refining ? 0.92 : 1,
        transition: "opacity 200ms ease",
      }}
    >
      {/* Headline + source badge */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#e7e9f4", lineHeight: 1.4 }}>
          {headline || "Coaching cue"}
        </p>
        <SourceBadge source={source} refining={refining} />
      </div>

      {/* Bullet points */}
      {points.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 7 }}>
          {points.map((p, i) => (
            <Bullet key={i}>{p}</Bullet>
          ))}
        </ul>
      )}

      {/* Example line — quoted "say something like" style */}
      {example && (
        <div
          style={{
            marginTop: 2,
            borderLeft: "2px solid rgba(129,140,248,0.55)",
            paddingLeft: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span
            style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "#8b90a8",
            }}
          >
            Say something like
          </span>
          <p style={{ margin: 0, fontSize: "0.8125rem", fontStyle: "italic", color: "#c7d2fe", lineHeight: 1.5 }}>
            “{example}”
          </p>
        </div>
      )}
    </div>
  );
}
