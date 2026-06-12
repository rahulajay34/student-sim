// Admin page: Prompts & Scoring — two-tab view for editing prompt scaffolding
// and scoring calibration. Admin-only (enforced by route guard in main.jsx).
// Includes a live preview of the scoring prompt, guidelines as callouts, and
// Save (optimistic with error toast) + Restore (re-GET) per tab.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import Card, { CardHeader } from "../../ui/Card";
import Button from "../../ui/Button";
import Spinner from "../../ui/Spinner";
import Textarea from "../../ui/Textarea";
import Input from "../../ui/Input";
import Badge from "../../ui/Badge";

// ─── helpers ────────────────────────────────────────────────────────────────

function Toast({ msg, color = "success", onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const bg =
    color === "danger"
      ? "border-danger/30 bg-danger-soft text-danger"
      : "border-success/30 bg-success-soft text-success";
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg ${bg}`}
    >
      {msg}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-1 opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}

// A collapsible callout for a single guideline string.
function GuidelineCallout({ text }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
      <span className="mr-1.5 font-semibold">Tip:</span>
      {text}
    </div>
  );
}

function GuidelinesBlock({ guidelines = [] }) {
  if (!guidelines.length) return null;
  return (
    <div className="space-y-2">
      {guidelines.map((g, i) => (
        <GuidelineCallout key={i} text={g} />
      ))}
    </div>
  );
}

// Monospace read-only block with copy button.
function CodeBlock({ value, label }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value || "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        {label && <SectionLabel>{label}</SectionLabel>}
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-canvas p-4 font-mono text-xs leading-relaxed text-ink/80">
        {value || "—"}
      </pre>
    </div>
  );
}

// ─── shared utils ────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ─── Tab: Prompt scaffolding ─────────────────────────────────────────────────

const PHASE_LABELS = {
  1: "Phase 1 — Opening",
  2: "Phase 2 — Discovery",
  3: "Phase 3 — Presentation",
  4: "Phase 4 — Objections & Negotiation",
  5: "Phase 5 — Close",
};

function PromptTab({ initialConfig, onSave }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sync form from props when config first arrives or is restored.
  useEffect(() => {
    if (initialConfig) {
      setForm(deepClone(initialConfig));
      setDirty(false);
    }
  }, [initialConfig]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function setNested(key, subKey, value) {
    setForm((f) => ({ ...f, [key]: { ...(f[key] || {}), [subKey]: value } }));
    setDirty(true);
  }

  function setGuidelineItem(i, value) {
    setForm((f) => {
      const arr = [...(f.guidelines || [])];
      arr[i] = value;
      return { ...f, guidelines: arr };
    });
    setDirty(true);
  }

  function addGuideline() {
    setForm((f) => ({ ...f, guidelines: [...(f.guidelines || []), ""] }));
    setDirty(true);
  }

  function removeGuideline(i) {
    setForm((f) => {
      const arr = [...(f.guidelines || [])];
      arr.splice(i, 1);
      return { ...f, guidelines: arr };
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await onSave(form);
      setForm(deepClone(updated));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function handleRestore() {
    setForm(deepClone(initialConfig));
    setDirty(false);
  }

  if (!form) return null;

  return (
    <div className="space-y-6">
      {/* General profile */}
      <Card className="p-5">
        <CardHeader
          title="General student profile"
          subtitle="Applied to every persona — describes the student's base mindset and guard."
        />
        <Textarea
          label="generalProfile"
          rows={6}
          value={form.generalProfile || ""}
          onChange={(e) => set("generalProfile", e.target.value)}
        />
      </Card>

      {/* Knowledge bounds */}
      <Card className="p-5">
        <CardHeader
          title="Knowledge bounds template"
          subtitle='Template injected as "WHAT YOU KNOW" — use {identity} placeholder for the course-specific identity sentence.'
        />
        <Textarea
          label="knowledgeBoundsTemplate"
          rows={6}
          value={form.knowledgeBoundsTemplate || ""}
          onChange={(e) => set("knowledgeBoundsTemplate", e.target.value)}
        />
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Textarea
            label="knowledgeIdentityWithCourse — uses {title}, {institute}, {durationClause}"
            rows={3}
            value={form.knowledgeIdentityWithCourse || ""}
            onChange={(e) => set("knowledgeIdentityWithCourse", e.target.value)}
          />
          <Textarea
            label="knowledgeIdentityFallback — no course available"
            rows={3}
            value={form.knowledgeIdentityFallback || ""}
            onChange={(e) => set("knowledgeIdentityFallback", e.target.value)}
          />
        </div>
      </Card>

      {/* Phase instructions */}
      <Card className="p-5">
        <CardHeader
          title="Phase instructions"
          subtitle="Injected as the current-phase directive. Each maps to one of the 5 simulation phases."
        />
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((ph) => (
            <Textarea
              key={ph}
              label={PHASE_LABELS[ph]}
              rows={4}
              value={(form.phaseInstructions || {})[ph] || ""}
              onChange={(e) => setNested("phaseInstructions", ph, e.target.value)}
            />
          ))}
        </div>
      </Card>

      {/* Phase ladder */}
      <Card className="p-5">
        <CardHeader
          title="Phase ladder summary"
          subtitle="A compact cheat-sheet of all 5 phases shown near the top of the system prompt."
        />
        <Textarea
          label="phaseLadder"
          rows={8}
          value={form.phaseLadder || ""}
          onChange={(e) => set("phaseLadder", e.target.value)}
        />
      </Card>

      {/* Behaviour rules */}
      <Card className="p-5">
        <CardHeader
          title="General behaviour rules"
          subtitle="The GENERAL BEHAVIOUR RULES block — reply length, question cadence, repetition rule, language matching."
        />
        <Textarea
          label="behaviourRules"
          rows={8}
          value={form.behaviourRules || ""}
          onChange={(e) => set("behaviourRules", e.target.value)}
        />
      </Card>

      {/* Register note */}
      <Card className="p-5">
        <CardHeader
          title="Register note"
          subtitle='Injected as "HOW YOU TALK" — language policy (Indian English, light Hindi particles only), filler words, reply length norms. Keep consistent with behaviourRules and naturalSpeech.'
        />
        <Textarea
          label="registerNote"
          rows={5}
          value={form.registerNote || ""}
          onChange={(e) => set("registerNote", e.target.value)}
        />
      </Card>

      {/* FAQ framing */}
      <Card className="p-5">
        <CardHeader
          title="FAQ framing"
          subtitle="Intro + usage rules shown before the injected FAQ topic list."
        />
        <div className="space-y-4">
          <Textarea
            label='faqIntro — uses {title} placeholder for the course name'
            rows={2}
            value={form.faqIntro || ""}
            onChange={(e) => set("faqIntro", e.target.value)}
          />
          <Textarea
            label="faqUsage"
            rows={5}
            value={form.faqUsage || ""}
            onChange={(e) => set("faqUsage", e.target.value)}
          />
        </div>
      </Card>

      {/* Turn discipline */}
      <Card className="p-5">
        <CardHeader
          title="Turn-discipline rules"
          subtitle="Per-turn overrides injected at the end of the system prompt based on the classified counsellor turn type."
        />
        <div className="space-y-4">
          {Object.entries(form.turnDiscipline || {}).map(([key, val]) => (
            <Textarea
              key={key}
              label={key}
              rows={key.startsWith("invite") ? 3 : 3}
              value={val || ""}
              onChange={(e) => setNested("turnDiscipline", key, e.target.value)}
            />
          ))}
        </div>
      </Card>

      {/* Guidelines */}
      <Card className="p-5">
        <CardHeader
          title="Editing guidelines"
          subtitle="Plain-English tips shown as callouts in the admin UI to help future editors."
          action={
            <Button variant="secondary" size="sm" onClick={addGuideline}>
              Add guideline
            </Button>
          }
        />
        {(form.guidelines || []).length === 0 ? (
          <p className="text-sm text-muted">No guidelines yet. Add some to help future editors.</p>
        ) : (
          <div className="space-y-3">
            {(form.guidelines || []).map((g, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    value={g}
                    placeholder={`Guideline ${i + 1}`}
                    onChange={(e) => setGuidelineItem(i, e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeGuideline(i)}
                  className="mt-0.5 shrink-0 rounded-lg px-2 py-2 text-xs text-muted transition-colors hover:bg-canvas hover:text-danger"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        {(form.guidelines || []).length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-muted">Preview</div>
            <GuidelinesBlock guidelines={form.guidelines || []} />
          </div>
        )}
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={handleRestore}
          disabled={saving || !dirty}
        >
          Discard changes
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Spinner size={16} className="text-white" />}
          Save prompt config
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: Scoring calibration ────────────────────────────────────────────────

const SCORING_PHASE_LABELS = {
  1: "Phase 1 — Opening",
  2: "Phase 2 — Discovery",
  3: "Phase 3 — Presentation",
  4: "Phase 4 — Objections & Negotiation",
  5: "Phase 5 — Close",
};

function ScoringTab({ initialConfig, onSave, livePrompt }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (initialConfig) {
      setForm(JSON.parse(JSON.stringify(initialConfig)));
      setDirty(false);
    }
  }, [initialConfig]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function setNestedBool(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function setPhaseExp(phase, value) {
    setForm((f) => ({
      ...f,
      phaseExpectations: { ...(f.phaseExpectations || {}), [phase]: value },
    }));
    setDirty(true);
  }

  function setBandField(i, field, value) {
    setForm((f) => {
      const arr = [...(f.severityBands || [])];
      arr[i] = { ...arr[i], [field]: value };
      return { ...f, severityBands: arr };
    });
    setDirty(true);
  }

  function setCounterMoveItem(type, i, value) {
    setForm((f) => {
      const arr = [...((f.counterMoves || {})[type] || [])];
      arr[i] = value;
      return { ...f, counterMoves: { ...(f.counterMoves || {}), [type]: arr } };
    });
    setDirty(true);
  }

  function addCounterMove(type) {
    setForm((f) => {
      const arr = [...((f.counterMoves || {})[type] || []), ""];
      return { ...f, counterMoves: { ...(f.counterMoves || {}), [type]: arr } };
    });
    setDirty(true);
  }

  function removeCounterMove(type, i) {
    setForm((f) => {
      const arr = [...((f.counterMoves || {})[type] || [])];
      arr.splice(i, 1);
      return { ...f, counterMoves: { ...(f.counterMoves || {}), [type]: arr } };
    });
    setDirty(true);
  }

  function setBackchannelWords(value) {
    const words = value
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    setForm((f) => ({ ...f, backchannelWords: words }));
    setDirty(true);
  }

  function setGuidelineItem(i, value) {
    setForm((f) => {
      const arr = [...(f.guidelines || [])];
      arr[i] = value;
      return { ...f, guidelines: arr };
    });
    setDirty(true);
  }

  function addGuideline() {
    setForm((f) => ({ ...f, guidelines: [...(f.guidelines || []), ""] }));
    setDirty(true);
  }

  function removeGuideline(i) {
    setForm((f) => {
      const arr = [...(f.guidelines || [])];
      arr.splice(i, 1);
      return { ...f, guidelines: arr };
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await onSave(form);
      setForm(JSON.parse(JSON.stringify(updated)));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function handleRestore() {
    setForm(JSON.parse(JSON.stringify(initialConfig)));
    setDirty(false);
  }

  if (!form) return null;

  return (
    <div className="space-y-6">
      {/* Live scoring prompt preview */}
      {livePrompt && (
        <Card className="p-5">
          <CardHeader
            title="Live scoring prompt preview"
            subtitle="The scoring prompt the LLM currently sees for the most recent session found. Updates after Save."
          />
          <CodeBlock value={livePrompt} label="scoringPrompt" />
        </Card>
      )}

      {/* General knobs */}
      <Card className="p-5">
        <CardHeader
          title="General knobs"
          subtitle="High-level leniency switches."
        />
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="neverPenalizeAbsence"
              checked={!!form.neverPenalizeAbsence}
              onChange={(e) => setNestedBool("neverPenalizeAbsence", e.target.checked)}
              className="h-4 w-4 rounded border-line accent-brand-600"
            />
            <label htmlFor="neverPenalizeAbsence" className="text-sm font-medium text-ink">
              neverPenalizeAbsence — do not deduct for missing a checklist item; only reward or penalize based on what was said
            </label>
          </div>
          <Input
            label="recentTurnsWindow — number of recent turns passed to the scoring LLM (default 6)"
            type="number"
            min={1}
            max={20}
            value={form.recentTurnsWindow ?? 6}
            onChange={(e) => set("recentTurnsWindow", parseInt(e.target.value, 10) || 6)}
          />
        </div>
      </Card>

      {/* Backchannel words */}
      <Card className="p-5">
        <CardHeader
          title="Backchannel words"
          subtitle="Messages matching (after normalization) any of these words/phrases skip the scoring LLM entirely (adjustment = 0). Comma-separated list."
        />
        <Textarea
          label="backchannelWords (comma-separated)"
          rows={4}
          value={(form.backchannelWords || []).join(", ")}
          onChange={(e) => setBackchannelWords(e.target.value)}
        />
        <p className="mt-2 text-xs text-muted">
          {(form.backchannelWords || []).length} words currently configured.
        </p>
      </Card>

      {/* Severity bands */}
      <Card className="p-5">
        <CardHeader
          title="Severity bands"
          subtitle="Score-range labels and per-range guidance injected into the scoring prompt."
        />
        <div className="space-y-4">
          {(form.severityBands || []).map((band, i) => (
            <div
              key={i}
              className="rounded-xl border border-line bg-canvas/50 p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Badge color="slate">Band {i + 1}</Badge>
                <span className="text-xs font-mono text-muted">{band.range}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="range"
                  value={band.range || ""}
                  onChange={(e) => setBandField(i, "range", e.target.value)}
                />
                <Input
                  label="label"
                  value={band.label || ""}
                  onChange={(e) => setBandField(i, "label", e.target.value)}
                />
              </div>
              <Textarea
                label="guidance"
                rows={3}
                value={band.guidance || ""}
                onChange={(e) => setBandField(i, "guidance", e.target.value)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Phase expectations */}
      <Card className="p-5">
        <CardHeader
          title="Phase expectations"
          subtitle="Per-phase context injected into the scoring prompt — what good and bad look like at each stage."
        />
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((ph) => (
            <Textarea
              key={ph}
              label={SCORING_PHASE_LABELS[ph]}
              rows={4}
              value={(form.phaseExpectations || {})[ph] || ""}
              onChange={(e) => setPhaseExp(ph, e.target.value)}
            />
          ))}
        </div>
      </Card>

      {/* Counter-moves */}
      <Card className="p-5">
        <CardHeader
          title="Counter-moves"
          subtitle="Concrete moves that reward or penalize counsellors, grounded in real converting calls."
        />
        {["reward", "penalize"].map((type) => (
          <div key={type} className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge color={type === "reward" ? "success" : "danger"}>
                  {type === "reward" ? "Reward" : "Penalize"}
                </Badge>
                <span className="text-xs text-muted">
                  {(form.counterMoves?.[type] || []).length} entries
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => addCounterMove(type)}
              >
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {((form.counterMoves || {})[type] || []).map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1">
                    <Input
                      value={item}
                      placeholder={`${type} move ${i + 1}`}
                      onChange={(e) => setCounterMoveItem(type, i, e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCounterMove(type, i)}
                    className="mt-0.5 shrink-0 rounded-lg px-2 py-2 text-xs text-muted transition-colors hover:bg-canvas hover:text-danger"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>

      {/* Guidelines */}
      <Card className="p-5">
        <CardHeader
          title="Editing guidelines"
          subtitle="Plain-English tips shown as callouts next to the scoring config."
          action={
            <Button variant="secondary" size="sm" onClick={addGuideline}>
              Add guideline
            </Button>
          }
        />
        {(form.guidelines || []).length === 0 ? (
          <p className="text-sm text-muted">No guidelines yet.</p>
        ) : (
          <div className="space-y-3">
            {(form.guidelines || []).map((g, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <Input
                    value={g}
                    placeholder={`Guideline ${i + 1}`}
                    onChange={(e) => setGuidelineItem(i, e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeGuideline(i)}
                  className="mt-0.5 shrink-0 rounded-lg px-2 py-2 text-xs text-muted transition-colors hover:bg-canvas hover:text-danger"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        {(form.guidelines || []).length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-muted">Preview</div>
            <GuidelinesBlock guidelines={form.guidelines || []} />
          </div>
        )}
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={handleRestore}
          disabled={saving || !dirty}
        >
          Discard changes
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Spinner size={16} className="text-white" />}
          Save scoring config
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "prompts", label: "Prompt scaffolding" },
  { id: "scoring", label: "Scoring calibration" },
];

export default function Prompts() {
  const [activeTab, setActiveTab] = useState("prompts");

  const [promptConfig, setPromptConfig] = useState(null);
  const [scoringConfig, setScoringConfig] = useState(null);
  const [livePrompts, setLivePrompts] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null); // {msg, color}
  const [loadKey, setLoadKey] = useState(0); // increment to retry

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const [pc, sc] = await Promise.all([
          api.getPromptConfig(),
          api.getScoringConfig(),
        ]);
        if (!active) return;
        setPromptConfig(pc);
        setScoringConfig(sc);

        // Best-effort: fetch a recent session to show the live scoring prompt.
        try {
          const reports = await api.getReports();
          if (!active) return;
          if (Array.isArray(reports) && reports.length > 0) {
            // getReports returns Report objects which have sessionId.
            const r = reports[reports.length - 1];
            if (r.sessionId) {
              const prompts = await api.getSessionPrompts(r.sessionId);
              if (active) setLivePrompts(prompts);
            }
          }
        } catch {
          // live prompts are bonus; ignore
        }
      } catch (e) {
        if (active) setError(e.message || "Failed to load configuration.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [loadKey]);

  async function handleSavePrompts(form) {
    try {
      const updated = await api.updatePromptConfig(form);
      setPromptConfig(updated);
      setToast({ msg: "Prompt config saved.", color: "success" });
      return updated;
    } catch (e) {
      setToast({ msg: e.message || "Failed to save prompt config.", color: "danger" });
      throw e;
    }
  }

  async function handleSaveScoring(form) {
    try {
      const updated = await api.updateScoringConfig(form);
      setScoringConfig(updated);
      setToast({ msg: "Scoring config saved.", color: "success" });
      return updated;
    } catch (e) {
      setToast({ msg: e.message || "Failed to save scoring config.", color: "danger" });
      throw e;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-ink">Prompts &amp; Scoring</h2>
        <p className="mt-1 text-sm text-muted">
          Edit the student prompt scaffolding and scoring calibration. Changes take effect on the
          next session message. Config is persisted to{" "}
          <code className="rounded bg-canvas px-1 py-0.5 font-mono text-xs">
            server/data/prompt-config.json
          </code>{" "}
          and{" "}
          <code className="rounded bg-canvas px-1 py-0.5 font-mono text-xs">
            server/data/scoring-config.json
          </code>
          .
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

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={28} />
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex gap-1 rounded-2xl border border-line bg-white p-1 shadow-sm">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-muted hover:bg-canvas hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Guidelines from the active config shown at the top as a callout block */}
          {activeTab === "prompts" && promptConfig?.guidelines?.length > 0 && (
            <Card className="p-4">
              <CardHeader title="Editing tips" subtitle="From the stored guidelines array." />
              <GuidelinesBlock guidelines={promptConfig.guidelines} />
            </Card>
          )}
          {activeTab === "scoring" && scoringConfig?.guidelines?.length > 0 && (
            <Card className="p-4">
              <CardHeader title="Editing tips" subtitle="From the stored guidelines array." />
              <GuidelinesBlock guidelines={scoringConfig.guidelines} />
            </Card>
          )}

          {activeTab === "prompts" && (
            <PromptTab
              initialConfig={promptConfig}
              onSave={handleSavePrompts}
            />
          )}
          {activeTab === "scoring" && (
            <ScoringTab
              initialConfig={scoringConfig}
              onSave={handleSaveScoring}
              livePrompt={livePrompts?.scoringPrompt}
            />
          )}
        </>
      )}

      {/* Persistent live region: AT only announces content placed into a region
          that already existed in the DOM, so the wrapper always renders. */}
      <div aria-live="polite">
        {toast && (
          <Toast msg={toast.msg} color={toast.color} onDismiss={dismissToast} />
        )}
      </div>
    </div>
  );
}
