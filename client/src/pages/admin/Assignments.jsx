import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import Table from "../../ui/Table";
import Badge from "../../ui/Badge";
import DifficultyBadge from "../../ui/DifficultyBadge";
import EmptyState from "../../ui/EmptyState";
import Spinner from "../../ui/Spinner";
import { statusColor, STATUS_LABEL } from "../../lib/format";
import { api } from "../../lib/api";

export default function Assignments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAssignments();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load assignments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(row) {
    if (
      !window.confirm(
        `Delete the assignment for ${row.counsellorName || "this counsellor"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(row.id);
    setError("");
    try {
      await api.deleteAssignment(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Failed to delete assignment.");
      setDeletingId(null);
    }
  }

  const columns = [
    {
      key: "counsellorName",
      header: "Counsellor",
      render: (r) => <span className="font-medium text-ink">{r.counsellorName || "—"}</span>,
    },
    {
      key: "personaName",
      header: "Persona",
      render: (r) => <span className="text-muted">{r.personaName || "—"}</span>,
    },
    {
      key: "scenario",
      header: "Scenario",
      render: (r) => <span className="text-ink">{r.scenario?.title || "—"}</span>,
    },
    {
      key: "difficulty",
      header: "Difficulty",
      render: (r) => <DifficultyBadge level={r.scenario?.difficulty} />,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge color={statusColor(r.status)}>{STATUS_LABEL[r.status] || r.status}</Badge>
      ),
    },
    {
      key: "report",
      header: "Report",
      render: (r) =>
        r.hasReport && r.reportId ? (
          <Link
            to={`/admin/reports/${r.reportId}`}
            className="text-sm font-medium text-brand-700 hover:text-brand-600"
          >
            View
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleDelete(r)}
          disabled={deletingId === r.id}
          className="text-danger hover:bg-danger-soft hover:text-danger"
        >
          {deletingId === r.id ? "Deleting…" : "Delete"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-ink">Assignments</h2>
          <p className="mt-1 text-sm text-muted">
            Mocks assigned to counsellors and their outcomes.
          </p>
        </div>
        <Button as={Link} to="/admin/assignments/new" variant="primary">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-4 w-4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New assignment
        </Button>
      </div>

      {error && (
        <Card className="bg-danger-soft p-4">
          <p className="text-sm font-medium text-danger">{error}</p>
        </Card>
      )}

      {loading ? (
        <Card className="flex items-center justify-center p-16">
          <Spinner size={28} />
        </Card>
      ) : rows.length === 0 && !error ? (
        <Card className="p-6">
          <EmptyState
            title="No assignments yet"
            hint="Assign a persona and scenario to a counsellor to get them practicing."
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                className="h-6 w-6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            }
            action={
              <Button as={Link} to="/admin/assignments/new" variant="primary">
                New assignment
              </Button>
            }
          />
        </Card>
      ) : rows.length > 0 ? (
        <Card className="overflow-hidden p-0">
          <Table columns={columns} rows={rows} />
        </Card>
      ) : null}
    </div>
  );
}
