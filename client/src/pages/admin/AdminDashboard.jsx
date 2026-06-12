import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card, { CardHeader } from "../../ui/Card";
import StatCard from "../../ui/StatCard";
import CountUp from "../../ui/CountUp";
import Button from "../../ui/Button";
import Badge from "../../ui/Badge";
import EmptyState from "../../ui/EmptyState";
import Table from "../../ui/Table";
import { api } from "../../lib/api";
import { bandColor, rubricColor, TOKEN_HEX, relativeDate } from "../../lib/format";

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------
function Icon({ d, className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}
const ICON = {
  mocks: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  score: "M3 3v18h18M7 14l3-3 3 3 5-5",
  rate: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
};

// ---------------------------------------------------------------------------
// Outcome color helper (maps outcome string to badge color)
// ---------------------------------------------------------------------------
function outcomeColor(outcome) {
  if (!outcome) return "slate";
  const o = outcome.toLowerCase();
  if (o.includes("enrolled") || o.includes("committed")) return "success";
  if (o.includes("maybe") || o.includes("follow")) return "warn";
  return "danger";
}

// ---------------------------------------------------------------------------
// Format a week-start ISO date as "dd MMM"
// ---------------------------------------------------------------------------
function fmtWeekLabel(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------
function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-line shadow-sm p-5">
            <div className="flex items-center gap-4">
              <div className="h-11 w-11 rounded-xl bg-canvas" />
              <div className="space-y-2 flex-1">
                <div className="h-7 w-16 rounded bg-canvas" />
                <div className="h-3 w-24 rounded bg-canvas" />
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Heatmap card */}
      <div className="bg-white rounded-2xl border border-line shadow-sm p-6">
        <div className="h-4 w-40 rounded bg-canvas mb-6" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="h-8 w-28 rounded bg-canvas" />
              {[0, 1, 2, 3, 4, 5].map((j) => (
                <div key={j} className="h-8 flex-1 rounded bg-canvas" />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* Two-col */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-2xl border border-line shadow-sm p-6">
          <div className="h-4 w-28 rounded bg-canvas mb-4" />
          <div className="h-40 rounded bg-canvas" />
        </div>
        <div className="bg-white rounded-2xl border border-line shadow-sm p-6">
          <div className="h-4 w-36 rounded bg-canvas mb-4" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-canvas" />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score trend SVG line chart
// ---------------------------------------------------------------------------
function TrendChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No trend data yet"
        hint="Trend appears once counsellors complete mocks."
      />
    );
  }

  const W = 480;
  const H = 160;
  const PAD = { top: 16, right: 16, bottom: 36, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // X positions are TIME-proportional (weekStart dates), not index-proportional:
  // gap weeks are skipped in the data, so equal index spacing made a 9-week span
  // look like 3 consecutive weeks and lied about the slope.
  const times = data.map((d) => new Date(d.weekStart).getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const span = tMax - tMin;
  const xs = times.map((t) =>
    PAD.left + (span === 0 ? innerW / 2 : ((t - tMin) / span) * innerW),
  );
  const yOf = (pct) => PAD.top + innerH - (pct / 100) * innerH;

  const polyline = data.map((d, i) => `${xs[i]},${yOf(d.avgPercent)}`).join(" ");

  // gridlines at 50 and 75
  const grids = [
    { y: yOf(50), label: "50" },
    { y: yOf(75), label: "75" },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-label="Score trend chart">
      {/* dashed gridlines */}
      {grids.map(({ y, label }) => (
        <g key={label}>
          <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e2e8f0" strokeDasharray="4 3" strokeWidth="1" />
          <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">{label}</text>
        </g>
      ))}
      {/* bottom axis */}
      <line x1={PAD.left} y1={PAD.top + innerH} x2={W - PAD.right} y2={PAD.top + innerH} stroke="#e2e8f0" strokeWidth="1" />

      {/* polyline */}
      <polyline
        points={polyline}
        fill="none"
        stroke={TOKEN_HEX.brand}
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* dots */}
      {data.map((d, i) => (
        <circle key={i} cx={xs[i]} cy={yOf(d.avgPercent)} r="3.5" fill={TOKEN_HEX.brand} />
      ))}

      {/* x-axis labels */}
      {data.map((d, i) => (
        <text
          key={i}
          x={xs[i]}
          y={H - 4}
          textAnchor="middle"
          fontSize="9"
          fill="#94a3b8"
        >
          {fmtWeekLabel(d.weekStart)}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Objection hot-spots
// ---------------------------------------------------------------------------
function HotSpots({ data }) {
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="No objection data yet"
        hint="Hot-spots appear once reports include drill data."
      />
    );
  }
  const max = Math.max(...data.map((d) => d.drillCount), 1);
  return (
    <ul className="space-y-2">
      {data.map((item) => (
        <li key={item.category} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-sm text-ink" title={item.label}>{item.label}</span>
          <div className="flex-1 h-2 rounded-full bg-canvas overflow-hidden">
            <div
              className="h-2 rounded-full"
              style={{ width: `${Math.round((item.drillCount / max) * 100)}%`, backgroundColor: TOKEN_HEX.brand }}
            />
          </div>
          <Badge color="slate">{item.drillCount}</Badge>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Team rubric heatmap
// ---------------------------------------------------------------------------
function HeatmapTable({ criteria, rows }) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No heatmap data yet"
        hint="Heatmap populates once team reports are generated."
      />
    );
  }
  // abbreviate criterion label to first word
  const abbrev = (label) => label?.split(/[\s/]/)[0] ?? label;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="py-2 pl-1 pr-3 text-left text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap">
              Counsellor
            </th>
            {criteria.map((c) => (
              <th key={c.key} className="py-2 px-2 text-center text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap" title={c.label}>
                {abbrev(c.label)}
              </th>
            ))}
            <th className="py-2 px-2 text-center text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap">
              Reports
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.counsellorId} className="border-t border-line">
              <td className="py-2 pl-1 pr-3 font-medium text-ink whitespace-nowrap">{row.counsellorName}</td>
              {criteria.map((c) => {
                const val = row.cells?.[c.key];
                const color = val != null ? TOKEN_HEX[rubricColor(val)] + "1A" : undefined;
                return (
                  <td
                    key={c.key}
                    className="py-2 px-2 text-center tabular-nums"
                    style={color ? { backgroundColor: color } : undefined}
                  >
                    {val != null ? (
                      <span className="text-ink">{Number(val).toFixed(1)}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                );
              })}
              <td className="py-2 px-2 text-center text-muted tabular-nums">{row.reportCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const d = await api.getAdminAnalytics();
        if (alive) setData(d);
      } catch (e) {
        if (alive) setError(e.message || "Failed to load dashboard.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <Skeleton />;

  const kpis = data?.kpis ?? {};
  const heatmap = data?.teamHeatmap ?? { criteria: [], rows: [] };
  const weeklyTrend = data?.weeklyTrend ?? [];
  const objections = data?.objectionPerformance ?? [];
  const counsellors = data?.counsellors ?? [];
  const recentReports = data?.recentReports ?? [];

  // Counsellors table columns
  const counsellorColumns = [
    {
      key: "name",
      header: "Counsellor",
      sortable: true,
      sortValue: (row) => row.name || "",
      render: (row) => <span className="font-medium text-ink">{row.name}</span>,
    },
    {
      key: "mocks",
      header: "Mocks",
      sortable: true,
      sortValue: (row) => row.mocks ?? -1,
      render: (row) => <span className="tabular-nums">{row.mocks}</span>,
    },
    {
      key: "avgPercent",
      header: "Avg %",
      sortable: true,
      sortValue: (row) => row.avgPercent ?? -1,
      render: (row) =>
        row.avgPercent != null ? (
          <span className="tabular-nums font-semibold">{Math.round(row.avgPercent)}%</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "lastFiveDelta",
      header: "Last-5 trend",
      sortable: true,
      sortValue: (row) => row.lastFiveDelta ?? 0,
      render: (row) => {
        const d = row.lastFiveDelta;
        if (d == null || Math.abs(d) < 0.05) return <span className="text-muted">—</span>;
        const positive = d >= 0;
        return (
          <span className={`font-semibold ${positive ? "text-success" : "text-danger"}`}>
            {positive ? "↑" : "↓"} {Math.abs(d).toFixed(1)}pp
          </span>
        );
      },
    },
    {
      key: "weakestCriterion",
      header: "Weakest",
      render: (row) =>
        row.weakestCriterion ? (
          <Badge color="danger">{row.weakestCriterion.label}</Badge>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  const trendDelta = kpis.trendDelta;
  const trendLabel =
    trendDelta == null || Math.abs(trendDelta) < 0.05
      ? null
      : trendDelta >= 0
      ? `↑ ${Math.abs(trendDelta).toFixed(1)}pp vs prev window`
      : `↓ ${Math.abs(trendDelta).toFixed(1)}pp vs prev window`;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-ink">Overview</h2>
          <p className="mt-0.5 text-sm text-muted">
            Team performance, trends, and coaching insights at a glance.
          </p>
        </div>
        <Button as={Link} to="/admin/assignments/new">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New assignment
        </Button>
      </div>

      {error && (
        <Card role="alert" className="border-danger/30 bg-danger-soft p-4">
          <p className="text-sm font-medium text-danger">{error}</p>
        </Card>
      )}

      {/* KPI stat row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Mocks completed"
          value={<CountUp value={kpis.mocksCompleted ?? 0} />}
          icon={<Icon d={ICON.mocks} />}
        />
        <StatCard
          label="Avg score"
          value={
            kpis.avgScore != null ? (
              <CountUp value={Math.round(kpis.avgScore)} format={(n) => `${n}%`} />
            ) : (
              "—"
            )
          }
          hint={trendLabel}
          icon={<Icon d={ICON.score} />}
        />
        <StatCard
          label="Completion rate"
          value={
            kpis.completionRatePct != null ? (
              <CountUp value={Math.round(kpis.completionRatePct)} format={(n) => `${n}%`} />
            ) : (
              "—"
            )
          }
          hint="Assignments completed"
          icon={<Icon d={ICON.rate} />}
        />
      </div>

      {/* Team rubric heatmap */}
      <Card className="p-6">
        <CardHeader
          title="Team rubric heatmap"
          subtitle="Average criterion scores per counsellor (1–5 scale)"
        />
        <HeatmapTable criteria={heatmap.criteria} rows={heatmap.rows} />
      </Card>

      {/* Score trend + Objection hot-spots */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <CardHeader
            title="Score trend"
            subtitle="Weekly average score across the team"
          />
          <TrendChart data={weeklyTrend} />
        </Card>

        <Card className="p-6">
          <CardHeader
            title="Objection hot-spots"
            subtitle="Most-drilled objection categories"
          />
          <HotSpots data={objections} />
        </Card>
      </div>

      {/* Counsellors table */}
      <Card className="p-6">
        <CardHeader
          title="Counsellors"
          subtitle="Performance summary per team member"
          action={
            <Button as={Link} to="/admin/counsellors" variant="ghost" size="sm">
              Manage
            </Button>
          }
        />
        {counsellors.length === 0 ? (
          <EmptyState
            title="No data yet"
            hint="Not enough data yet — completed mocks will appear here."
          />
        ) : (
          <Table columns={counsellorColumns} rows={counsellors} />
        )}
      </Card>

      {/* Recent reports */}
      <Card className="p-6">
        <CardHeader
          title="Recent reports"
          subtitle="Latest completed mock sessions"
          action={
            <Button as={Link} to="/admin/reports" variant="ghost" size="sm">
              View all
            </Button>
          }
        />
        {recentReports.length === 0 ? (
          <EmptyState
            title="No reports yet"
            hint="Not enough data yet — completed mocks will appear here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {recentReports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/admin/reports/${r.id}`)}
                  className="group -mx-2 flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-canvas"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{r.counsellorName}</p>
                    <p className="truncate text-xs text-muted">
                      {r.personaName} · {relativeDate(r.generatedAt)}
                    </p>
                  </div>
                  <span className="tabular-nums text-sm font-semibold text-ink">
                    {r.percent != null ? `${r.percent}%` : "—"}
                  </span>
                  {r.band && <Badge color={bandColor(r.band)}>{r.band}</Badge>}
                  {r.outcome && <Badge color={outcomeColor(r.outcome)}>{r.outcome}</Badge>}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
