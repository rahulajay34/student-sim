import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth.jsx";
import Card from "../../ui/Card";
import Button from "../../ui/Button";
import Input from "../../ui/Input";
import Textarea from "../../ui/Textarea";
import Select from "../../ui/Select";
import SearchableSelect from "../../ui/SearchableSelect";
import Slider from "../../ui/Slider";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import Badge from "../../ui/Badge";
import Avatar from "../../ui/Avatar";

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
  const [courses, setCourses] = useState([]);
  const [profiles, setProfiles] = useState([]);

  const [rubricTemplates, setRubricTemplates] = useState([]);
  const [rubricTemplateId, setRubricTemplateId] = useState("");
  const [partialLoad, setPartialLoad] = useState(false);

  const [courseId, setCourseId] = useState("");
  const [counsellorId, setCounsellorId] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [revealPersona, setRevealPersona] = useState(true);
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [situation, setSituation] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [pushiness, setPushiness] = useState(3);
  const [hesitancy, setHesitancy] = useState(3);

  const [profileId, setProfileId] = useState("");
  const [profileChoices, setProfileChoices] = useState([]);

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError("");
      setPartialLoad(false);
      let rubricsFailed = false;
      let profilesFailed = false;
      const [cs, ps, crs, rts, profs] = await Promise.all([
        api.getCounsellors(),
        api.getPersonas(),
        api.getCourses(true),
        api.getRubricTemplates().catch(() => { rubricsFailed = true; return []; }),
        api.getLeadProfiles().catch(() => { profilesFailed = true; return []; }),
      ]);
      if (rubricsFailed || profilesFailed) setPartialLoad(true);
      setCounsellors(cs || []);
      setPersonas(ps || []);
      setCourses(crs || []);
      setProfiles(Array.isArray(profs) ? profs : []);
      const rtList = Array.isArray(rts) ? rts : [];
      setRubricTemplates(rtList);
      // Default-select the isDefault template; fall back to the first one so
      // React state never silently disagrees with what the dropdown displays
      // (an "" state submitted null while the browser showed option 1 selected).
      const defaultTpl = rtList.find((t) => t.isDefault) || rtList[0];
      if (defaultTpl) setRubricTemplateId(defaultTpl.id);
    } catch (e) {
      setLoadError(e.message || "Failed to load data.");
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

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === personaId) || null,
    [personas, personaId]
  );
  const selectedCounsellor = useMemo(
    () => counsellors.find((c) => c.id === counsellorId) || null,
    [counsellors, counsellorId]
  );

  const selectedProfile = profileChoices.find((p) => p.id === profileId) || null;

  // Slim progress reflecting the numbered sections of the form.
  const hasRubricStep = rubricTemplates.length > 0;
  const steps = useMemo(() => {
    const base = [
      { label: "Course", done: !!courseId },
      { label: "Counsellor", done: !!counsellorId },
      { label: "Persona", done: !!personaId },
      { label: "Scenario", done: !!(title.trim() || situation.trim() || profileId) },
    ];
    if (hasRubricStep) base.push({ label: "Rubric", done: !!rubricTemplateId });
    return base;
  }, [courseId, counsellorId, personaId, title, situation, profileId, hasRubricStep, rubricTemplateId]);
  const doneCount = steps.filter((s) => s.done).length;
  const progressPct = Math.round((doneCount / steps.length) * 100);

  // Draw 10 random profiles for a given persona category. Called from event handlers
  // so the randomness is outside the render path (avoids the eslint purity rule).
  function drawProfiles(persona, allProfiles) {
    const cat = ARCHETYPE_TO_CATEGORY[persona?.category];
    if (!cat) return [];
    const matching = allProfiles.filter((p) => p.category === cat);
    const shuffled = [...matching].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 10);
  }

  function handlePersonaChange(id) {
    setPersonaId(id);
    setErrors((prev) => ({ ...prev, personaId: undefined }));
    const persona = personas.find((p) => p.id === id);
    // Prefill the editable prompt with the persona's behaviour prompt for this mock.
    setPersonaPrompt(persona?.behaviourPrompt || "");
    // Reset profile selection when persona changes.
    setProfileId("");
    setSituation("");
    setProfileChoices(drawProfiles(persona, profiles));
  }

  function handleProfileChange(id) {
    setProfileId(id);
    // Pre-fill the situation text box with the selected profile's description.
    const prof = profileChoices.find((p) => p.id === id) || null;
    setSituation((prof && prof.description) || "");
  }

  function handleReshuffle() {
    setProfileId("");
    setSituation("");
    setProfileChoices(drawProfiles(selectedPersona, profiles));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");

    const nextErrors = {};
    if (!courseId) nextErrors.courseId = "Course is required.";
    if (!counsellorId) nextErrors.counsellorId = "Select a counsellor.";
    if (!personaId) nextErrors.personaId = "Select a persona.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const original = (selectedPersona?.behaviourPrompt || "").trim();
    const edited = personaPrompt.trim();
    // "" is a deliberate override (admin blanked the prompt for this mock) — the
    // old `edited && …` falsiness check made blanking impossible.
    const personaPromptOverride = edited !== original ? edited : null;

    try {
      setSubmitting(true);
      await api.createAssignment({
        courseId,
        counsellorId,
        personaId,
        personaPromptOverride,
        revealPersona,
        profileId: profileId || null,
        rubricTemplateId: rubricTemplateId || null,
        scenario: {
          title: title.trim(),
          difficulty,
          situation: situation.trim(),
          contextNotes: contextNotes.trim(),
          pushiness,
          hesitancy,
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

  const noData = counsellors.length === 0 || personas.length === 0 || courses.length === 0;

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

      {/* Partial-load warning: rubric or profile data failed to fetch */}
      {partialLoad && (
        <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 px-4 py-3 text-sm text-warn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className="mt-0.5 h-4 w-4 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="text-ink/80">
            Some options could not be loaded — rubric/profile dropdowns may be incomplete.
          </span>
        </div>
      )}

      {loadError ? (
        <Card className="p-6">
          <EmptyState
            title="Couldn't load assignment data"
            hint={loadError}
            action={
              <Button variant="secondary" onClick={load}>
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
                : personas.length === 0
                ? "There are no personas yet. Create a persona before assigning a mock."
                : "There are no active courses in the catalog. Add a course before assigning a mock."
            }
            action={
              <Button
                as={Link}
                to={
                  counsellors.length === 0
                    ? "/admin/counsellors"
                    : personas.length === 0
                    ? "/admin/personas"
                    : "/admin/courses"
                }
                variant="primary"
              >
                {counsellors.length === 0
                  ? "Go to counsellors"
                  : personas.length === 0
                  ? "Go to personas"
                  : "Go to courses"}
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="p-6">
          {/* Slim progress indicator across the numbered sections */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted">
              <span>
                {doneCount} of {steps.length} sections ready
              </span>
              <span className="tabular-nums">{progressPct}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-canvas"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Assignment setup progress"
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {steps.map((s) => (
                <span
                  key={s.label}
                  className={`inline-flex items-center gap-1 text-xs ${
                    s.done ? "text-brand-700" : "text-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      s.done ? "bg-brand-600" : "bg-line"
                    }`}
                  />
                  {s.label}
                </span>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            {/* 1. Course */}
            <Section
              step="1"
              title="Course"
              hint="Which programme will the counsellor be selling on this call?"
            >
              <SearchableSelect
                label="Course"
                placeholder="Search courses…"
                value={courseId}
                error={errors.courseId}
                onChange={(e) => {
                  setCourseId(e.target.value);
                  setErrors((prev) => ({ ...prev, courseId: undefined }));
                }}
                options={courses.map((c) => ({ value: c.id, label: c.name, group: c.institute }))}
              />
            </Section>

            <div className="border-t border-line" />

            {/* 2. Counsellor */}
            <Section
              step="2"
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

            {/* 3. Persona */}
            <Section
              step="3"
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

              {/* Blind-call toggle: server + green room already support
                  revealPersona=false, but the form never exposed it, so the
                  feature was unreachable from the UI. */}
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
                    Uncheck for a blind call — the counsellor joins without seeing who the student is or their backstory.
                  </span>
                </span>
              </label>
            </Section>

            <div className="border-t border-line" />

            {/* 4. Scenario */}
            <Section
              step="4"
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

              {/* Lead profile dropdown — shown when a persona is selected and matching profiles exist */}
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleReshuffle}
                      title="Show different profiles"
                    >
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

              {/* Student tuning — how the AI student carries itself on the call */}
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

                {/* 5. Rubric */}
                <Section
                  step="5"
                  title="Rubric"
                  hint="The evaluation template used to score this mock session."
                >
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

            {submitError && (
              <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
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
