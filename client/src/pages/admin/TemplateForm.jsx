// TemplateForm — controlled form for creating/editing an assignment template.
// Used inside a Modal by Templates.jsx. Props: { initial, onSubmit, submitting, error }.
// Adapted from AssignmentCreate.jsx — same field set, same Tailwind tokens, same
// Section pattern. Counsellor-picker and progress bar are intentionally omitted.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import Input from "../../ui/Input";
import Textarea from "../../ui/Textarea";
import Select from "../../ui/Select";
import SearchableSelect from "../../ui/SearchableSelect";
import Slider from "../../ui/Slider";
import Spinner from "../../ui/Spinner";
import Button from "../../ui/Button";
import Badge from "../../ui/Badge";

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const ARCHETYPE_TO_CATEGORY = {
  studying: "studying",
  graduate: "non-working",
  "same-field": "same-field",
  "diff-field": "diff-field",
  "non-working": "non-working",
};

// Small section heading — mirrors AssignmentCreate's Section component exactly.
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

export default function TemplateForm({ initial = {}, onSubmit, submitting, error }) {
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [personas, setPersonas] = useState([]);
  const [courses, setCourses] = useState([]);
  const [rubricTemplates, setRubricTemplates] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);

  // Form state — initialised from `initial` once on mount.
  const [name, setName] = useState(initial.name || "");
  const [personaId, setPersonaId] = useState(initial.personaId || "");
  const [courseId, setCourseId] = useState(initial.courseId || "");
  const [rubricTemplateId, setRubricTemplateId] = useState(initial.rubricTemplateId || "");
  const [profileId, setProfileId] = useState(initial.profileId || "");
  const [profileChoices, setProfileChoices] = useState([]);
  const [personaPrompt, setPersonaPrompt] = useState(initial.personaPromptOverride ?? "");
  // Track whether the prompt has been manually edited so persona-switch auto-fill
  // only fires when the field is untouched.
  const promptTouchedRef = useRef(initial.personaPromptOverride != null && initial.personaPromptOverride !== "");
  const [revealPersona, setRevealPersona] = useState(initial.revealPersona !== false);
  const sc = initial.scenario || {};
  const [title, setTitle] = useState(sc.title || "");
  const [difficulty, setDifficulty] = useState(sc.difficulty || "medium");
  const [situation, setSituation] = useState(sc.situation || "");
  const [contextNotes, setContextNotes] = useState(sc.contextNotes || "");
  const [pushiness, setPushiness] = useState(sc.pushiness ?? 3);
  const [hesitancy, setHesitancy] = useState(sc.hesitancy ?? 3);

  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    setLoadingMeta(true);
    setLoadError("");
    try {
      const [ps, crs, rts, profs] = await Promise.all([
        api.getPersonas(),
        api.getCourses(true),
        api.getRubricTemplates().catch(() => []),
        api.getLeadProfiles().catch(() => []),
      ]);
      setPersonas(Array.isArray(ps) ? ps : []);
      setCourses(Array.isArray(crs) ? crs : []);
      const rtList = Array.isArray(rts) ? rts : [];
      setRubricTemplates(rtList);
      setAllProfiles(Array.isArray(profs) ? profs : []);

      // Default rubric to the isDefault one when creating a fresh template.
      if (!initial.rubricTemplateId) {
        const def = rtList.find((t) => t.isDefault) || rtList[0];
        if (def) setRubricTemplateId(def.id);
      }
    } catch (e) {
      setLoadError(e?.message || "Failed to load options.");
    } finally {
      setLoadingMeta(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) load(); });
    return () => { cancelled = true; };
  }, [load]);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === personaId) || null,
    [personas, personaId]
  );

  function drawProfiles(persona, profiles) {
    const cat = ARCHETYPE_TO_CATEGORY[persona?.category];
    if (!cat) return [];
    const matching = profiles.filter((p) => p.category === cat);
    const shuffled = [...matching].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 10);
  }

  function handlePersonaChange(id) {
    setPersonaId(id);
    setErrors((prev) => ({ ...prev, personaId: undefined }));
    const persona = personas.find((p) => p.id === id);
    // Prefill persona prompt ONLY when the field hasn't been manually touched.
    if (!promptTouchedRef.current) {
      setPersonaPrompt(persona?.behaviourPrompt || "");
    }
    setProfileId("");
    setSituation("");
    setProfileChoices(drawProfiles(persona, allProfiles));
  }

  function handleProfileChange(id) {
    setProfileId(id);
    const prof = profileChoices.find((p) => p.id === id) || null;
    setSituation(prof ? prof.description : "");
  }

  function handleReshuffle() {
    setProfileId("");
    setSituation("");
    setProfileChoices(drawProfiles(selectedPersona, allProfiles));
  }

  const selectedProfile = profileChoices.find((p) => p.id === profileId) || null;

  function handleSubmit(e) {
    e.preventDefault();
    const nextErrors = {};
    if (!name.trim()) nextErrors.name = "Template name is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // Compute personaPromptOverride: send null when unchanged vs the persona's
    // own prompt (matching AssignmentCreate's "deliberate override" logic).
    const originalPrompt = (selectedPersona?.behaviourPrompt || "").trim();
    const editedPrompt = personaPrompt.trim();
    const personaPromptOverride = promptTouchedRef.current && editedPrompt !== originalPrompt
      ? editedPrompt
      : null;

    onSubmit({
      name: name.trim(),
      personaId: personaId || null,
      courseId: courseId || null,
      rubricTemplateId: rubricTemplateId || null,
      profileId: profileId || null,
      personaPromptOverride,
      revealPersona,
      scenario: {
        title: title.trim(),
        difficulty,
        situation: situation.trim(),
        contextNotes: contextNotes.trim(),
        pushiness,
        hesitancy,
      },
    });
  }

  if (loadingMeta) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size={28} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm font-medium text-danger">{loadError}</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      {/* 1. Template name */}
      <Section step="1" title="Template name" hint="A short, descriptive name for this template.">
        <Input
          label="Name"
          value={name}
          error={errors.name}
          onChange={(e) => { setName(e.target.value); setErrors((prev) => ({ ...prev, name: undefined })); }}
          placeholder="e.g. Hesitant parent — mid-fee"
        />
      </Section>

      <div className="border-t border-line" />

      {/* 2. Course */}
      <Section step="2" title="Course" hint="Which programme will the counsellor be selling?">
        <SearchableSelect
          label="Course (optional)"
          placeholder="Search courses…"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          options={courses.map((c) => ({ value: c.id, label: c.name, group: c.institute }))}
        />
      </Section>

      <div className="border-t border-line" />

      {/* 3. Persona */}
      <Section
        step="3"
        title="Student persona"
        hint="The roleplayed student. You can preset a behaviour prompt."
      >
        <Select
          label="Persona (optional)"
          placeholder="Select a persona…"
          value={personaId}
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
            label="Persona prompt override (optional)"
            rows={5}
            value={personaPrompt}
            onChange={(e) => { promptTouchedRef.current = true; setPersonaPrompt(e.target.value); }}
            placeholder="How the student should behave during this call…"
          />
        )}

        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={revealPersona}
            onChange={(e) => setRevealPersona(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line accent-brand-600"
          />
          <span>
            Reveal the persona brief to the counsellor
            <span className="block text-xs text-muted">
              Uncheck for a blind call — the counsellor joins without seeing who the student is.
            </span>
          </span>
        </label>
      </Section>

      <div className="border-t border-line" />

      {/* 4. Scenario */}
      <Section step="4" title="Scenario" hint="The situation the counsellor walks into when the call begins.">
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

        {/* Lead profile — shown when a persona with matching profiles is selected */}
        {selectedPersona && profileChoices.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Select
                  label="Student profile (from real calls)"
                  value={profileId}
                  onChange={(e) => handleProfileChange(e.target.value)}
                  options={profileChoices.map((p) => ({ value: p.id, label: p.label }))}
                  placeholder="— pick a profile (optional) —"
                />
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={handleReshuffle} title="Show different profiles">
                Reshuffle
              </Button>
            </div>
            {selectedProfile && (
              <p className="text-xs text-muted leading-relaxed">{selectedProfile.description}</p>
            )}
          </div>
        )}

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

        <div className="grid grid-cols-1 gap-5 rounded-xl border border-line bg-canvas/60 p-4 sm:grid-cols-2">
          <Slider
            label="How pushy"
            value={pushiness}
            onChange={setPushiness}
            lowLabel="Easy-going"
            highLabel="Very pushy"
            hint="How hard they challenge and demand specifics."
          />
          <Slider
            label="How hesitant to buy"
            value={hesitancy}
            onChange={setHesitancy}
            lowLabel="Ready to commit"
            highLabel="Very reluctant"
            hint="How much convincing they need before saying yes."
          />
        </div>
      </Section>

      {rubricTemplates.length > 0 && (
        <>
          <div className="border-t border-line" />
          <Section step="5" title="Rubric" hint="The evaluation template used to score sessions from this template.">
            <Select
              label="Rubric template"
              value={rubricTemplateId}
              onChange={(e) => setRubricTemplateId(e.target.value)}
              options={rubricTemplates.map((t) => ({
                value: t.id,
                label: t.isDefault ? `${t.name} (default)` : t.name,
              }))}
            />
          </Section>
        </>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-line pt-6">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting && <Spinner size={16} className="text-white" />}
          {submitting ? "Saving…" : "Save template"}
        </Button>
      </div>
    </form>
  );
}
