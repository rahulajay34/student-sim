import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth.jsx";
import {
  bandColor,
  formatDate,
  relativeDate,
} from "../../lib/format";
import Card, { CardHeader } from "../../ui/Card";
import Button from "../../ui/Button";
import Badge from "../../ui/Badge";
import StatCard from "../../ui/StatCard";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import DifficultyBadge from "../../ui/DifficultyBadge";

// Inline stroke icons (no icon library per design system).
const Icon = {
  pending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  done: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  avg: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 17l5-5 4 4 8-8" />
      <path d="M16 8h4v4" />
    </svg>
  ),
  best: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M6 4l14 8-14 8V4z" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5h13l3.5 7v6a1 1 0 01-1 1H3a1 1 0 01-1-1v-6l3.5-7z" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
};

const isPending = (s) => s === "assigned" || s === "in_progress";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [assignments, setAssignments] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [startingId, setStartingId] = useState(null);
  const [startError, setStartError] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([api.getAssignments(user.id), api.getReports(user.id)])
      .then(([a, r]) => {
        if (!active) return;
        setAssignments(Array.isArray(a) ? a : []);
        setReports(Array.isArray(r) ? r : []);
      })
      .catch((e) => {
        if (active) setError(e.message || "Could not load your dashboard.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const pending = useMemo(
    () => assignments.filter((a) => isPending(a.status)),
    [assignments]
  );

  const percents = useMemo(
    () =>
      reports
        .map((r) => r?.overall?.percent)
        .filter((p) => typeof p === "number"),
    [reports]
  );

  const stats = useMemo(() => {
    const completed = assignments.filter((a) => a.status === "completed").length;
    const avg = percents.length
      ? Math.round(percents.reduce((s, p) => s + p, 0) / percents.length)
      : null;
    const best = percents.length ? Math.max(...percents) : null;
    return { completed, avg, best };
  }, [assignments, percents]);

  const recentReports = useMemo(() => {
    return [...reports]
      .sort(
        (a, b) =>
          new Date(b.generatedAt || 0).getTime() -
          new Date(a.generatedAt || 0).getTime()
      )
      .slice(0, 5);
  }, [reports]);

  const firstName = (user?.name || "").trim().split(/\s+/)[0] || "there";

  async function handleStart(assignment) {
    if (startingId) return;
    setStartingId(assignment.id);
    setStartError(null);
    try {
      const res = await api.startSession({
        mode: "assigned",
        assignmentId: assignment.id,
        counsellorId: user.id,
      });
      const sessionId = res?.sessionId;
      if (!sessionId) throw new Error("Session could not be started.");
      navigate("/app/session/" + sessionId);
    } catch (e) {
      setStartError(e.message || "Could not start this mock. Please try again.");
      setStartingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-ink">
            Welcome, {firstName}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Practice your counselling calls and review how each session went.
          </p>
        </div>
        <Button as={Link} to="/app/practice" variant="secondary">
          {Icon.spark}
          Free practice
        </Button>
      </div>

      {error && (
        <Card className="border-danger/30 bg-danger-soft p-4">
          <p className="text-sm font-medium text-danger">{error}</p>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending mocks"
          value={pending.length}
          hint={pending.length ? "Ready to start" : "All caught up"}
          icon={Icon.pending}
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          hint="Mocks finished"
          icon={Icon.done}
        />
        <StatCard
          label="Avg score"
          value={stats.avg == null ? "—" : `${stats.avg}%`}
          hint={percents.length ? "Across all reports" : "No reports yet"}
          icon={Icon.avg}
        />
        <StatCard
          label="Best score"
          value={stats.best == null ? "—" : `${stats.best}%`}
          hint={percents.length ? "Personal best" : "No reports yet"}
          icon={Icon.best}
        />
      </div>

      {/* Two-column: mocks + recent reports */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Mocks to do */}
        <Card className="p-6 lg:col-span-3">
          <CardHeader
            title="Your mocks to do"
            subtitle={
              pending.length
                ? `${pending.length} ${pending.length === 1 ? "mock" : "mocks"} assigned to you`
                : "Nothing waiting on you right now"
            }
            action={
              <Button as={Link} to="/app/mocks" variant="ghost" size="sm">
                View all
              </Button>
            }
          />

          {startError && (
            <div className="mb-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
              {startError}
            </div>
          )}

          {pending.length === 0 ? (
            <EmptyState
              icon={Icon.inbox}
              title="No mocks to do"
              hint="You're all caught up. Try a free practice session to keep sharp."
              action={
                <Button as={Link} to="/app/practice" variant="secondary" size="sm">
                  {Icon.spark}
                  Free practice
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {pending.map((a) => {
                const starting = startingId === a.id;
                return (
                  <li
                    key={a.id}
                    className="flex flex-col gap-3 rounded-xl border border-line bg-canvas/40 p-4 transition-colors hover:bg-canvas sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-ink">
                          {a.scenario?.title || "Untitled scenario"}
                        </p>
                        <DifficultyBadge level={a.scenario?.difficulty} />
                        {a.status === "in_progress" && (
                          <Badge color="warn">In progress</Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted">
                        with {a.personaName || "a student"}
                      </p>
                    </div>
                    <Button
                      onClick={() => handleStart(a)}
                      disabled={!!startingId}
                      size="sm"
                      className="shrink-0"
                    >
                      {starting ? (
                        <>
                          <Spinner size={14} className="text-white" />
                          Starting…
                        </>
                      ) : (
                        <>
                          {Icon.play}
                          {a.status === "in_progress" ? "Resume" : "Start"}
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Recent reports */}
        <Card className="p-6 lg:col-span-2">
          <CardHeader
            title="Recent reports"
            subtitle="Your latest session results"
            action={
              reports.length > 0 ? (
                <Button as={Link} to="/app/reports" variant="ghost" size="sm">
                  View all
                </Button>
              ) : null
            }
          />

          {recentReports.length === 0 ? (
            <EmptyState
              title="No reports yet"
              hint="Finish a mock or practice call to see your scored report here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentReports.map((r) => {
                const percent = r?.overall?.percent;
                const band = r?.overall?.band;
                return (
                  <li key={r.id}>
                    <Link
                      to={"/app/reports/" + r.id}
                      className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-canvas"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">
                          {r.scenarioTitle || "Session report"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {r.personaName ? `${r.personaName} · ` : ""}
                          {r.generatedAt
                            ? relativeDate(r.generatedAt)
                            : formatDate(r.generatedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-bold text-ink">
                          {typeof percent === "number" ? `${percent}%` : "—"}
                        </span>
                        {band && <Badge color={bandColor(band)}>{band}</Badge>}
                        <span className="text-muted transition-transform group-hover:translate-x-0.5">
                          {Icon.chevron}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
