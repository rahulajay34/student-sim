import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import Button from "../../ui/Button";
import Card from "../../ui/Card";
import Badge from "../../ui/Badge";
import Modal from "../../ui/Modal";
import Input from "../../ui/Input";
import Textarea from "../../ui/Textarea";
import Select from "../../ui/Select";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";

const CATEGORY_OPTIONS = [
  { value: "studying", label: "Currently studying" },
  { value: "graduate", label: "Recent graduate" },
  { value: "same-field", label: "Working — same field" },
  { value: "diff-field", label: "Working — different field" },
  { value: "non-working", label: "Non-working" },
  { value: "custom", label: "Custom" },
];

const CATEGORY_LABEL = CATEGORY_OPTIONS.reduce((acc, o) => {
  acc[o.value] = o.label;
  return acc;
}, {});

const DEFAULT_PERSONALITY = {
  talkativeness: 2,
  humour: 2,
  skepticism: 3,
  formality: 2,
  quirks: [],
  notes: "",
};

const TRAIT_LABELS = {
  talkativeness: { label: "Talkativeness", lo: "Terse", hi: "Chatty" },
  humour: { label: "Humour", lo: "Serious", hi: "Playful" },
  skepticism: { label: "Skepticism", lo: "Open", hi: "Hard-to-convince" },
  formality: { label: "Formality", lo: "Casual / Hinglish", hi: "Polished English" },
};

const EMPTY_FORM = {
  name: "",
  category: "studying",
  label: "",
  description: "",
  coreAnxiety: "",
  behaviourPrompt: "",
  personality: { ...DEFAULT_PERSONALITY, quirks: [] },
};

// ── Trait slider (1-5 segmented control) ─────────────────────────────────────
function TraitSlider({ trait, value, onChange }) {
  const { label, lo, hi } = TRAIT_LABELS[trait];
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs font-semibold text-brand-600">{value}</span>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
              n === value
                ? "bg-brand-600 text-white"
                : n < value
                ? "bg-brand-100 text-brand-700"
                : "bg-canvas text-muted hover:bg-brand-50 hover:text-brand-600"
            }`}
            aria-pressed={n === value}
            aria-label={`${label} ${n}`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}

// ── Quirk tag-input ───────────────────────────────────────────────────────────
function QuirksInput({ quirks, onChange }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  function commit() {
    const text = draft.trim();
    if (!text) return;
    if (!quirks.includes(text)) {
      onChange([...quirks, text]);
    }
    setDraft("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && quirks.length > 0) {
      onChange(quirks.slice(0, -1));
    }
  }

  function removeQuirk(idx) {
    onChange(quirks.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">Quirks</span>
      <div
        className="flex min-h-[2.75rem] flex-wrap gap-1.5 rounded-xl border border-line bg-white px-3 py-2 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {quirks.map((q, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700"
          >
            {q}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeQuirk(i); }}
              className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-brand-400 hover:bg-brand-200 hover:text-brand-700 transition-colors"
              aria-label={`Remove quirk: ${q}`}
            >
              <svg viewBox="0 0 12 12" fill="currentColor" className="h-2 w-2" aria-hidden="true">
                <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder={quirks.length === 0 ? "Type a quirk and press Enter…" : "Add another…"}
          className="min-w-[12ch] flex-1 border-none bg-transparent text-sm text-ink placeholder:text-muted outline-none"
        />
      </div>
      <p className="mt-1 text-xs text-muted">Press Enter or comma to add. Backspace removes the last chip.</p>
    </div>
  );
}

// ── Compact personality summary line ─────────────────────────────────────────
function PersonalitySummary({ personality }) {
  const p = personality && typeof personality === "object" ? personality : DEFAULT_PERSONALITY;
  const talk = p.talkativeness ?? DEFAULT_PERSONALITY.talkativeness;
  const skep = p.skepticism ?? DEFAULT_PERSONALITY.skepticism;
  const form = p.formality ?? DEFAULT_PERSONALITY.formality;
  const humour = p.humour ?? DEFAULT_PERSONALITY.humour;
  const quirks = Array.isArray(p.quirks) ? p.quirks : [];

  const talkLabel = talk <= 1 ? "Very terse" : talk === 2 ? "Terse" : talk === 3 ? "Moderate" : talk === 4 ? "Chatty" : "Very chatty";
  const skeptLabel = skep <= 1 ? "Trusting" : skep === 2 ? "Open" : skep === 3 ? "Balanced" : skep === 4 ? "Skeptical" : "Very skeptical";
  const formLabel = form <= 1 ? "Heavy Hinglish" : form === 2 ? "Casual" : form === 3 ? "Neutral" : form === 4 ? "Formal" : "Polished";
  const humourLabel = humour <= 1 ? "No humour" : humour >= 4 ? "Playful" : null;

  const parts = [talkLabel, skeptLabel, formLabel];
  if (humourLabel) parts.push(humourLabel);

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {parts.map((part) => (
        <span
          key={part}
          className="inline-flex items-center rounded-md bg-canvas px-2 py-0.5 text-xs text-muted border border-line"
        >
          {part}
        </span>
      ))}
      {quirks.length > 0 && (
        <span className="inline-flex items-center rounded-md bg-canvas px-2 py-0.5 text-xs text-muted border border-line">
          {quirks.length} quirk{quirks.length !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Personas() {
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // persona being edited, or null for create
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.getPersonas();
      setPersonas(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load personas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, personality: { ...DEFAULT_PERSONALITY, quirks: [] } });
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(persona) {
    setEditing(persona);
    const p = persona.personality && typeof persona.personality === "object"
      ? persona.personality
      : DEFAULT_PERSONALITY;
    setForm({
      name: persona.name || "",
      category: persona.category || "studying",
      label: persona.label || "",
      description: persona.description || "",
      coreAnxiety: persona.coreAnxiety || "",
      behaviourPrompt: persona.behaviourPrompt || "",
      personality: {
        talkativeness: p.talkativeness ?? DEFAULT_PERSONALITY.talkativeness,
        humour: p.humour ?? DEFAULT_PERSONALITY.humour,
        skepticism: p.skepticism ?? DEFAULT_PERSONALITY.skepticism,
        formality: p.formality ?? DEFAULT_PERSONALITY.formality,
        quirks: Array.isArray(p.quirks) ? [...p.quirks] : [],
        notes: p.notes ?? "",
      },
    });
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  const setField = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function setTrait(trait) {
    return (val) =>
      setForm((f) => ({
        ...f,
        personality: { ...f.personality, [trait]: val },
      }));
  }

  function setQuirks(quirks) {
    setForm((f) => ({ ...f, personality: { ...f.personality, quirks } }));
  }

  function setNotes(e) {
    const notes = e.target.value;
    setForm((f) => ({ ...f, personality: { ...f.personality, notes } }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError("Persona name is required.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      name: form.name.trim(),
      category: form.category,
      label: form.label.trim(),
      description: form.description.trim(),
      coreAnxiety: form.coreAnxiety.trim(),
      behaviourPrompt: form.behaviourPrompt.trim(),
      personality: {
        talkativeness: form.personality.talkativeness,
        humour: form.personality.humour,
        skepticism: form.personality.skepticism,
        formality: form.personality.formality,
        quirks: form.personality.quirks.filter(Boolean),
        notes: form.personality.notes.trim(),
      },
    };
    try {
      if (editing) {
        await api.updatePersona(editing.id, payload);
      } else {
        await api.createPersona(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message || "Could not save persona.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(persona) {
    if (!window.confirm(`Delete persona "${persona.name}"? This cannot be undone.`)) return;
    try {
      await api.deletePersona(persona.id);
      await load();
    } catch (err) {
      setError(err.message || "Could not delete persona.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink">Persona library</h2>
          <p className="mt-1 text-sm text-muted">
            Reusable student profiles your counsellors practise against.
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
          New persona
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
      ) : personas.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No personas yet"
            hint="Create your first student persona to start assigning mock counselling calls."
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
                <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-1a6 6 0 0112 0v1" />
              </svg>
            }
            action={<Button onClick={openCreate}>New persona</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {personas.map((persona) => (
            <Card key={persona.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 truncate font-semibold text-ink">{persona.name}</h3>
                <Badge color="brand" className="shrink-0">
                  {CATEGORY_LABEL[persona.category] || persona.category || "Custom"}
                </Badge>
              </div>

              <p className="mt-2 line-clamp-3 text-sm text-muted">
                {persona.description || "No description provided."}
              </p>

              {persona.label && (
                <p className="mt-3 text-xs text-muted">
                  <span className="text-ink/70">You are a student who is</span> {persona.label}
                </p>
              )}

              {/* Personality summary line */}
              <PersonalitySummary personality={persona.personality} />

              <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
                <Button variant="secondary" size="sm" onClick={() => openEdit(persona)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(persona)}>
                  <span className="text-danger">Delete</span>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? "Edit persona" : "New persona"}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size={16} className="text-white" />}
              {editing ? "Save changes" : "Create persona"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Core identity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              placeholder="e.g. Anxious Aarav"
              value={form.name}
              onChange={setField("name")}
            />
            <Select
              label="Category"
              options={CATEGORY_OPTIONS}
              value={form.category}
              onChange={setField("category")}
            />
          </div>

          <Input
            label="Label"
            placeholder="working in a non-tech field and unsure about switching"
            value={form.label}
            onChange={setField("label")}
          />
          <p className="-mt-2 text-xs text-muted">
            Completes the phrase "You are a student who is …".
          </p>

          <Textarea
            label="Description"
            rows={2}
            placeholder="A short summary shown on the persona card."
            value={form.description}
            onChange={setField("description")}
          />

          <Textarea
            label="Core anxiety"
            rows={2}
            placeholder="The underlying fear or hesitation driving this student."
            value={form.coreAnxiety}
            onChange={setField("coreAnxiety")}
          />

          <Textarea
            label="Behaviour prompt"
            rows={6}
            placeholder="Phase-by-phase behaviour the LLM should role-play across the call."
            value={form.behaviourPrompt}
            onChange={setField("behaviourPrompt")}
          />

          {/* Personality section */}
          <div className="rounded-2xl border border-line bg-canvas px-4 py-4 space-y-4">
            <p className="text-sm font-semibold text-ink">Personality traits</p>

            {/* Trait sliders — 2-col grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.keys(TRAIT_LABELS).map((trait) => (
                <TraitSlider
                  key={trait}
                  trait={trait}
                  value={form.personality[trait] ?? DEFAULT_PERSONALITY[trait]}
                  onChange={setTrait(trait)}
                />
              ))}
            </div>

            {/* Quirks tag-input */}
            <QuirksInput
              quirks={form.personality.quirks}
              onChange={setQuirks}
            />

            {/* Notes textarea */}
            <Textarea
              label="Notes"
              rows={2}
              placeholder="Any additional notes about how this persona speaks or behaves…"
              value={form.personality.notes}
              onChange={setNotes}
            />
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
