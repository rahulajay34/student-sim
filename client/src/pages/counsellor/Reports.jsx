import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth.jsx";
import { bandColor, relativeDate } from "../../lib/format";
import Card from "../../ui/Card";
import Table from "../../ui/Table";
import Badge from "../../ui/Badge";
import Button from "../../ui/Button";
import EmptyState from "../../ui/EmptyState";

function outcomeColor(outcome) {
  return outcome === "Converted" ? "success" : "danger";
}

export default function Reports() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getReports(user.id)
      .then((data) => {
        if (!active) return;
        setReports(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Failed to load reports.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const open = (id) => navigate("/app/reports/" + id);

  const columns = [
    {
      key: "personaName",
      header: "Persona",
      render: (r) => (
        <span className="font-medium text-ink">{r.personaName || "—"}</span>
      ),
    },
    {
      key: "scenarioTitle",
      header: "Scenario",
      render: (r) => (
        <span className="text-muted">{r.scenarioTitle || "—"}</span>
      ),
    },
    {
      key: "score",
      header: "Score",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="tabular-nums font-semibold text-ink">
            {r.overall?.percent ?? 0}%
          </span>
          <Badge color={bandColor(r.overall?.band)}>
            {r.overall?.band || "—"}
          </Badge>
        </div>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (r) => (
        <Badge color={outcomeColor(r.overall?.outcome)}>
          {r.overall?.outcome || "—"}
        </Badge>
      ),
    },
    {
      key: "generatedAt",
      header: "Date",
      className: "text-right",
      render: (r) => (
        <span className="text-muted">{relativeDate(r.generatedAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-ink">My Reports</h2>
          <p className="mt-1 text-sm text-muted">
            Coaching feedback from your completed mock sessions.
          </p>
        </div>
        {!loading && !error && reports.length > 0 && (
          <Badge color="slate">
            {reports.length} {reports.length === 1 ? "report" : "reports"}
          </Badge>
        )}
      </div>

      {loading ? (
        <Card className="divide-y divide-line p-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-3.5">
              <div className="h-4 w-28 rounded-md bg-line" />
              <div className="h-4 flex-1 rounded-md bg-line" />
              <div className="h-4 w-14 rounded-md bg-line" />
              <div className="h-5 w-16 rounded-full bg-line" />
              <div className="h-4 w-20 rounded-md bg-line" />
            </div>
          ))}
        </Card>
      ) : error ? (
        <Card className="p-6">
          <EmptyState
            title="Couldn’t load reports"
            hint={error}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="M12 9v4m0 4h.01M10.3 3.86l-8.5 14.7A1 1 0 002.66 20h18.68a1 1 0 00.86-1.44l-8.5-14.7a1 1 0 00-1.7 0z" />
              </svg>
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate(0)}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : reports.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No reports yet"
            hint="No reports yet — complete a mock to get coached."
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="M9 17v-6m3 6V7m3 10v-3M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
              </svg>
            }
            action={
              <Button size="sm" onClick={() => navigate("/app/mocks")}>
                Go to my mocks
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="p-1.5">
          <Table columns={columns} rows={reports} onRowClick={(r) => open(r.id)} />
        </Card>
      )}
    </div>
  );
}
