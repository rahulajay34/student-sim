// Admin page: Integrity Probes — manage the list of fact-checking traps
// embedded silently in sessions and graded in the report.
//
// ADMIN-ONLY. These probes are "integrity traps" — factual claims counsellors
// might mis-sell (fees, deadlines, placement stats, etc.). They are NEVER shown
// to the counsellor being graded. Grading results appear in the admin-only
// "Integrity check" card on the report detail page.
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../ui/Toast";
import Card, { CardHeader } from "../../ui/Card";
import Button from "../../ui/Button";
import Spinner from "../../ui/Spinner";
import Textarea from "../../ui/Textarea";
import Input from "../../ui/Input";
import Badge from "../../ui/Badge";

// ─── helpers ─────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function emptyProbe() {
  return { question: "", groundTruth: "", category: "", active: true };
}

// ─── single probe row ─────────────────────────────────────────────────────────

function ProbeRow({ probe, index, onChange, onRemove }) {
  function set(field, value) {
    onChange(index, { ...probe, [field]: value });
  }

  return (
    <div className="rounded-xl border border-line bg-canvas/60 p-4 space-y-3">
      {/* Row header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge color={probe.active ? "success" : "slate"}>
            {probe.active ? "Active" : "Disabled"}
          </Badge>
          {probe.category && (
            <Badge color="brand">{probe.category}</Badge>
          )}
          <span className="text-xs text-muted font-mono">#{index + 1}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Active toggle */}
          <button
            type="button"
            onClick={() => set("active", !probe.active)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
              probe.active
                ? "border-success/40 bg-success-soft/40 text-success hover:bg-success-soft"
                : "border-line bg-canvas text-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            {probe.active ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-canvas hover:text-danger"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Category */}
      <Input
        label="Category"
        placeholder="e.g. fees, placement, curriculum, deadline"
        value={probe.category || ""}
        onChange={(e) => set("category", e.target.value)}
      />

      {/* Probe question */}
      <Textarea
        label="Probe question — what the LLM asks when grading this trap"
        placeholder="e.g. Did the counsellor correctly state the programme fee as ₹1.2L?"
        rows={3}
        value={probe.question || ""}
        onChange={(e) => set("question", e.target.value)}
      />

      {/* Ground truth */}
      <Textarea
        label="Ground truth — the correct factual answer the counsellor should give"
        placeholder="e.g. The correct fee is ₹1,20,000 (no additional hidden charges)."
        rows={3}
        value={probe.groundTruth || ""}
        onChange={(e) => set("groundTruth", e.target.value)}
      />
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function IntegrityProbes() {
  const { pushToast } = useToast();

  const [probes, setProbes] = useState(null); // null = loading
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [loadKey, setLoadKey] = useState(0);

  // Track the last server-saved state so we can discard changes.
  const [savedProbes, setSavedProbes] = useState(null);

  useEffect(() => {
    let active = true;
    setError("");
    setDirty(false);
    setProbes(null);

    api
      .getIntegrityProbes()
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data?.probes) ? deepClone(data.probes) : [];
        setProbes(list);
        setSavedProbes(deepClone(list));
      })
      .catch((e) => {
        if (active) setError(e.message || "Failed to load integrity probes.");
      });

    return () => {
      active = false;
    };
  }, [loadKey]);

  function handleChange(index, updated) {
    setProbes((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
    setDirty(true);
  }

  function handleAdd() {
    setProbes((prev) => [...prev, emptyProbe()]);
    setDirty(true);
  }

  function handleRemove(index) {
    setProbes((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  function handleDiscard() {
    setProbes(deepClone(savedProbes));
    setDirty(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateIntegrityProbes({ probes, guidelines: [] });
      const list = Array.isArray(updated?.probes) ? deepClone(updated.probes) : deepClone(probes);
      setProbes(list);
      setSavedProbes(deepClone(list));
      setDirty(false);
      pushToast("Integrity probes saved.", { tone: "success", variant: "light" });
    } catch (e) {
      pushToast(e.message || "Failed to save integrity probes.", { tone: "danger", variant: "light" });
    } finally {
      setSaving(false);
    }
  }

  const activeCount = Array.isArray(probes) ? probes.filter((p) => p.active).length : 0;
  const totalCount = Array.isArray(probes) ? probes.length : 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-semibold text-ink">Integrity Probes</h2>
        <p className="mt-1 text-sm text-muted">
          Fact-checking traps embedded silently in sessions. The LLM grades whether the counsellor lied,
          overpromised, evaded, or answered honestly — results appear only in the admin report card and
          are <strong>never shown</strong> to the counsellor being graded.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setLoadKey((k) => k + 1)}
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {probes === null && !error ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={28} />
        </div>
      ) : probes !== null ? (
        <>
          {/* Summary card */}
          <Card className="p-5">
            <CardHeader
              title="Probe library"
              subtitle={`${activeCount} active / ${totalCount} total probes`}
              action={
                <Button variant="secondary" size="sm" onClick={handleAdd}>
                  Add probe
                </Button>
              }
            />

            {totalCount === 0 ? (
              <p className="mt-2 text-sm text-muted">
                No probes yet. Click "Add probe" to create the first one.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {probes.map((probe, i) => (
                  <ProbeRow
                    key={i}
                    probe={probe}
                    index={i}
                    onChange={handleChange}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Action bar */}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="secondary"
              onClick={handleDiscard}
              disabled={saving || !dirty}
            >
              Discard changes
            </Button>
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving && <Spinner size={16} className="text-white" />}
              Save probes
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
