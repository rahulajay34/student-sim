// Templates — admin list page for assignment templates (WS7).
// Follows the same structure as Assignments.jsx.
import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import Table from "../../ui/Table";
import DifficultyBadge from "../../ui/DifficultyBadge";
import EmptyState from "../../ui/EmptyState";
import Spinner from "../../ui/Spinner";
import SearchInput from "../../ui/SearchInput";
import ConfirmDialog from "../../ui/ConfirmDialog";
import Modal from "../../ui/Modal";
import Avatar from "../../ui/Avatar";
import { useCreateShortcut } from "../../ui/useCreateShortcut";
import { useToast } from "../../ui/Toast";
import { api } from "../../lib/api";
import TemplateForm from "./TemplateForm";

// ── AssignModal: pick counsellors and bulk-assign a template ──────────────────
function AssignModal({ open, onClose, template, onAssigned }) {
  const { pushToast } = useToast();
  const [counsellors, setCounsellors] = useState([]);
  const [loadingC, setLoadingC] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!open) { setSelected(new Set()); setQuery(""); return; }
    setLoadingC(true);
    api.getCounsellors()
      .then((data) => setCounsellors(Array.isArray(data) ? data : []))
      .catch(() => setCounsellors([]))
      .finally(() => setLoadingC(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return counsellors;
    return counsellors.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
    );
  }, [counsellors, query]);

  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((c) => next.delete(c.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((c) => next.add(c.id));
        return next;
      });
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleAssign() {
    if (selected.size === 0 || assigning) return;
    setAssigning(true);
    try {
      const res = await api.assignTemplate(template.id, [...selected]);
      onClose();
      onAssigned?.();
      pushToast(`Assigned to ${res.created} counsellor${res.created !== 1 ? "s" : ""}`, { tone: "success", variant: "light" });
    } catch (err) {
      pushToast(err?.message || "Assignment failed — try again.", { tone: "danger", variant: "light" });
    } finally {
      setAssigning(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign "${template?.name || "template"}" to counsellors`}
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <span className="text-sm text-muted">
            {selected.size > 0 ? `${selected.size} selected` : "No counsellors selected"}
          </span>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose} disabled={assigning}>Cancel</Button>
            <Button variant="primary" onClick={handleAssign} disabled={selected.size === 0 || assigning}>
              {assigning && <Spinner size={14} className="text-white" />}
              {assigning ? "Assigning…" : `Assign to ${selected.size || "…"} counsellor${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search counsellors…"
          className="w-full"
        />
        {loadingC ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : counsellors.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No counsellors found.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 pb-1 border-b border-line">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-line accent-brand-600"
                id="assign-select-all"
              />
              <label htmlFor="assign-select-all" className="text-xs font-medium text-muted cursor-pointer select-none">
                {allSelected ? "Clear all" : "Select all"}
                {query ? " (filtered)" : ""}
              </label>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {filtered.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2 cursor-pointer hover:bg-canvas transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="h-4 w-4 rounded border-line accent-brand-600 shrink-0"
                  />
                  <Avatar name={c.name} color={c.avatarColor} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{c.name}</div>
                    {c.email && <div className="truncate text-xs text-muted">{c.email}</div>}
                  </div>
                </label>
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="py-4 text-center text-sm text-muted">No counsellors match "{query}".</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Main Templates page ───────────────────────────────────────────────────────
export default function Templates() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  // Create/edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // null = create; object = edit
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete confirm
  const [confirmRow, setConfirmRow] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Assign modal
  const [assignTarget, setAssignTarget] = useState(null);

  // Enrichment: persona+course names for display
  const [personaNames, setPersonaNames] = useState({});
  const [courseNames, setCourseNames] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, personas, courses] = await Promise.all([
        api.getAssignmentTemplates(),
        api.getPersonas().catch(() => []),
        api.getCourses().catch(() => []),
      ]);
      const raw = Array.isArray(data) ? data : [];
      setRows([...raw].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
      // Build lookup maps for display names.
      const pNames = {};
      if (Array.isArray(personas)) personas.forEach((p) => { pNames[p.id] = p.name; });
      setPersonaNames(pNames);
      const cNames = {};
      if (Array.isArray(courses)) courses.forEach((c) => { cNames[c.id] = c.name; });
      setCourseNames(cNames);
    } catch (err) {
      setError(err?.message || "Failed to load templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) load(); });
    return () => { cancelled = true; };
  }, [load]);

  const goCreate = useCallback(() => {
    setEditTarget(null);
    setFormError("");
    setFormOpen(true);
  }, []);
  useCreateShortcut(goCreate, { enabled: !loading && !confirmRow && !formOpen && !assignTarget });

  async function handleFormSubmit(data) {
    setSubmitting(true);
    setFormError("");
    try {
      if (editTarget) {
        await api.updateAssignmentTemplate(editTarget.id, data);
      } else {
        await api.createAssignmentTemplate(data);
      }
      setFormOpen(false);
      setEditTarget(null);
      await load();
    } catch (err) {
      setFormError(err?.message || "Failed to save template.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    const row = confirmRow;
    if (!row) return;
    setDeletingId(row.id);
    setError("");
    try {
      await api.deleteAssignmentTemplate(row.id);
      setConfirmRow(null);
      await load();
    } catch (err) {
      setError(err?.message || "Failed to delete template.");
      throw err;
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, personaNames[r.personaId], courseNames[r.courseId], r.scenario?.title, r.scenario?.difficulty]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, query, personaNames, courseNames]);

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    {
      key: "course",
      header: "Course",
      sortable: true,
      sortValue: (r) => courseNames[r.courseId] || "",
      render: (r) => <span className="text-muted">{courseNames[r.courseId] || "—"}</span>,
    },
    {
      key: "persona",
      header: "Persona",
      sortable: true,
      sortValue: (r) => personaNames[r.personaId] || "",
      render: (r) => <span className="text-muted">{personaNames[r.personaId] || "—"}</span>,
    },
    {
      key: "difficulty",
      header: "Difficulty",
      sortable: true,
      sortValue: (r) => ({ easy: 0, medium: 1, hard: 2 })[r.scenario?.difficulty] ?? -1,
      render: (r) => <DifficultyBadge level={r.scenario?.difficulty} />,
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (r) =>
        r.createdAt ? (
          <span className="text-muted text-sm">
            {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAssignTarget(r)}
          >
            Assign
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditTarget(r);
              setFormError("");
              setFormOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRow(r)}
            disabled={deletingId === r.id}
            className="text-danger hover:bg-danger-soft hover:text-danger"
          >
            {deletingId === r.id ? "Deleting…" : "Delete"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight text-ink">Templates</h2>
          <p className="mt-1 text-sm text-muted">
            Reusable assignment templates — define once, bulk-assign to counsellors.
          </p>
        </div>
        <Button variant="primary" onClick={goCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New template
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
            title="No templates yet"
            hint="Create a reusable template and bulk-assign it to counsellors. Press N to start."
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
            }
            action={
              <Button variant="primary" onClick={goCreate}>
                New template
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
              rows.length > 8 || query ? (
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search name, course, persona…"
                  className="max-w-sm"
                />
              ) : null
            }
          />
          {filtered.length === 0 && (
            <div className="px-4 py-12">
              <EmptyState title="No matching templates" hint="Try a different search term." />
            </div>
          )}
        </Card>
      ) : null}

      {/* Create / Edit modal */}
      <Modal
        open={formOpen}
        onClose={() => { if (!submitting) { setFormOpen(false); setEditTarget(null); } }}
        title={editTarget ? `Edit template — ${editTarget.name}` : "New assignment template"}
      >
        <TemplateForm
          key={editTarget?.id || "new"}
          initial={editTarget || {}}
          onSubmit={handleFormSubmit}
          submitting={submitting}
          error={formError}
        />
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!confirmRow}
        onClose={() => setConfirmRow(null)}
        onConfirm={confirmDelete}
        title="Delete template?"
        confirmLabel="Delete template"
        body={`Delete "${confirmRow?.name || "this template"}"? Assignments already created from it are not affected.`}
      />

      {/* Assign modal */}
      <AssignModal
        open={!!assignTarget}
        onClose={() => setAssignTarget(null)}
        template={assignTarget}
        onAssigned={load}
      />
    </div>
  );
}
