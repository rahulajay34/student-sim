import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { bandColor, relativeDate } from "../../lib/format";
import Card from "../../ui/Card";
import Table from "../../ui/Table";
import Select from "../../ui/Select";
import Badge from "../../ui/Badge";
import Avatar from "../../ui/Avatar";
import EmptyState from "../../ui/EmptyState";
import SearchInput from "../../ui/SearchInput";

export default function AdminReports() {
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [counsellors, setCounsellors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [counsellorId, setCounsellorId] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rs, cs] = await Promise.all([api.getReports(), api.getCounsellors()]);
      setReports(Array.isArray(rs) ? rs : []);
      setCounsellors(Array.isArray(cs) ? cs : []);
    } catch (e) {
      setError(e.message || "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const colorByCounsellor = useMemo(() => {
    const map = {};
    counsellors.forEach((c) => {
      map[c.id] = c.avatarColor;
    });
    return map;
  }, [counsellors]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (counsellorId && r.counsellorId !== counsellorId) return false;
      if (!q) return true;
      return [r.counsellorName, r.personaName, r.scenarioTitle, r.overall?.band, r.overall?.outcome]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [reports, counsellorId, query]);

  const filterOptions = useMemo(
    () => [
      { value: "", label: "All counsellors" },
      ...counsellors.map((c) => ({ value: c.id, label: c.name })),
    ],
    [counsellors]
  );

  const columns = [
    {
      key: "counsellor",
      header: "Counsellor",
      sortable: true,
      sortValue: (r) => r.counsellorName || "",
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar name={r.counsellorName} color={colorByCounsellor[r.counsellorId]} size="sm" />
          <span className="font-medium text-ink">{r.counsellorName}</span>
        </div>
      ),
    },
    {
      key: "persona",
      header: "Persona",
      sortable: true,
      sortValue: (r) => r.personaName || "",
      render: (r) => <span className="text-muted">{r.personaName}</span>,
    },
    {
      key: "scenario",
      header: "Scenario",
      sortable: true,
      sortValue: (r) => r.scenarioTitle || "",
      render: (r) => <span className="text-muted">{r.scenarioTitle}</span>,
    },
    {
      key: "score",
      header: "Score",
      sortable: true,
      sortValue: (r) => r.overall?.percent ?? -1,
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="tabular-nums font-semibold text-ink">
            {r.overall?.percent != null ? `${r.overall.percent}%` : "—"}
          </span>
          {r.overall?.band ? (
            <Badge color={bandColor(r.overall.band)}>{r.overall.band}</Badge>
          ) : (
            <Badge color="slate">generating</Badge>
          )}
        </div>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      sortable: true,
      sortValue: (r) => r.overall?.outcome || "",
      render: (r) => (
        <Badge color={r.overall?.outcome === "Converted" ? "success" : "slate"}>
          {r.overall?.outcome}
        </Badge>
      ),
    },
    {
      key: "date",
      header: "Date",
      className: "whitespace-nowrap text-muted",
      sortable: true,
      sortValue: (r) => r.generatedAt || "",
      render: (r) => relativeDate(r.generatedAt),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-ink">Reports</h2>
          <p className="mt-1 text-sm text-muted">
            Session rubric reports across all counsellors.
          </p>
        </div>
        <div className="w-full sm:w-60">
          <Select
            options={filterOptions}
            value={counsellorId}
            onChange={(e) => setCounsellorId(e.target.value)}
            aria-label="Filter by counsellor"
          />
        </div>
      </div>

      <Card className="p-2">
        {loading ? (
          <div className="divide-y divide-line">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-3.5">
                <div className="h-8 w-8 rounded-full bg-line" />
                <div className="h-4 w-24 rounded-md bg-line" />
                <div className="h-4 w-20 rounded-md bg-line" />
                <div className="h-4 flex-1 rounded-md bg-line" />
                <div className="h-4 w-12 rounded-md bg-line" />
                <div className="h-5 w-16 rounded-full bg-line" />
                <div className="h-4 w-20 rounded-md bg-line" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-4 py-12">
            <EmptyState
              title="Couldn’t load reports"
              hint={error}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              }
              action={
                <button
                  type="button"
                  onClick={load}
                  className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                >
                  Try again
                </button>
              }
            />
          </div>
        ) : reports.length === 0 ? (
          <div className="px-4 py-12">
            <EmptyState
              title="No reports yet"
              hint="Reports appear here once counsellors complete their mock sessions."
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                  <path d="M9 17v-6m3 6V7m3 10v-3M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
                </svg>
              }
            />
          </div>
        ) : filtered.length === 0 ? (
          <>
            {(reports.length > 8 || query) && (
              <div className="px-4 pt-3">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search reports…"
                  className="max-w-sm"
                />
              </div>
            )}
            <div className="px-4 py-12">
              <EmptyState
                title={counsellorId || query ? "No matching reports" : "No reports yet"}
                hint={
                  counsellorId || query
                    ? "Try clearing the filter or search term."
                    : "Reports appear here once counsellors complete their mock sessions."
                }
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                    <path d="M9 17v-6m3 6V7m3 10v-3M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
                  </svg>
                }
              />
            </div>
          </>
        ) : (
          <Table
            columns={columns}
            rows={filtered}
            onRowClick={(r) => navigate(`/admin/reports/${r.id}`)}
            toolbar={
              reports.length > 8 || query ? (
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search reports…"
                  className="max-w-sm"
                />
              ) : null
            }
          />
        )}
      </Card>
    </div>
  );
}
