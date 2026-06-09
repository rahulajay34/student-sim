import { useEffect, useState } from "react";
import Card from "../../ui/Card";
import Avatar from "../../ui/Avatar";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import { api } from "../../lib/api";

// One small labelled metric within a counsellor card.
function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-canvas px-3 py-2.5">
      <div className="text-lg font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1.5 text-xs font-medium text-muted">{label}</div>
    </div>
  );
}

export default function Counsellors() {
  const [counsellors, setCounsellors] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [c, a, r] = await Promise.all([
          api.getCounsellors(),
          api.getAssignments(),
          api.getReports(),
        ]);
        if (!alive) return;
        setCounsellors(c || []);
        setAssignments(a || []);
        setReports(r || []);
      } catch (e) {
        if (alive) setError(e.message || "Failed to load counsellors.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Counsellors</h2>
        <p className="mt-1 text-sm text-muted">
          {loading
            ? "Loading team…"
            : `${counsellors.length} ${counsellors.length === 1 ? "counsellor" : "counsellors"} on your team`}
        </p>
      </header>

      {error && (
        <Card className="border-danger/30 bg-danger-soft p-4">
          <p className="text-sm font-medium text-danger">{error}</p>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={28} />
        </div>
      ) : !error && counsellors.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No counsellors yet"
            hint="Counsellors will appear here once they are added to the workspace."
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M17 20h5v-1a4 4 0 00-3-3.87M9 20H4v-1a4 4 0 013-3.87m6-1a4 4 0 10-4-4 4 4 0 004 4z" />
              </svg>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {counsellors.map((c) => {
            const mine = assignments.filter((a) => a.counsellorId === c.id);
            const completed = mine.filter((a) => a.status === "completed");
            const myReports = reports.filter((r) => r.counsellorId === c.id);
            const scored = myReports
              .map((r) => r.overall?.percent)
              .filter((p) => typeof p === "number");
            const avg = scored.length
              ? Math.round(scored.reduce((s, p) => s + p, 0) / scored.length)
              : null;

            return (
              <Card key={c.id} className="p-5">
                <div className="flex items-center gap-3.5">
                  <Avatar name={c.name} color={c.avatarColor} size="lg" />
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-ink">{c.name}</div>
                    <div className="truncate text-sm text-muted">{c.email}</div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  <Stat label="Assignments" value={mine.length} />
                  <Stat label="Completed" value={completed.length} />
                  <Stat label="Reports" value={myReports.length} />
                  <Stat label="Avg score" value={avg == null ? "—" : `${avg}%`} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
