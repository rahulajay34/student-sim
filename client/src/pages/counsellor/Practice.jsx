import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import Card, { CardHeader } from "../../ui/Card";
import Button from "../../ui/Button";
import Input from "../../ui/Input";
import Textarea from "../../ui/Textarea";
import Select from "../../ui/Select";
import SearchableSelect from "../../ui/SearchableSelect";
import Slider from "../../ui/Slider";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import Badge from "../../ui/Badge";
import DifficultyBadge from "../../ui/DifficultyBadge";

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

export default function Practice() {
  const navigate = useNavigate();

  const [personas, setPersonas] = useState([]);
  const [courses, setCourses] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [personaId, setPersonaId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("Free practice");
  const [difficulty, setDifficulty] = useState("medium");
  const [situation, setSituation] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [pushiness, setPushiness] = useState(3);
  const [hesitancy, setHesitancy] = useState(3);

  const [profileId, setProfileId] = useState("");
  const [profileChoices, setProfileChoices] = useState([]);

  const [touched, setTouched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      // Independent fetches run in parallel.
      const [personaData, courseData, profileData] = await Promise.all([
        api.getPersonas(),
        api.getCourses(true),
        api.getLeadProfiles(),
      ]);
      setPersonas(Array.isArray(personaData) ? personaData : []);
      const crs = Array.isArray(courseData) ? courseData : [];
      setCourses(crs);
      setProfiles(Array.isArray(profileData) ? profileData : []);
      // Default to IIM Ranchi BA course if present, else first course
      const defaultCourse =
        crs.find((c) => c.slug === "iim-ranchi/business-analytics-ai-sop") || crs[0] || null;
      if (defaultCourse) setCourseId(defaultCourse.id);
    } catch (err) {
      setLoadError(err.message || "Could not load data.");
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

  const personaOptions = useMemo(
    () => personas.map((p) => ({ value: p.id, label: p.name })),
    [personas]
  );

  const selectedProfile = profileChoices.find((p) => p.id === profileId) || null;

  const personaMissing = touched && !personaId;

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
    // Reset profile selection when persona changes so stale choices don't persist.
    setProfileId("");
    setSituation("");
    const persona = personas.find((p) => p.id === id) || null;
    setProfileChoices(drawProfiles(persona, profiles));
  }

  function handleProfileChange(id) {
    setProfileId(id);
    // Pre-fill the situation text box with the selected profile's description.
    const prof = profileChoices.find((p) => p.id === id) || null;
    setSituation(prof ? prof.description : "");
  }

  function handleReshuffle() {
    setProfileId("");
    setSituation("");
    setProfileChoices(drawProfiles(selectedPersona, profiles));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!personaId) {
      // The persona field can be scrolled far above the button — bring it
      // into view so the blocked submit is never a silent no-op.
      document.getElementById("practice-persona")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    navigate("/app/session/new", {
      state: {
        mode: "practice",
        personaId,
        courseId: courseId || undefined,
        profileId: profileId || undefined,
        scenario: {
          title: title.trim() || "Free practice",
          difficulty,
          // situation state is pre-filled from the profile on selection, so the
          // textarea (with any manual edits) is the single source of truth here.
          situation: situation.trim(),
          contextNotes: contextNotes.trim(),
          pushiness,
          hesitancy,
        },
      },
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Free practice</h1>
        <p className="text-sm text-muted">
          Spin up a self-directed practice call against any student persona. Pick who you are talking to,
          set the scene, and start whenever you are ready — you still get a full coaching report at the end.
        </p>
      </header>

      <Card className="p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Spinner size={28} />
            <p className="text-sm text-muted">Loading personas…</p>
          </div>
        ) : loadError ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            }
            title="Couldn't load personas"
            hint={loadError}
            action={
              <Button variant="secondary" size="sm" onClick={load}>
                Try again
              </Button>
            }
          />
        ) : personas.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-1a6 6 0 0112 0v1" />
              </svg>
            }
            title="No personas available yet"
            hint="An admin needs to create at least one student persona before you can run a practice call."
          />
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <CardHeader
              title="Set up your call"
              subtitle="These details shape how the AI student behaves and responds."
            />

            {/* Course */}
            {courses.length > 0 && (
              <div className="space-y-3">
                <SearchableSelect
                  label="Course"
                  placeholder="Search courses…"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  options={courses.map((c) => ({ value: c.id, label: c.name, group: c.institute }))}
                />
              </div>
            )}

            {courses.length > 0 && <div className="h-px bg-line" />}

            {/* Persona */}
            <div id="practice-persona" className="space-y-3">
              <Select
                label="Student persona"
                placeholder="Select a persona…"
                value={personaId}
                onChange={(e) => handlePersonaChange(e.target.value)}
                options={personaOptions}
                error={personaMissing ? "Please choose a persona to practice against." : undefined}
              />
              {selectedPersona && (
                <div className="rounded-xl border border-line bg-canvas/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{selectedPersona.name}</span>
                    {selectedPersona.category && (
                      <Badge color="brand">{selectedPersona.category}</Badge>
                    )}
                    {selectedPersona.label && (
                      <Badge color="slate">{selectedPersona.label}</Badge>
                    )}
                  </div>
                  {selectedPersona.description && (
                    <p className="mt-2 text-sm text-muted">{selectedPersona.description}</p>
                  )}
                </div>
              )}
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

            <div className="h-px bg-line" />

            {/* Scenario */}
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Input
                  label="Scenario title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Free practice"
                />
                <Select
                  label="Difficulty"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  options={DIFFICULTY_OPTIONS}
                />
              </div>

              <Textarea
                label="Situation (optional)"
                rows={3}
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                placeholder="e.g. The student filled the lead form yesterday and is curious but hesitant about the fees."
              />

              <Textarea
                label="Extra context (optional)"
                rows={3}
                value={contextNotes}
                onChange={(e) => setContextNotes(e.target.value)}
                placeholder="Any background, constraints, or specifics you want the student to keep in mind."
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
            </div>

            <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-muted">
                {personaMissing ? (
                  <span role="alert" className="font-medium text-danger">
                    Choose a student persona above to start.
                  </span>
                ) : (
                  <span>Self-directed practice — a full report is saved when you finish.</span>
                )}
                {selectedPersona && <DifficultyBadge level={difficulty} />}
              </p>
              <Button type="submit" className="sm:min-w-[10rem]">
                Start practice
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
