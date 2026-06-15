// Leaderboard page — rendered at both /admin/leaderboard and /app/leaderboard.
// Role is derived from useAuth(); visibility is enforced server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth.jsx";
import { scoreColor, initials } from "../../lib/format";
import Card, { CardHeader } from "../../ui/Card";
import Badge from "../../ui/Badge";
import SearchInput from "../../ui/SearchInput";
import EmptyState from "../../ui/EmptyState";
import Spinner from "../../ui/Spinner";

// ── Medal helpers ────────────────────────────────────────────────────────────
const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };
const MEDAL_BG = {
  1: "bg-amber-50 border-amber-200",
  2: "bg-slate-50 border-slate-200",
  3: "bg-orange-50 border-orange-200",
};

function rankBadge(rank) {
  if (rank <= 3) {
    return (
      <span className="text-base leading-none" title={`Rank ${rank}`}>
        {MEDAL[rank]}
      </span>
    );
  }
  return <span className="tabular-nums text-sm text-muted font-medium">{rank}</span>;
}

// ── Value formatter ──────────────────────────────────────────────────────────
function fmtValue(value, metric) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (metric === "percent") return `${Math.round(value)}%`;
  // satisfaction: 0-100 score, show one decimal
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

// Color token for value display
function valueColor(value, metric) {
  if (value == null || !Number.isFinite(value)) return "text-muted";
  if (metric === "percent") return `text-${scoreColor(value)}`;
  return `text-${scoreColor(value)}`;
}

// ── Inline avatar ────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626",
  "#7c3aed", "#db2777", "#2563eb", "#65a30d", "#ea580c",
];
function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name, size = 32 }) {
  const bg = avatarColor(name);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-white font-semibold select-none"
      style={{ width: size, height: size, fontSize: size * 0.38, background: bg }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

// ── Segment toggle ──────────────────────────────────────────────────────────
function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex gap-1 rounded-2xl border border-line bg-white p-1 shadow-sm">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            value === opt.value
              ? "bg-brand-600 text-white shadow-sm"
              : "text-muted hover:bg-canvas hover:text-ink"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Single ranked table ──────────────────────────────────────────────────────
function RankedTable({ rows, metric, viewerId, searchable, title, subtitle }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.name?.toLowerCase().includes(q) ||
        r.code?.toLowerCase().includes(q)
    );
  }, [rows, searchable, query]);

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No scored sessions yet"
        hint="Leaderboard data appears once graded reports are available."
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <path d="M3 3v18h18M7 14l3-3 3 3 5-5" />
          </svg>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {(title || searchable) && (
        <div className="flex items-center justify-between gap-4">
          {title && (
            <div>
              <h4 className="text-sm font-semibold text-ink">{title}</h4>
              {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
            </div>
          )}
          {searchable && (
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search counsellors…"
              className="w-56"
            />
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium uppercase tracking-wide text-muted px-4 py-3 w-12">
                Rank
              </th>
              <th className="text-left text-xs font-medium uppercase tracking-wide text-muted px-4 py-3">
                Counsellor
              </th>
              <th className="text-right text-xs font-medium uppercase tracking-wide text-muted px-4 py-3">
                {metric === "percent" ? "Report %" : "Satisfaction"}
              </th>
              <th className="text-right text-xs font-medium uppercase tracking-wide text-muted px-4 py-3 w-24">
                Sessions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => {
              const isViewer = row.counsellorId === viewerId;
              const rowKey = row.counsellorId ?? i;
              const topStyle = MEDAL_BG[row.rank] || "";
              return (
                <tr
                  key={rowKey}
                  className={`border-t border-line ${
                    isViewer
                      ? "bg-brand-50 border-brand-100"
                      : row.rank <= 3
                      ? topStyle
                      : ""
                  }`}
                >
                  {/* Rank */}
                  <td className="px-4 py-3 text-sm align-middle">{rankBadge(row.rank)}</td>

                  {/* Counsellor */}
                  <td className="px-4 py-3 text-sm align-middle">
                    <div className="flex items-center gap-3">
                      <Avatar name={row.name} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${isViewer ? "text-brand-700" : "text-ink"}`}>
                            {row.name || "—"}
                          </span>
                          {isViewer && (
                            <span className="text-xs text-brand-600 font-medium">(you)</span>
                          )}
                        </div>
                        {row.code && (
                          <span className="text-xs font-mono text-muted">{row.code}</span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Value */}
                  <td className="px-4 py-3 text-sm align-middle text-right">
                    <span className={`tabular-nums font-semibold ${valueColor(row.value, metric)}`}>
                      {fmtValue(row.value, metric)}
                    </span>
                  </td>

                  {/* Sessions */}
                  <td className="px-4 py-3 text-sm align-middle text-right">
                    <span className="tabular-nums text-muted">{row.sessions ?? "—"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Persona category labels ──────────────────────────────────────────────────
const PERSONA_CATEGORY_LABELS = {
  "studying": "Studying",
  "same-field": "Working — same field",
  "diff-field": "Working — different field",
  "non-working": "Not working",
  "other": "Other",
};

const PERSONA_CATEGORY_ORDER = ["studying", "same-field", "diff-field", "non-working", "other"];

// ── By-persona board ─────────────────────────────────────────────────────────
function ByPersonaBoard({ categories, metric, viewerId, isAdmin }) {
  if (!categories || Object.keys(categories).length === 0) {
    return (
      <EmptyState
        title="No scored sessions yet"
        hint="Leaderboard data appears once graded reports are available."
      />
    );
  }

  const catKeys = PERSONA_CATEGORY_ORDER.filter((k) => k in categories);
  // Add any unexpected keys at the end
  Object.keys(categories).forEach((k) => {
    if (!catKeys.includes(k)) catKeys.push(k);
  });

  return (
    <div className="space-y-6">
      {catKeys.map((key) => {
        const cat = categories[key];
        if (!cat) return null;
        const rows = cat.rows ?? [];
        const label = PERSONA_CATEGORY_LABELS[key] || key;
        return (
          <Card key={key} className="p-4">
            <CardHeader
              title={label}
              subtitle={
                cat.truncated
                  ? "Showing top 10 — full list visible to admins"
                  : `${rows.length} counsellor${rows.length !== 1 ? "s" : ""}`
              }
            />
            {cat.viewerRank && !rows.some((r) => r.counsellorId === viewerId) && (
              <div className="mb-3 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
                Your rank in this category: <strong>#{cat.viewerRank}</strong>
              </div>
            )}
            <RankedTable
              rows={rows}
              metric={metric}
              viewerId={viewerId}
              searchable={isAdmin && rows.length > 8}
            />
          </Card>
        );
      })}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
const METRIC_OPTIONS = [
  { value: "percent", label: "Report %" },
  { value: "satisfaction", label: "Satisfaction Score" },
];

const BOARD_OPTIONS = [
  { value: "average", label: "Average" },
  { value: "high", label: "High Score" },
  { value: "byPersona", label: "By Persona" },
];

export default function Leaderboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const viewerId = user?.id;

  const [metric, setMetric] = useState("percent");
  const [board, setBoard] = useState("average");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getLeaderboard({ metric, board });
      setData(result);
    } catch (e) {
      setError(e.message || "Failed to load leaderboard.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [metric, board]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // For flat boards (average/high): rows + optional viewerRank
  const rows = data?.rows ?? [];
  const viewerRank = data?.viewerRank;
  const truncated = data?.truncated;
  // Viewer's own row may be appended outside top 10
  const viewerRowAppended =
    truncated &&
    viewerRank != null &&
    rows.some((r) => r.counsellorId === viewerId && r.rank === viewerRank);

  const metricLabel = METRIC_OPTIONS.find((o) => o.value === metric)?.label ?? metric;
  const boardLabel = BOARD_OPTIONS.find((o) => o.value === board)?.label ?? board;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Leaderboard</h2>
        <p className="mt-1 text-sm text-muted">
          See how counsellors rank across key performance metrics.
        </p>
      </header>

      {/* Controls */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted px-1">Metric</p>
          <SegmentedControl
            options={METRIC_OPTIONS}
            value={metric}
            onChange={(v) => { setMetric(v); setData(null); }}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted px-1">View</p>
          <SegmentedControl
            options={BOARD_OPTIONS}
            value={board}
            onChange={(v) => { setBoard(v); setData(null); }}
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <Spinner size={28} />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <Card className="p-5">
          <div className="rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        </Card>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {/* byPersona board */}
          {board === "byPersona" && (
            <ByPersonaBoard
              categories={data.categories ?? {}}
              metric={metric}
              viewerId={viewerId}
              isAdmin={isAdmin}
            />
          )}

          {/* average / high boards */}
          {board !== "byPersona" && (
            <Card className="p-4">
              <CardHeader
                title={`${metricLabel} — ${boardLabel}`}
                subtitle={
                  truncated
                    ? "Showing top 10. Full list visible to admins."
                    : `${rows.length} counsellor${rows.length !== 1 ? "s" : ""}`
                }
                action={
                  isAdmin && rows.length > 8 ? undefined : null
                }
              />

              {/* Counsellor: viewer rank callout when outside top 10 */}
              {!isAdmin && truncated && viewerRank && !viewerRowAppended && (
                <div className="mb-4 rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
                  You are ranked <strong>#{viewerRank}</strong> on this board.
                </div>
              )}

              {/* Top-10 note for counsellors */}
              {!isAdmin && truncated && (
                <div className="mb-3">
                  <Badge color="slate">Showing top 10</Badge>
                </div>
              )}

              <RankedTable
                rows={rows}
                metric={metric}
                viewerId={viewerId}
                searchable={isAdmin && rows.length > 8}
              />
            </Card>
          )}
        </>
      )}

      {/* No data (loaded but empty) */}
      {!loading && !error && data && board !== "byPersona" && rows.length === 0 && (
        <Card className="p-8">
          <EmptyState
            title="No scored sessions yet"
            hint="Leaderboard data appears once counsellors complete graded sessions."
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M3 3v18h18M7 14l3-3 3 3 5-5" />
              </svg>
            }
          />
        </Card>
      )}
    </div>
  );
}
