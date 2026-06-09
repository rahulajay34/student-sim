import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth.jsx";
import Card from "../../ui/Card";
import Button from "../../ui/Button";
import Input from "../../ui/Input";
import Textarea from "../../ui/Textarea";
import Select from "../../ui/Select";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import Badge from "../../ui/Badge";
import Avatar from "../../ui/Avatar";

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

// Small section heading used to break the long form into labelled blocks.
function Section({ step, title, hint, children }) {
  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
          {step}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
        </div>
      </div>
      <div className="space-y-4 pl-10">{children}</div>
    </section>
  );
}

export default function AssignmentCreate() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [counsellors, setCounsellors] = useState([]);
  const [personas, setPersonas] = useState([]);

  const [counsellorId, setCounsellorId] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [situation, setSituation] = useState("");
  const [contextNotes, setContextNotes] = useState("");

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setLoadError("");
        const [cs, ps] = await Promise.all([api.getCounsellors(), api.getPersonas()]);
        if (!active) return;
        setCounsellors(cs || []);
        setPersonas(ps || []);
      } catch (e) {
        if (active) setLoadError(e.message || "Failed to load data.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === personaId) || null,
    [personas, personaId]
  );
  const selectedCounsellor = useMemo(
    () => counsellors.find((c) => c.id === counsellorId) || null,
    [counsellors, counsellorId]
  );

  function handlePersonaChange(id) {
    setPersonaId(id);
    setErrors((prev) => ({ ...prev, personaId: undefined }));
    const persona = personas.find((p) => p.id === id);
    // Prefill the editable prompt with the persona's behaviour prompt for this mock.
    setPersonaPrompt(persona?.behaviourPrompt || "");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");

    const nextErrors = {};
    if (!counsellorId) nextErrors.counsellorId = "Select a counsellor.";
    if (!personaId) nextErrors.personaId = "Select a persona.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const original = (selectedPersona?.behaviourPrompt || "").trim();
    const edited = personaPrompt.trim();
    const personaPromptOverride = edited && edited !== original ? edited : null;

    try {
      setSubmitting(true);
      await api.createAssignment({
        counsellorId,
        personaId,
        personaPromptOverride,
        scenario: {
          title: title.trim(),
          difficulty,
          situation: situation.trim(),
          contextNotes: contextNotes.trim(),
        },
        createdBy: user?.id,
      });
      navigate("/admin/assignments");
    } catch (err) {
      setSubmitError(err.message || "Failed to assign mock.");
      setSubmitting(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} />
      </div>
    );
  }

  const noData = counsellors.length === 0 || personas.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          to="/admin/assignments"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Assignments
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">Assign a mock</h1>
        <p className="mt-1 text-sm text-muted">
          Pair a counsellor with a student persona and a scenario to practise against.
        </p>
      </div>

      {loadError ? (
        <Card className="p-6">
          <EmptyState
            title="Couldn't load assignment data"
            hint={loadError}
            action={
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : noData ? (
        <Card className="p-6">
          <EmptyState
            title="Missing prerequisites"
            hint={
              counsellors.length === 0
                ? "There are no counsellors yet. Add a counsellor before assigning a mock."
                : "There are no personas yet. Create a persona before assigning a mock."
            }
            action={
              <Button
                as={Link}
                to={counsellors.length === 0 ? "/admin/counsellors" : "/admin/personas"}
                variant="primary"
              >
                {counsellors.length === 0 ? "Go to counsellors" : "Go to personas"}
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            {/* 1. Counsellor */}
            <Section
              step="1"
              title="Counsellor"
              hint="Who will be running this practice call?"
            >
              <Select
                label="Assign to"
                placeholder="Select a counsellor…"
                value={counsellorId}
                error={errors.counsellorId}
                onChange={(e) => {
                  setCounsellorId(e.target.value);
                  setErrors((prev) => ({ ...prev, counsellorId: undefined }));
                }}
                options={counsellors.map((c) => ({ value: c.id, label: c.name }))}
              />
              {selectedCounsellor && (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-3.5 py-3">
                  <Avatar name={selectedCounsellor.name} color={selectedCounsellor.avatarColor} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{selectedCounsellor.name}</div>
                    {selectedCounsellor.email && (
                      <div className="truncate text-xs text-muted">{selectedCounsellor.email}</div>
                    )}
                  </div>
                </div>
              )}
            </Section>

            <div className="border-t border-line" />

            {/* 2. Persona */}
            <Section
              step="2"
              title="Student persona"
              hint="The roleplayed student. You can tweak the behaviour prompt just for this mock."
            >
              <Select
                label="Persona"
                placeholder="Select a persona…"
                value={personaId}
                error={errors.personaId}
                onChange={(e) => handlePersonaChange(e.target.value)}
                options={personas.map((p) => ({
                  value: p.id,
                  label: p.label ? `${p.name} — ${p.label}` : p.name,
                }))}
              />

              {selectedPersona && (
                <div className="flex flex-wrap items-center gap-2">
                  {selectedPersona.category && <Badge color="brand">{selectedPersona.category}</Badge>}
                  {selectedPersona.coreAnxiety && (
                    <span className="text-xs text-muted">
                      Core anxiety: <span className="text-ink">{selectedPersona.coreAnxiety}</span>
                    </span>
                  )}
                </div>
              )}

              {personaId && (
                <Textarea
                  label="Persona prompt (editable for this mock)"
                  rows={6}
                  value={personaPrompt}
                  onChange={(e) => setPersonaPrompt(e.target.value)}
                  placeholder="How the student should behave during this call…"
                />
              )}
            </Section>

            <div className="border-t border-line" />

            {/* 3. Scenario */}
            <Section
              step="3"
              title="Scenario"
              hint="The situation the counsellor walks into when the call begins."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Scenario title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Hesitant about the fees"
                />
                <Select
                  label="Difficulty"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  options={DIFFICULTY_OPTIONS}
                />
              </div>

              <Textarea
                label="Situation"
                rows={4}
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                placeholder="Describe the student's current situation as the call opens…"
              />

              <Textarea
                label="Extra context"
                rows={3}
                value={contextNotes}
                onChange={(e) => setContextNotes(e.target.value)}
                placeholder="Optional — any background that should inform the roleplay."
              />
            </Section>

            {submitError && (
              <div className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
                {submitError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-line pt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate("/admin/assignments")}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting && <Spinner size={16} className="text-white" />}
                {submitting ? "Assigning…" : "Assign mock"}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
