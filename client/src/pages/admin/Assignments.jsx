import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import Table from "../../ui/Table";
import Badge from "../../ui/Badge";
import DifficultyBadge from "../../ui/DifficultyBadge";
import EmptyState from "../../ui/EmptyState";
import Spinner from "../../ui/Spinner";
import SearchInput from "../../ui/SearchInput";
import ConfirmDialog from "../../ui/ConfirmDialog";
import { useCreateShortcut } from "../../ui/useCreateShortcut";
import { statusColor, STATUS_LABEL } from "../../lib/format";
import { api } from "../../lib/api";

const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };
const STATUS_RANK = { assigned: 0, in_progress: 1, completed: 2 };

export default function Assignments() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [query, setQuery] = useState("");
  const [confirmRow, setConfirmRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getAssignments();
      const raw = Array.isArray(data) ? data : [];
      setRows([...raw].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
    } catch (err) {
      setError(err.message || "Failed to load assignments.");
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

  const goCreate = useCallback(() => navigate("/admin/assignments/new"), [navigate]);
  useCreateShortcut(goCreate, { enabled: !loading });

  async function confirmDelete() {
    const row = confirmRow;
    if (!row) return;
    setDeletingId(row.id);
    setError("");
    try {
      await api.deleteAssignment(row.id);
      setConfirmRow(null);
      await load();
    } catch (err) {
      setError(err.message || "Failed to delete assignment.");
      throw err;
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.counsellorName, r.personaName, r.scenario?.title, STATUS_LABEL[r.status] || r.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const columns = [
    {
      key: "counsellorName",
      header: "Counsellor",
      sortable: true,
      render: (r) => <span className="font-medium text-ink">{r.counsellorName || "—"}</span>,
    },
    {
      key: "personaName",
      header: "Persona",
      sortable: true,
      render: (r) => <span className="text-muted">{r.personaName || "—"}</span>,
    },
    {
      key: "scenario",
      header: "Scenario",
      sortable: true,
      sortValue: (r) => r.scenario?.title || "",
      render: (r) => <span className="text-ink">{r.scenario?.title || "—"}</span>,
    },
    {
      key: "difficulty",
      header: "Difficulty",
      sortable: true,
      sortValue: (r) => DIFFICULTY_RANK[r.scenario?.difficulty] ?? -1,
      render: (r) => <DifficultyBadge level={r.scenario?.difficulty} />,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => STATUS_RANK[r.status] ?? 9,
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
            className="text-sm font-medium text-brand-700 transition-colors hover:text-brand-600"
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
          onClick={() => setConfirmRow(r)}
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
          <h2 className="text-2xl font-bold tracking-tight text-ink">Assignments</h2>
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
        <Card role="alert" className="flex items-start justify-between gap-4 border-danger/30 bg-danger-soft p-4">
          <p className="text-sm font-medium text-danger">{error}</p>
          <button
            type="button"
            onClick={load}
            className="shrink-0 text-sm font-medium text-danger underline-offset-2 hover:underline"
          >
            Retry
          </button>
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
            hint="Assign a persona and scenario to a counsellor to get them practicing. Tip: press N to start."
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
          <Table
            columns={columns}
            rows={filtered}
            toolbar={
              rows.length > 8 ? (
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search counsellor, persona, scenario…"
                  className="max-w-sm"
                />
              ) : null
            }
          />
          {filtered.length === 0 && (
            <div className="px-4 py-12">
              <EmptyState
                title="No matching assignments"
                hint="Try a different search term."
              />
            </div>
          )}
        </Card>
      ) : null}

      <ConfirmDialog
        open={!!confirmRow}
        onClose={() => setConfirmRow(null)}
        onConfirm={confirmDelete}
        title="Delete assignment?"
        confirmLabel="Delete assignment"
        body={`Delete the assignment for ${confirmRow?.counsellorName || "this counsellor"}? This cannot be undone.`}
      />
    </div>
  );
}
