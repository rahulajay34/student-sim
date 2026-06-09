import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { bandColor, relativeDate } from "../../lib/format";
import Card from "../../ui/Card";
import Table from "../../ui/Table";
import Select from "../../ui/Select";
import Badge from "../../ui/Badge";
import Avatar from "../../ui/Avatar";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";

export default function AdminReports() {
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [counsellors, setCounsellors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [counsellorId, setCounsellorId] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([api.getReports(), api.getCounsellors()])
      .then(([rs, cs]) => {
        if (!active) return;
        setReports(Array.isArray(rs) ? rs : []);
        setCounsellors(Array.isArray(cs) ? cs : []);
      })
      .catch((e) => {
        if (active) setError(e.message || "Failed to load reports.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const colorByCounsellor = useMemo(() => {
    const map = {};
    counsellors.forEach((c) => {
      map[c.id] = c.avatarColor;
    });
    return map;
  }, [counsellors]);

  const filtered = useMemo(() => {
    if (!counsellorId) return reports;
    return reports.filter((r) => r.counsellorId === counsellorId);
  }, [reports, counsellorId]);

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
      render: (r) => <span className="text-muted">{r.personaName}</span>,
    },
    {
      key: "scenario",
      header: "Scenario",
      render: (r) => <span className="text-muted">{r.scenarioTitle}</span>,
    },
    {
      key: "score",
      header: "Score",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="tabular-nums font-semibold text-ink">{r.overall?.percent}%</span>
          <Badge color={bandColor(r.overall?.band)}>{r.overall?.band}</Badge>
        </div>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
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
          <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
            <Spinner />
            <span>Loading reports…</span>
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
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12">
            <EmptyState
              title={counsellorId ? "No reports for this counsellor" : "No reports yet"}
              hint={
                counsellorId
                  ? "Try clearing the filter or assigning a mock to this counsellor."
                  : "Reports appear here once counsellors complete their mock sessions."
              }
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                  <path d="M9 17v-6m3 6V7m3 10v-3M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
                </svg>
              }
            />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={filtered}
            onRowClick={(r) => navigate(`/admin/reports/${r.id}`)}
          />
        )}
      </Card>
    </div>
  );
}
