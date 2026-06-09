import { useEffect, useState } from "react";
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

const EMPTY_FORM = {
  name: "",
  category: "studying",
  label: "",
  description: "",
  coreAnxiety: "",
  behaviourPrompt: "",
};

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
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(persona) {
    setEditing(persona);
    setForm({
      name: persona.name || "",
      category: persona.category || "studying",
      label: persona.label || "",
      description: persona.description || "",
      coreAnxiety: persona.coreAnxiety || "",
      behaviourPrompt: persona.behaviourPrompt || "",
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
