import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import Badge from "../../ui/Badge";
import Modal from "../../ui/Modal";
import Input from "../../ui/Input";
import Textarea from "../../ui/Textarea";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";

const ANCHOR_LABELS = [
  { level: "1", label: "1 — Poor" },
  { level: "2", label: "2 — Developing" },
  { level: "3", label: "3 — Competent" },
  { level: "4", label: "4 — Proficient" },
  { level: "5", label: "5 — Excellent" },
];

function emptyAnchor() {
  return { 1: "", 2: "", 3: "", 4: "", 5: "" };
}

function emptyCriterion() {
  return { key: "", label: "", weight: "", anchors: emptyAnchor() };
}

function weightsSum(criteria) {
  return criteria.reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0);
}

export default function Rubrics() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // template being edited, null for create
  const [form, setForm] = useState({ name: "", description: "", criteria: [emptyCriterion()] });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.getRubricTemplates();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load rubric templates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", description: "", criteria: [emptyCriterion()] });
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(tpl) {
    setEditing(tpl);
    setForm({
      name: tpl.name || "",
      description: tpl.description || "",
      criteria: (tpl.criteria || []).map((c) => ({
        _existing: true,
        key: c.key || "",
        label: c.label || "",
        weight: String(c.weight ?? ""),
        anchors: {
          1: c.anchors?.["1"] ?? "",
          2: c.anchors?.["2"] ?? "",
          3: c.anchors?.["3"] ?? "",
          4: c.anchors?.["4"] ?? "",
          5: c.anchors?.["5"] ?? "",
        },
      })),
    });
    setFormError("");
    setModalOpen(true);
  }

  async function openDuplicate(tpl) {
    setFormError("");
    const copy = {
      name: `${tpl.name} (copy)`,
      description: tpl.description || "",
      criteria: (tpl.criteria || []).map((c) => ({
        key: c.key || "",
        label: c.label || "",
        weight: String(c.weight ?? ""),
        anchors: {
          1: c.anchors?.["1"] ?? "",
          2: c.anchors?.["2"] ?? "",
          3: c.anchors?.["3"] ?? "",
          4: c.anchors?.["4"] ?? "",
          5: c.anchors?.["5"] ?? "",
        },
      })),
    };
    setEditing(null);
    setForm(copy);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  function setField(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function setCriterionField(idx, field, value) {
    setForm((f) => {
      const criteria = f.criteria.map((c, i) => (i === idx ? { ...c, [field]: value } : c));
      return { ...f, criteria };
    });
  }

  function setCriterionAnchor(idx, level, value) {
    setForm((f) => {
      const criteria = f.criteria.map((c, i) =>
        i === idx ? { ...c, anchors: { ...c.anchors, [level]: value } } : c
      );
      return { ...f, criteria };
    });
  }

  function addCriterion() {
    setForm((f) => ({ ...f, criteria: [...f.criteria, emptyCriterion()] }));
  }

  function removeCriterion(idx) {
    setForm((f) => ({ ...f, criteria: f.criteria.filter((_, i) => i !== idx) }));
  }

  function validate() {
    if (!form.name.trim()) return "Template name is required.";
    if (form.criteria.length < 3) return "A rubric must have at least 3 criteria.";
    const keys = new Set();
    for (const [i, c] of form.criteria.entries()) {
      if (!c.key.trim()) return `Criterion ${i + 1}: key is required.`;
      if (!/^[a-z][a-z0-9_]*$/.test(c.key.trim())) return `Criterion ${i + 1}: key must be lowercase letters/numbers/underscores (start with a letter).`;
      if (keys.has(c.key.trim())) return `Duplicate criterion key: "${c.key}".`;
      keys.add(c.key.trim());
      if (!c.label.trim()) return `Criterion ${i + 1}: label is required.`;
      const w = parseFloat(c.weight);
      if (isNaN(w) || w <= 0) return `Criterion "${c.key || i + 1}": weight must be a positive number.`;
      for (const lvl of ["1", "2", "3", "4", "5"]) {
        if (!c.anchors[lvl]?.trim()) return `Criterion "${c.key || i + 1}": anchor for level ${lvl} is required.`;
      }
    }
    const sum = weightsSum(form.criteria);
    if (Math.abs(sum - 100) > 1e-6) return `Weights sum to ${Math.round(sum * 10) / 10}, must equal 100.`;
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      criteria: form.criteria.map((c) => ({
        key: c.key.trim(),
        label: c.label.trim(),
        weight: parseFloat(c.weight),
        anchors: {
          "1": c.anchors[1].trim(),
          "2": c.anchors[2].trim(),
          "3": c.anchors[3].trim(),
          "4": c.anchors[4].trim(),
          "5": c.anchors[5].trim(),
        },
      })),
    };
    // Strip any underscore-prefixed helper keys from criteria before sending.
    payload.criteria = payload.criteria.map((c) => {
      const clean = {};
      for (const [k, v] of Object.entries(c)) {
        if (!k.startsWith("_")) clean[k] = v;
      }
      return clean;
    });
    try {
      if (editing) {
        await api.updateRubricTemplate(editing.id, payload);
      } else {
        await api.createRubricTemplate(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save rubric template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tpl) {
    if (!window.confirm(`Delete rubric template "${tpl.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteRubricTemplate(tpl.id);
      await load();
    } catch (e) {
      setError(e.message || "Could not delete rubric template.");
    }
  }

  const liveSum = Math.round(weightsSum(form.criteria) * 10) / 10;
  const sumOk = Math.abs(liveSum - 100) < 1e-6;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink">Rubric templates</h2>
          <p className="mt-1 text-sm text-muted">
            Evaluation rubrics used to grade mock counselling sessions.
          </p>
        </div>
        <Button onClick={openCreate}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New rubric
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={load}
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={28} />
        </div>
      ) : templates.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No rubric templates yet"
            hint="Create a rubric template to define how mock counselling sessions are evaluated."
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7l2 2 4-4" />
              </svg>
            }
            action={<Button onClick={openCreate}>New rubric</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {templates.map((tpl) => {
            const wSum = (tpl.criteria || []).reduce((s, c) => s + (c.weight || 0), 0);
            const wSumOk = Math.abs(wSum - 100) < 1e-6;
            const previewKeys = (tpl.criteria || []).slice(0, 4).map((c) => c.key);

            return (
              <Card key={tpl.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 truncate font-semibold text-ink">{tpl.name}</h3>
                  {tpl.isDefault && (
                    <Badge color="brand" className="shrink-0">
                      Default
                    </Badge>
                  )}
                </div>

                <p className="mt-2 line-clamp-3 text-sm text-muted">
                  {tpl.description || "No description provided."}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">
                    {(tpl.criteria || []).length} criteria
                  </span>
                  <Badge color={wSumOk ? "success" : "danger"}>
                    {wSumOk ? `Σ 100` : `Σ ${Math.round(wSum * 10) / 10}`}
                  </Badge>
                </div>

                {previewKeys.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {previewKeys.map((k) => (
                      <Badge key={k} color="slate">
                        {k}
                      </Badge>
                    ))}
                    {(tpl.criteria || []).length > 4 && (
                      <Badge color="slate">+{(tpl.criteria || []).length - 4}</Badge>
                    )}
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openEdit(tpl)}>
                      Edit
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => openDuplicate(tpl)}>
                      Duplicate
                    </Button>
                  </div>
                  {!tpl.isDefault && (
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(tpl)}>
                      <span className="text-danger">Delete</span>
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? "Edit rubric template" : "New rubric template"}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size={16} className="text-white" />}
              {editing ? "Save changes" : "Create rubric"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Input
            label="Template name"
            placeholder="e.g. Grounded v2 (Real-Call Anchored)"
            value={form.name}
            onChange={setField("name")}
          />

          <Textarea
            label="Description"
            rows={2}
            placeholder="A short summary of this rubric and how it was developed."
            value={form.description}
            onChange={setField("description")}
          />

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">Criteria</span>
              <Button variant="secondary" size="sm" onClick={addCriterion}>
                Add criterion
              </Button>
            </div>

            <div className="space-y-4">
              {form.criteria.map((c, idx) => {
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-line bg-canvas/50 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                        Criterion {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCriterion(idx)}
                        className="text-xs text-muted hover:text-danger transition-colors"
                        aria-label={`Remove criterion ${idx + 1}`}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Input
                        label="Key"
                        placeholder="e.g. rapport"
                        value={c.key}
                        disabled={!!c._existing}
                        onChange={(e) => setCriterionField(idx, "key", e.target.value)}
                      />
                      <div className="sm:col-span-2">
                        <Input
                          label="Label"
                          placeholder="e.g. Rapport & Opening"
                          value={c.label}
                          onChange={(e) => setCriterionField(idx, "label", e.target.value)}
                        />
                      </div>
                    </div>

                    <Input
                      label="Weight (%)"
                      type="number"
                      placeholder="e.g. 15"
                      value={c.weight}
                      onChange={(e) => setCriterionField(idx, "weight", e.target.value)}
                    />

                    <div className="space-y-2">
                      <span className="block text-xs font-medium text-muted">Anchors</span>
                      {ANCHOR_LABELS.map(({ level, label }) => (
                        <Textarea
                          key={level}
                          label={label}
                          rows={2}
                          placeholder={`What does level ${level} look like?`}
                          value={c.anchors[level]}
                          onChange={(e) => setCriterionAnchor(idx, level, e.target.value)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Live weight sum footer */}
            <div
              className={`mt-3 rounded-xl px-3.5 py-2.5 text-sm font-medium border ${
                sumOk
                  ? "border-success/30 bg-success-soft text-success"
                  : "border-danger/30 bg-danger-soft text-danger"
              }`}
            >
              &Sigma; weights = {liveSum}
              {sumOk ? " ✓" : " (must equal 100)"}
            </div>
          </div>

          {formError && (
            <div className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              {formError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
