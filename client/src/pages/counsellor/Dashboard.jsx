import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth.jsx";
import { bandColor, relativeDate, TOKEN_HEX } from "../../lib/format";
import Card, { CardHeader } from "../../ui/Card";
import Button from "../../ui/Button";
import Badge from "../../ui/Badge";
import CountUp from "../../ui/CountUp";
import EmptyState from "../../ui/EmptyState";

// ---------------------------------------------------------------------------
// Persona mapping from objectionCategory → personaId
// ---------------------------------------------------------------------------
const OBJECTION_TO_PERSONA = {
  parents_family: "persona-graduate",
  fee: "persona-non-working",
  emi_affordability: "persona-non-working",
  course_fit_relevance: "persona-diff-field",
  time_commitment: "persona-same-field",
};

// Default fallback persona — a seeded persona that always exists.
const DEFAULT_DRILL_PERSONA = "persona-studying";

// Resolve a drill's persona: prefer an explicit personaId on the analytics
// payload, else map the objection category, else the safe default. Returns null
// only when none of these yield a usable (non-empty) id — the caller guards on it.
function drillPersonaId(drill) {
  const explicit = typeof drill?.personaId === "string" ? drill.personaId.trim() : "";
  if (explicit) return explicit;
  const mapped = OBJECTION_TO_PERSONA[drill?.objectionCategory];
  if (mapped) return mapped;
  return DEFAULT_DRILL_PERSONA || null;
}

// ---------------------------------------------------------------------------
// Humanize helpers
// ---------------------------------------------------------------------------
const CRITERION_LABEL = {
  rapport: "Rapport Building",
  need_discovery: "Need Discovery",
  course_pitch: "Course Pitch",
  objection_handling: "Objection Handling",
  closing: "Closing",
  follow_up: "Follow-Up",
  empathy: "Empathy",
  active_listening: "Active Listening",
};

const OBJECTION_LABEL = {
  parents_family: "Parents / Family",
  fee: "Fee Concerns",
  emi_affordability: "EMI / Affordability",
  course_fit_relevance: "Course Fit",
  time_commitment: "Time Commitment",
  competing_priorities: "Competing Priorities",
  trust_legitimacy: "Trust & Legitimacy",
  job_guarantee_placement: "Job Guarantee",
  language_english: "English Comfort",
  tech_access: "Tech Access",
  other: "Other",
};

function humanizeCriterion(key) {
  return CRITERION_LABEL[key] ?? key.replace(/_/g, " ");
}

function humanizeObjection(key) {
  return OBJECTION_LABEL[key] ?? key.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------
function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Hero row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-2xl border border-line shadow-sm p-6">
          <div className="h-4 w-28 rounded bg-canvas mb-4" />
          <div className="h-12 w-24 rounded bg-canvas mb-2" />
          <div className="h-3 w-36 rounded bg-canvas mb-4" />
          <div className="h-24 rounded bg-canvas" />
        </div>
        <div className="bg-white rounded-2xl border border-line shadow-sm p-6">
          <div className="h-4 w-40 rounded bg-canvas mb-4" />
          <div className="h-5 w-48 rounded bg-canvas mb-3" />
          <div className="flex gap-2 mb-3">
            <div className="h-5 w-24 rounded-full bg-canvas" />
            <div className="h-5 w-20 rounded-full bg-canvas" />
          </div>
          <div className="h-3 w-full rounded bg-canvas mb-1" />
          <div className="h-3 w-4/5 rounded bg-canvas mb-4" />
          <div className="h-8 w-32 rounded-xl bg-canvas" />
        </div>
      </div>
      {/* Radar + strip */}
      <div className="bg-white rounded-2xl border border-line shadow-sm p-6">
        <div className="h-4 w-24 rounded bg-canvas mb-4" />
        <div className="h-64 w-64 mx-auto rounded-full bg-canvas" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend line SVG — own reports over time, dots clickable → /app/reports/:id
// ---------------------------------------------------------------------------
function TrendLine({ trend, navigate }) {
  if (!trend || trend.length === 0) return null;
  if (trend.length === 1) {
    // Single point: just show a dot
    const pt = trend[0];
    return (
      <div className="mt-4">
        <svg viewBox="0 0 240 80" className="w-full" aria-label="Score trend">
          <line x1="8" y1="60" x2="232" y2="60" stroke="#e2e8f0" strokeWidth="1" />
          <circle
            cx="120"
            cy={8 + (1 - pt.percent / 100) * 44}
            r="4"
            fill={TOKEN_HEX.brand}
            className="cursor-pointer"
            onClick={() => pt.reportId && navigate(`/app/reports/${pt.reportId}`)}
          />
        </svg>
      </div>
    );
  }

  const W = 240;
  const H = 80;
  const PAD = { top: 8, right: 8, bottom: 20, left: 8 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xs = trend.map((_, i) =>
    PAD.left + (i / (trend.length - 1)) * innerW
  );
  const yOf = (pct) => PAD.top + innerH - ((pct ?? 0) / 100) * innerH;

  const polyline = trend.map((d, i) => `${xs[i]},${yOf(d.percent)}`).join(" ");

  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-label="Score trend">
        {/* gridlines */}
        {[50, 75].map((g) => (
          <line
            key={g}
            x1={PAD.left}
            y1={yOf(g)}
            x2={W - PAD.right}
            y2={yOf(g)}
            stroke="#e2e8f0"
            strokeDasharray="4 3"
            strokeWidth="1"
          />
        ))}
        {/* axis */}
        <line x1={PAD.left} y1={PAD.top + innerH} x2={W - PAD.right} y2={PAD.top + innerH} stroke="#e2e8f0" strokeWidth="1" />
        {/* line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={TOKEN_HEX.brand}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* dots — clickable */}
        {trend.map((d, i) => (
          <circle
            key={i}
            cx={xs[i]}
            cy={yOf(d.percent)}
            r="4"
            fill={TOKEN_HEX.brand}
            stroke="white"
            strokeWidth="1.5"
            className={d.reportId ? "cursor-pointer" : ""}
            onClick={() => d.reportId && navigate(`/app/reports/${d.reportId}`)}
          />
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill radar SVG — two polygons: mine vs team
// ---------------------------------------------------------------------------
function RadarChart({ criteria, mine, team }) {
  // Filter to axes where the counsellor has data; team is plotted on the same filtered axes.
  const filtered = criteria.filter((c) => mine[c.key] != null);
  const N = filtered.length;
  if (N < 3) {
    return (
      <EmptyState
        title="No radar data yet"
        hint="Complete mocks to see your skill radar."
      />
    );
  }

  // Use filtered criteria for all rendering below
  const CX = 140;
  const CY = 140;
  const R = 100; // max radius for score=5

  // abbreviate label: first word, max 8 chars
  const abbrev = (label) => {
    const w = label?.split(/[\s/]/)[0] ?? label;
    return w.length > 8 ? w.slice(0, 7) + "…" : w;
  };

  // angle for axis i (start from top, clockwise)
  const angle = (i) => (Math.PI * 2 * i) / N - Math.PI / 2;

  // point for a value (1-5 scale) on axis i
  const point = (i, val) => {
    const r = ((val ?? 0) / 5) * R;
    const a = angle(i);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };

  // polygon points string
  const poly = (scores) =>
    filtered.map((c, i) => {
      const p = point(i, scores[c.key] ?? 0);
      return `${p.x},${p.y}`;
    }).join(" ");

  // axis tip coordinates (label placement)
  const axisEnd = (i) => {
    const a = angle(i);
    const r = R + 22;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };

  // rings at 1-5
  const rings = [1, 2, 3, 4, 5];

  const W = 280;
  const H = 280;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto" style={{ maxWidth: 280 }} aria-label="Skill radar">
        {/* rings */}
        {rings.map((r) => {
          const ringR = (r / 5) * R;
          const pts = filtered.map((_, i) => {
            const a = angle(i);
            return `${CX + ringR * Math.cos(a)},${CY + ringR * Math.sin(a)}`;
          }).join(" ");
          return (
            <polygon
              key={r}
              points={pts}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={r === 5 ? "1.5" : "1"}
            />
          );
        })}

        {/* axis lines */}
        {filtered.map((_, i) => {
          const tip = point(i, 5);
          return (
            <line
              key={i}
              x1={CX}
              y1={CY}
              x2={tip.x}
              y2={tip.y}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
          );
        })}

        {/* team polygon (dashed, no fill) */}
        {filtered.some((c) => team[c.key] != null) && (
          <polygon
            points={poly(team)}
            fill="none"
            stroke={TOKEN_HEX.slate}
            strokeWidth="1.5"
            strokeDasharray="4 3"
            opacity="0.7"
          />
        )}

        {/* mine polygon (brand, filled 25%) */}
        <polygon
          points={poly(mine)}
          fill={TOKEN_HEX.brand}
          fillOpacity="0.18"
          stroke={TOKEN_HEX.brand}
          strokeWidth="2"
        />

        {/* axis labels */}
        {filtered.map((c, i) => {
          const end = axisEnd(i);
          return (
            <text
              key={c.key}
              x={end.x}
              y={end.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="9"
              fill="#475569"
              fontWeight="500"
            >
              {abbrev(c.label)}
            </text>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-3 flex items-center justify-center gap-5 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-5 rounded" style={{ backgroundColor: TOKEN_HEX.brand, opacity: 0.6 }} />
          You
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-5 border-t-2 border-dashed"
            style={{ borderColor: TOKEN_HEX.slate }}
          />
          Team avg
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analytics, setAnalytics] = useState(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      const an = await api.getCounsellorAnalytics(userId);
      setAnalytics(an ?? null);
    } catch (e) {
      setError(e.message || "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    // Defer so the effect body doesn't call setState synchronously.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (loading) return <Skeleton />;

  const firstName = (user?.name || "").trim().split(/\s+/)[0] || "there";

  const trend = analytics?.trend ?? [];
  const radar = analytics?.radar ?? { criteria: [], mine: {}, team: {} };
  const pendingMocks = analytics?.pendingMocks ?? 0;
  const completedMocks = analytics?.completedMocks ?? 0;
  const avgPercent = analytics?.avgPercent ?? null;
  const recommendedDrill = analytics?.recommendedDrill ?? null;

  // Last band from trend
  const lastEntry = trend.length > 0 ? trend[trend.length - 1] : null;
  const lastPercent = lastEntry?.percent ?? null;
  const lastBand =
    lastPercent == null
      ? null
      : lastPercent >= 75
      ? "Excellent"
      : lastPercent >= 50
      ? "Good"
      : "Needs work";

  // Recent 5 entries from trend (most recent last → reverse for display)
  const recentTrend = [...trend].reverse().slice(0, 5);

  function handleStartDrill() {
    if (!recommendedDrill) return;
    // #20: a missing/unresolvable persona would start a broken null-persona
    // session. Resolve (payload personaId → objection map → default) and surface
    // a clear error instead of navigating when nothing usable comes back.
    const personaId = drillPersonaId(recommendedDrill);
    if (!personaId) {
      setError("Couldn't start this drill — no practice persona is available for it.");
      return;
    }
    navigate("/app/session/new", {
      state: {
        mode: "practice",
        drill: true,
        personaId,
        scenario: {
          title: recommendedDrill.title,
          difficulty: "hard",
          situation: recommendedDrill.instruction,
          contextNotes:
            "Drill focus: " +
            recommendedDrill.focusCriterion +
            " / " +
            recommendedDrill.objectionCategory,
        },
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-ink">
          Welcome, {firstName}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Your performance at a glance — track progress and tackle recommended drills.
        </p>
      </div>

      {error && (
        <Card role="alert" className="flex items-start justify-between gap-4 border-danger/30 bg-danger-soft p-4">
          <p className="text-sm font-medium text-danger">{error}</p>
          <button
            type="button"
            onClick={load}
            className="shrink-0 text-sm font-medium text-danger underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </Card>
      )}

      {/* Hero row — 2 cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Your progress */}
        <Card className="p-6">
          <CardHeader
            title="Your progress"
            subtitle={
              completedMocks > 0
                ? `${completedMocks} mock${completedMocks !== 1 ? "s" : ""} completed`
                : "No mocks completed yet"
            }
          />

          {completedMocks === 0 ? (
            <EmptyState
              title="No scores yet — complete your first mock."
              hint="Complete your first mock to see your progress."
            />
          ) : (
            <>
              <div className="flex items-end gap-3 mt-2">
                <span
                  className="text-5xl font-extrabold tabular-nums"
                  style={{ color: TOKEN_HEX.brand }}
                >
                  {/* #24: a null avgPercent must render '—', not NaN%/0%. */}
                  {avgPercent == null || !Number.isFinite(avgPercent) ? (
                    "—"
                  ) : (
                    <CountUp value={Math.round(avgPercent)} format={(n) => `${n}%`} />
                  )}
                </span>
                {lastBand && (
                  <Badge color={bandColor(lastBand)} className="mb-1.5">
                    {lastBand}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">Avg score across all reports</p>
              <TrendLine trend={trend} navigate={navigate} />
              {trend.length > 0 && (
                <p className="mt-1 text-xs text-muted text-right">
                  Click a dot to view report
                </p>
              )}
            </>
          )}
        </Card>

        {/* Recommended drill */}
        <Card className="p-6">
          <CardHeader
            title="Recommended drill"
            subtitle={
              recommendedDrill
                ? "Based on your latest report"
                : "Unlock after your first mock"
            }
          />

          {recommendedDrill ? (
            <div className="mt-2 space-y-4">
              <p className="text-sm font-semibold text-ink">{recommendedDrill.title}</p>
              <div className="flex flex-wrap gap-2">
                <Badge color="brand">
                  {humanizeCriterion(recommendedDrill.focusCriterion)}
                </Badge>
                <Badge color="warn">
                  {humanizeObjection(recommendedDrill.objectionCategory)}
                </Badge>
              </div>
              <p className="text-sm text-muted leading-relaxed">
                {recommendedDrill.instruction}
              </p>
              <Button onClick={handleStartDrill}>
                Start this drill
              </Button>
            </div>
          ) : (
            <EmptyState
              title="Complete your first mock to unlock drills."
              hint="Drills are personalized coaching scenarios generated from your session reports."
            />
          )}
        </Card>
      </div>

      {/* Skill radar */}
      <Card className="p-6">
        <CardHeader
          title="Skill radar"
          subtitle="Your average criterion scores vs. team average (1–5 scale)"
        />
        <RadarChart
          criteria={radar.criteria ?? []}
          mine={radar.mine ?? {}}
          team={radar.team ?? {}}
        />
      </Card>

      {/* Pending strip */}
      {pendingMocks > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-ink">
              <span className="text-brand-600 font-bold">{pendingMocks}</span>{" "}
              {pendingMocks === 1 ? "mock" : "mocks"} waiting for you
            </p>
            <Button as={Link} to="/app/mocks" variant="secondary" size="sm">
              View mocks
            </Button>
          </div>
        </Card>
      )}

      {/* Recent reports */}
      <Card className="p-6">
        <CardHeader
          title="Recent reports"
          subtitle="Your last 5 sessions"
          action={
            trend.length > 0 ? (
              <Button as={Link} to="/app/reports" variant="ghost" size="sm">
                View all
              </Button>
            ) : null
          }
        />

        {recentTrend.length === 0 ? (
          <EmptyState
            title="No reports yet"
            hint="Finish a mock or practice session to see your scored reports here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {recentTrend.map((entry, idx) => {
              const band =
                entry.percent == null
                  ? null
                  : entry.percent >= 75
                  ? "Excellent"
                  : entry.percent >= 50
                  ? "Good"
                  : "Needs work";
              return (
                <li key={entry.reportId ?? idx}>
                  <Link
                    to={`/app/reports/${entry.reportId}`}
                    className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-canvas"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        Session report
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {entry.generatedAt ? relativeDate(entry.generatedAt) : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-bold tabular-nums text-ink">
                        {entry.percent != null ? `${entry.percent}%` : "—"}
                      </span>
                      {band && <Badge color={bandColor(band)}>{band}</Badge>}
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
