import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import Card, { CardHeader } from "../../ui/Card";
import Button from "../../ui/Button";
import Input from "../../ui/Input";
import Textarea from "../../ui/Textarea";
import Select from "../../ui/Select";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import Badge from "../../ui/Badge";
import DifficultyBadge from "../../ui/DifficultyBadge";

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

export default function Practice() {
  const navigate = useNavigate();

  const [personas, setPersonas] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [personaId, setPersonaId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("Free practice");
  const [difficulty, setDifficulty] = useState("medium");
  const [situation, setSituation] = useState("");
  const [contextNotes, setContextNotes] = useState("");

  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    Promise.all([api.getPersonas(), api.getCourses(true)])
      .then(([personaData, courseData]) => {
        if (!active) return;
        setPersonas(Array.isArray(personaData) ? personaData : []);
        const crs = Array.isArray(courseData) ? courseData : [];
        setCourses(crs);
        // Default to IIM Ranchi BA course if present, else first course
        const defaultCourse =
          crs.find((c) => c.slug === "iim-ranchi/business-analytics-ai-sop") || crs[0] || null;
        if (defaultCourse) setCourseId(defaultCourse.id);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err.message || "Could not load data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === personaId) || null,
    [personas, personaId]
  );

  const personaOptions = useMemo(
    () => personas.map((p) => ({ value: p.id, label: p.name })),
    [personas]
  );

  const personaMissing = touched && !personaId;

  function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!personaId) return;

    navigate("/app/session/new", {
      state: {
        mode: "practice",
        personaId,
        courseId: courseId || undefined,
        scenario: {
          title: title.trim() || "Free practice",
          difficulty,
          situation: situation.trim(),
          contextNotes: contextNotes.trim(),
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
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
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
                <Select
                  label="Course"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  options={courses.map((c) => ({ value: c.id, label: `${c.name} — ${c.institute}` }))}
                />
              </div>
            )}

            {courses.length > 0 && <div className="h-px bg-line" />}

            {/* Persona */}
            <div className="space-y-3">
              <Select
                label="Student persona"
                placeholder="Select a persona…"
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
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
            </div>

            <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-xs text-muted">
                <span>Self-directed practice — a full report is saved when you finish.</span>
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
