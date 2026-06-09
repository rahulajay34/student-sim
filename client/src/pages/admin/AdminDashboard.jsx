import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card, { CardHeader } from "../../ui/Card";
import StatCard from "../../ui/StatCard";
import Button from "../../ui/Button";
import Badge from "../../ui/Badge";
import Avatar from "../../ui/Avatar";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import { api } from "../../lib/api";
import { bandColor, statusColor, STATUS_LABEL, relativeDate } from "../../lib/format";

// Inline stroke icons for the stat tiles (no icon library per house rules).
function Icon({ d, className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}

const ICON = {
  counsellors: "M17 20h5v-1a4 4 0 00-3-3.87M9 20H4v-1a4 4 0 013-3.87m6-1a4 4 0 10-4-4 4 4 0 004 4z",
  personas: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-1a6 6 0 0112 0v1",
  assignments: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  score: "M3 3v18h18M7 14l3-3 3 3 5-5",
};

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [counsellors, setCounsellors] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [reports, setReports] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [c, p, a, r] = await Promise.all([
          api.getCounsellors(),
          api.getPersonas(),
          api.getAssignments(),
          api.getReports(),
        ]);
        if (!alive) return;
        setCounsellors(c || []);
        setPersonas(p || []);
        setAssignments(a || []);
        setReports(r || []);
      } catch (e) {
        if (alive) setError(e.message || "Failed to load dashboard.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const avgScore = reports.length
    ? Math.round(reports.reduce((sum, r) => sum + (r?.overall?.percent || 0), 0) / reports.length)
    : null;

  const recentReports = [...reports]
    .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
    .slice(0, 5);

  const recentAssignments = [...assignments]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Overview</h2>
          <p className="mt-0.5 text-sm text-muted">
            A snapshot of your team, personas and the latest counselling activity.
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
        <Card className="border-danger/30 bg-danger-soft p-4">
          <p className="text-sm font-medium text-danger">{error}</p>
        </Card>
      )}

      {/* Stat row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Counsellors" value={counsellors.length} icon={<Icon d={ICON.counsellors} />} />
        <StatCard label="Personas" value={personas.length} icon={<Icon d={ICON.personas} />} />
        <StatCard label="Assignments" value={assignments.length} icon={<Icon d={ICON.assignments} />} />
        <StatCard
          label="Avg score"
          value={avgScore == null ? "—" : `${avgScore}%`}
          hint={reports.length ? `Across ${reports.length} report${reports.length === 1 ? "" : "s"}` : "No reports yet"}
          icon={<Icon d={ICON.score} />}
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
              hint="Reports appear here once counsellors complete their assigned mocks."
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentReports.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/admin/reports/${r.id}`}
                    className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-canvas"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{r.counsellorName}</p>
                      <p className="truncate text-xs text-muted">
                        {r.personaName} · {relativeDate(r.generatedAt)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {r.overall?.percent}%
                    </span>
                    <Badge color={bandColor(r.overall?.band)}>{r.overall?.band}</Badge>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent assignments */}
        <Card className="p-6">
          <CardHeader
            title="Recent assignments"
            subtitle="Mocks assigned to your counsellors"
            action={
              <Button as={Link} to="/admin/assignments" variant="ghost" size="sm">
                View all
              </Button>
            }
          />
          {recentAssignments.length === 0 ? (
            <EmptyState
              title="No assignments yet"
              hint="Create a mock assignment to get your counsellors practising."
              action={
                <Button as={Link} to="/admin/assignments/new" size="sm">
                  New assignment
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentAssignments.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-3">
                  <Avatar name={a.counsellorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{a.counsellorName}</p>
                    <p className="truncate text-xs text-muted">{a.personaName}</p>
                  </div>
                  <Badge color={statusColor(a.status)}>{STATUS_LABEL[a.status] || a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
