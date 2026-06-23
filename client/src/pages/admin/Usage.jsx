import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { fmtINR, fmtTokens, formatDate } from "../../lib/format";
import Card, { CardHeader } from "../../ui/Card";
import StatCard from "../../ui/StatCard";
import Select from "../../ui/Select";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";

// yyyy-mm-dd helpers (native <input type="date"> value format).
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}
// The end date is inclusive in the UI but the API bound is exclusive, so send the
// day AFTER the selected end date.
function nextDay(yyyyMmDd) {
  if (!yyyyMmDd) return undefined;
  const d = new Date(yyyyMmDd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return isoDay(d);
}

const FEATURE_LABELS = {
  report: "Report grading",
  student_reply: "Student replies",
  scoring: "Turn scoring",
  cue: "Coach cues",
  voice: "Voice (realtime)",
  transcription: "Transcription",
  other: "Other",
};

// Horizontal cost-breakdown bar list (by model / feature / provider).
function BarList({ items = [], rate, labelMap }) {
  const max = Math.max(1, ...items.map((i) => Number(i.usd) || 0));
  if (!items.length) return <div className="py-6 text-center text-sm text-muted">No data</div>;
  return (
    <div className="space-y-2.5">
      {items.map((it) => {
        const usd = Number(it.usd) || 0;
        const pct = Math.max(2, Math.round((usd / max) * 100));
        return (
          <div key={it.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-ink">{(labelMap && labelMap[it.key]) || it.key}</span>
              <span className="shrink-0 font-medium text-ink">{fmtINR(usd, rate)}<span className="ml-1 font-normal text-muted/70">· {it.calls}</span></span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Spend-over-time vertical bars.
function TrendBars({ items = [], rate }) {
  if (!items.length) return <div className="py-6 text-center text-sm text-muted">No data in range</div>;
  const max = Math.max(1, ...items.map((i) => Number(i.usd) || 0));
  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto pb-1">
      {items.map((it) => {
        const usd = Number(it.usd) || 0;
        const h = Math.max(2, Math.round((usd / max) * 100));
        return (
          <div key={it.key} className="group flex min-w-[14px] flex-1 flex-col items-center justify-end" title={`${it.key}: ${fmtINR(usd, rate)} · ${it.calls} calls`}>
            <div className="w-full rounded-t bg-brand-600/80 transition-colors group-hover:bg-brand-600" style={{ height: `${h}%` }} />
            <span className="mt-1 hidden text-[10px] text-muted/70 sm:block">{it.key.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

function SessionRow({ row, rate }) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && calls === null && row.sessionId) {
      setLoading(true);
      try {
        const res = await api.getUsageSession(row.sessionId);
        setCalls(res.calls || []);
      } catch {
        setCalls([]);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <>
      <tr className="border-t border-line hover:bg-canvas/60">
        <td className="px-3 py-2.5 text-sm text-muted whitespace-nowrap">{formatDate(row.lastAt)}</td>
        <td className="px-3 py-2.5 text-sm text-ink">{row.counsellorName}</td>
        <td className="px-3 py-2.5 text-sm text-muted">{row.personaLabel || "—"}</td>
        <td className="px-3 py-2.5 text-right text-sm tabular-nums text-ink">{row.calls}</td>
        <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted">{fmtTokens(row.tokens)}</td>
        <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-ink">{fmtINR(row.usd, rate)}</td>
        <td className="px-3 py-2.5 text-right">
          <button onClick={toggle} className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-ink hover:bg-canvas" disabled={!row.sessionId}>
            {open ? "Hide" : "Details"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-canvas/40">
          <td colSpan={7} className="px-3 py-3">
            {loading ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : !calls || calls.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted">No per-call records.</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted/70">
                    <th className="px-2 py-1 font-medium">Time</th>
                    <th className="px-2 py-1 font-medium">Feature</th>
                    <th className="px-2 py-1 font-medium">Model</th>
                    <th className="px-2 py-1 text-right font-medium">In/Out tok</th>
                    <th className="px-2 py-1 text-right font-medium">Audio tok</th>
                    <th className="px-2 py-1 text-right font-medium" title="Cached prompt tokens (read + write). Billed at the cheap cached rate; counted in the session token total.">Cache tok</th>
                    <th className="px-2 py-1 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((cl) => (
                    <tr key={cl.id} className="border-t border-line/60">
                      <td className="px-2 py-1.5 text-xs text-muted whitespace-nowrap">{formatDate(cl.createdAt)}</td>
                      <td className="px-2 py-1.5 text-xs text-ink">{FEATURE_LABELS[cl.feature] || cl.feature || "—"}</td>
                      <td className="px-2 py-1.5 text-xs text-muted">{cl.model}</td>
                      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted">{fmtTokens(cl.inputTokens)}/{fmtTokens(cl.outputTokens)}</td>
                      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted">{fmtTokens((cl.audioInputTokens || 0) + (cl.audioOutputTokens || 0))}</td>
                      <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted">{fmtTokens((cl.cacheReadTokens || 0) + (cl.cacheWriteTokens || 0))}</td>
                      <td className="px-2 py-1.5 text-right text-xs font-medium tabular-nums text-ink">{fmtINR(cl.usd, rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const PAGE_SIZE = 25;

export default function Usage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(isoDay(new Date()));
  const [model, setModel] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.getUsage({ from: from || undefined, to: nextDay(to), model: model || undefined, page, pageSize: PAGE_SIZE })
      .then((res) => { if (active) setData(res); })
      .catch((e) => { if (active) setError(e.message || "Failed to load usage"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, model, page]);

  // Reset to page 1 when filters change.
  useEffect(() => { setPage(1); }, [from, to, model]);

  const rate = data?.fxRate || 86.5;
  const ov = data?.overview || {};
  const sessions = data?.sessions || { rows: [], total: 0 };
  const totalPages = Math.max(1, Math.ceil((sessions.total || 0) / PAGE_SIZE));
  const avgPerSession = ov.totalSessions ? (Number(ov.totalUsd) || 0) / ov.totalSessions : 0;

  const modelOptions = useMemo(
    () => [{ value: "", label: "All models" }, ...((data?.models || []).map((m) => ({ value: m, label: m })))],
    [data?.models],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Usage</h1>
          <p className="mt-0.5 text-sm text-muted">
            API spend across Claude (analytics) and OpenAI (voice). Prices in INR.
            {data?.fxRate != null && (
              <span className="text-muted/70"> · USD→INR {Number(rate).toFixed(2)} ({data.fxSource || "live"})</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">From</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">To</span>
            <input type="date" value={to} min={from} max={isoDay(new Date())} onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
          </label>
          <div className="w-44">
            <Select options={modelOptions} value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
        </div>
      </div>

      {error && (
        <Card className="border-danger/40 p-4 text-sm text-danger">{error}</Card>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total spend" value={fmtINR(ov.totalUsd, rate)} hint={`${ov.totalCalls || 0} API calls`} />
            <StatCard label="Sessions" value={(ov.totalSessions || 0).toLocaleString()} hint={`${fmtINR(avgPerSession, rate)} avg / session`} />
            <StatCard label="Text tokens" value={fmtTokens((ov.totalInputTokens || 0) + (ov.totalOutputTokens || 0))} hint={`${fmtTokens(ov.totalInputTokens)} in · ${fmtTokens(ov.totalOutputTokens)} out`} />
            <StatCard label="Audio tokens" value={fmtTokens(ov.totalAudioTokens)} hint="Voice in + out" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-3">
              <CardHeader title="Spend over time" subtitle="Daily API cost across the selected range" />
              <TrendBars items={ov.byDay || []} rate={rate} />
            </Card>
            <Card className="p-5">
              <CardHeader title="By model" />
              <BarList items={ov.byModel || []} rate={rate} />
            </Card>
            <Card className="p-5">
              <CardHeader title="By feature" />
              <BarList items={ov.byFeature || []} rate={rate} labelMap={FEATURE_LABELS} />
            </Card>
            <Card className="p-5">
              <CardHeader title="By provider" />
              <BarList items={ov.byProvider || []} rate={rate} />
            </Card>
          </div>

          {/* Per-session table */}
          <Card className="p-0">
            <div className="p-5 pb-3">
              <CardHeader title="Sessions" subtitle="Cost per counselling session, most recent first" />
            </div>
            {sessions.rows.length === 0 ? (
              <div className="p-6"><EmptyState title="No usage yet" hint="API usage will appear here once sessions run." /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted/70">
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">Counsellor</th>
                      <th className="px-3 py-2 font-medium">Persona</th>
                      <th className="px-3 py-2 text-right font-medium">Calls</th>
                      <th className="px-3 py-2 text-right font-medium">Tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.rows.map((row) => (
                      <SessionRow key={row.sessionId || row.lastAt} row={row} rate={rate} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Pagination */}
            {sessions.total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
                <span className="text-muted">
                  Page {page} of {totalPages} · {sessions.total} sessions
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                    className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-ink hover:bg-canvas disabled:opacity-40">Prev</button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-ink hover:bg-canvas disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
