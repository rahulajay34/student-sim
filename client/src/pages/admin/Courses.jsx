import { useCallback, useEffect, useMemo, useState } from "react";
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
import SearchInput from "../../ui/SearchInput";
import ConfirmDialog from "../../ui/ConfirmDialog";
import { useCreateShortcut } from "../../ui/useCreateShortcut";

const CATEGORY_OPTIONS = [
  { value: "analytics-ai", label: "Analytics & AI" },
  { value: "data-science-ai-ml", label: "Data Science & AI-ML" },
  { value: "software-development-engineering", label: "Software Development" },
  { value: "cybersecurity", label: "Cybersecurity" },
  { value: "product-management-ai", label: "Product Management" },
  { value: "marketing-analytics", label: "Marketing & Analytics" },
  { value: "finance-technology", label: "Finance & Technology" },
  { value: "entrepreneurship-leadership", label: "Entrepreneurship & Leadership" },
  { value: "business-management", label: "Business Management" },
];

const CATEGORY_LABEL = CATEGORY_OPTIONS.reduce((acc, o) => {
  acc[o.value] = o.label;
  return acc;
}, {});

const EMPTY_FORM = {
  name: "",
  institute: "",
  category: "analytics-ai",
  duration: "",
  format: "",
  feeTotal: "",
  feeBooking: "",
  feeNote: "",
  emiNote: "",
  eligibility: "",
  batchInfo: "",
  curriculum: "",
  outcomes: "",
  usps: "",
};

function fmtINR(n) {
  if (typeof n !== "number") return null;
  return `₹${n.toLocaleString("en-IN")}`;
}

function linesFromArray(arr) {
  return Array.isArray(arr) ? arr.join("\n") : "";
}

function arrayFromLines(str) {
  return str
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function Courses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // course being edited, or null for create
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [query, setQuery] = useState("");
  const [confirmTarget, setConfirmTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getCourses();
      setCourses(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load courses.");
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

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  }, []);

  useCreateShortcut(openCreate, { enabled: !loading && !modalOpen });

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) =>
      [c.name, c.institute, CATEGORY_LABEL[c.category] || c.category, c.duration, c.format]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [courses, query]);

  function openEdit(course) {
    setEditing(course);
    setForm({
      name: course.name || "",
      institute: course.institute || "",
      category: course.category || "analytics-ai",
      duration: course.duration || "",
      format: course.format || "",
      feeTotal: course.feeTotal != null ? String(course.feeTotal) : "",
      feeBooking: course.feeBooking != null ? String(course.feeBooking) : "",
      feeNote: course.feeNote || "",
      emiNote: course.emiNote || "",
      eligibility: course.eligibility || "",
      batchInfo: course.batchInfo || "",
      curriculum: linesFromArray(course.curriculum),
      outcomes: linesFromArray(course.outcomes),
      usps: linesFromArray(course.usps),
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
      setFormError("Course name is required.");
      return;
    }
    if (!form.institute.trim()) {
      setFormError("Institute is required.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      name: form.name.trim(),
      institute: form.institute.trim(),
      category: form.category,
      duration: form.duration.trim(),
      format: form.format.trim(),
      feeTotal: form.feeTotal === "" ? null : Number(form.feeTotal),
      feeBooking: form.feeBooking === "" ? null : Number(form.feeBooking),
      feeNote: form.feeNote.trim(),
      emiNote: form.emiNote.trim(),
      eligibility: form.eligibility.trim(),
      batchInfo: form.batchInfo.trim(),
      curriculum: arrayFromLines(form.curriculum),
      outcomes: arrayFromLines(form.outcomes),
      usps: arrayFromLines(form.usps),
    };
    try {
      if (editing) {
        await api.updateCourse(editing.id, payload);
      } else {
        await api.createCourse(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message || "Could not save course.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const course = confirmTarget;
    if (!course) return;
    try {
      await api.deleteCourse(course.id);
      setConfirmTarget(null);
      await load();
    } catch (err) {
      setError(err.message || "Could not delete course.");
      throw err;
    }
  }

  async function handleToggleActive(course) {
    try {
      await api.updateCourse(course.id, { active: !course.active });
      await load();
    } catch (err) {
      setError(err.message || "Could not update course.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-ink">Course catalog</h2>
          <p className="mt-1 text-sm text-muted">
            Programmes counsellors practise selling. Assign a course when creating a mock.
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
          New course
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div role="alert" className="flex items-start justify-between gap-4 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
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

      {/* Search — shown once the catalog grows */}
      {!loading && (courses.length > 8 || query) && (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search courses…"
          className="max-w-sm"
        />
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={28} />
        </div>
      ) : courses.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No courses yet"
            hint="Add your first course to the catalog so counsellors can practise selling it. Tip: press N to add one."
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
                <path d="M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
              </svg>
            }
            action={<Button onClick={openCreate}>New course</Button>}
          />
        </Card>
      ) : filteredCourses.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No matching courses" hint="Try a different search term." />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {filteredCourses.map((c) => {
            const feeStr = c.feeTotal ? fmtINR(c.feeTotal) : "Fee on request";
            const blockStr = c.feeBooking ? ` · block: ${fmtINR(c.feeBooking)}` : "";
            return (
              <Card key={c.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 truncate font-semibold text-ink">{c.name}</h3>
                  <Badge color={c.active ? "success" : "slate"} className="shrink-0">
                    {c.active ? "Active" : "Hidden"}
                  </Badge>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted">{c.institute}</span>
                  {c.category && (
                    <Badge color="brand" className="shrink-0">
                      {CATEGORY_LABEL[c.category] || c.category}
                    </Badge>
                  )}
                </div>

                {(c.duration || c.format) && (
                  <p className="mt-2 text-sm text-muted">
                    {[c.duration, c.format].filter(Boolean).join(" · ")}
                  </p>
                )}

                <p className="mt-1 text-sm text-muted">
                  {feeStr}
                  {blockStr}
                </p>

                {Array.isArray(c.curriculum) && c.curriculum.length > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    {c.curriculum.length} curriculum {c.curriculum.length === 1 ? "module" : "modules"}
                  </p>
                )}

                <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
                  <Button variant="secondary" size="sm" onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handleToggleActive(c)}>
                      {c.active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmTarget(c)}>
                      <span className="text-danger">Delete</span>
                    </Button>
                  </div>
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
        title={editing ? "Edit course" : "New course"}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Spinner size={16} className="text-white" />}
              {editing ? "Save changes" : "Create course"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name *"
              placeholder="e.g. Business Analytics & AI"
              value={form.name}
              onChange={setField("name")}
            />
            <Input
              label="Institute *"
              placeholder="e.g. IIM Ranchi"
              value={form.institute}
              onChange={setField("institute")}
            />
          </div>

          <Select
            label="Category"
            options={CATEGORY_OPTIONS}
            value={form.category}
            onChange={setField("category")}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Duration"
              placeholder="e.g. 6 months"
              value={form.duration}
              onChange={setField("duration")}
            />
            <Input
              label="Format"
              placeholder="e.g. Online"
              value={form.format}
              onChange={setField("format")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Total fee (₹)"
              type="number"
              placeholder="e.g. 70000"
              value={form.feeTotal}
              onChange={setField("feeTotal")}
            />
            <Input
              label="Booking fee (₹)"
              type="number"
              placeholder="e.g. 4000"
              value={form.feeBooking}
              onChange={setField("feeBooking")}
            />
          </div>

          <Input
            label="Fee note"
            placeholder="e.g. Inclusive of GST; balance payable in EMIs"
            value={form.feeNote}
            onChange={setField("feeNote")}
          />

          <Input
            label="EMI note"
            placeholder="e.g. 12 EMIs of ₹5,000/month"
            value={form.emiNote}
            onChange={setField("emiNote")}
          />

          <Input
            label="Eligibility"
            placeholder="e.g. Graduates with 50% or above"
            value={form.eligibility}
            onChange={setField("eligibility")}
          />

          <Input
            label="Batch info"
            placeholder="e.g. Aug 2025 batch — applications open"
            value={form.batchInfo}
            onChange={setField("batchInfo")}
          />

          <Textarea
            label="Curriculum (one module per line)"
            rows={5}
            placeholder={"Module 1: Introduction to Analytics\nModule 2: Python for Data Science"}
            value={form.curriculum}
            onChange={setField("curriculum")}
          />

          <Textarea
            label="Outcomes (one per line)"
            rows={4}
            placeholder={"Ability to analyse business data\nConfidence with ML tools"}
            value={form.outcomes}
            onChange={setField("outcomes")}
          />

          <Textarea
            label="USPs / Highlights (one per line)"
            rows={3}
            placeholder={"IIM Ranchi certification\nWeekend-only batches"}
            value={form.usps}
            onChange={setField("usps")}
          />

          {formError && (
            <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              {formError}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmDelete}
        title="Delete course?"
        confirmLabel="Delete course"
        body={`Delete course "${confirmTarget?.name}"? This cannot be undone.`}
      />
    </div>
  );
}
