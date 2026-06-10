import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth.jsx";
import { STATUS_LABEL, statusColor } from "../../lib/format";
import Card from "../../ui/Card";
import Button from "../../ui/Button";
import Badge from "../../ui/Badge";
import DifficultyBadge from "../../ui/DifficultyBadge";
import EmptyState from "../../ui/EmptyState";
import Spinner from "../../ui/Spinner";

export default function MyMocks() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Track which card was tapped (visual feedback only — navigates away immediately).
  const [startingId, setStartingId] = useState(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.getAssignments(user.id);
      const raw = Array.isArray(data) ? data : [];
      const ORDER = { assigned: 0, in_progress: 1, completed: 2 };
      raw.sort((a, b) => {
        const statusDiff = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
        if (statusDiff !== 0) return statusDiff;
        // Within group: newest first
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      });
      setAssignments(raw);
    } catch (err) {
      setError(err.message || "Couldn't load your mocks.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  function handleStart(assignment) {
    setStartingId(assignment.id);
    // Resume in-progress sessions directly; start new ones via the green room.
    if (assignment.status === "in_progress" && assignment.sessionId) {
      navigate(`/app/session/${assignment.sessionId}`);
    } else {
      navigate("/app/session/new", {
        state: { mode: "assigned", assignmentId: assignment.id },
      });
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">My Mocks</h2>
          <p className="mt-1 text-sm text-muted">
            Practice calls assigned to you. Start a mock or resume one in progress.
          </p>
        </div>
        {!loading && assignments.length > 0 && (
          <Badge color="slate">
            {assignments.length} {assignments.length === 1 ? "mock" : "mocks"}
          </Badge>
        )}
      </header>

      {error && (
        <Card className="flex items-center justify-between gap-4 border-danger-soft p-4">
          <p className="text-sm text-danger">{error}</p>
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size={28} />
        </div>
      ) : assignments.length === 0 && !error ? (
        <Card className="p-6">
          <EmptyState
            title="No mocks assigned yet"
            hint="When an admin assigns you a mock counselling session, it will show up here ready to start."
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z" />
              </svg>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {assignments.map((a) => {
            const scenario = a.scenario || {};
            const isCompleted = a.status === "completed";
            const isInProgress = a.status === "in_progress";
            const isStarting = startingId === a.id;

            return (
              <Card key={a.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-ink">{a.personaName || "Student"}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <DifficultyBadge level={scenario.difficulty} />
                      <Badge color={statusColor(a.status)}>
                        {STATUS_LABEL[a.status] || a.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex-1">
                  {scenario.title && (
                    <p className="text-sm font-medium text-ink">{scenario.title}</p>
                  )}
                  {scenario.situation && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{scenario.situation}</p>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-end border-t border-line pt-4">
                  {isCompleted ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      as={Link}
                      to={`/app/reports/${a.reportId}`}
                    >
                      View report
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isStarting}
                      onClick={() => handleStart(a)}
                    >
                      {isStarting ? (
                        <>
                          <Spinner size={16} className="text-white" />
                          Starting…
                        </>
                      ) : isInProgress ? (
                        "Resume"
                      ) : (
                        "Start"
                      )}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
