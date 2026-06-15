import { useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import { api } from "../../lib/api";
import { useToast } from "../../ui/Toast.jsx";
import Card, { CardHeader } from "../../ui/Card";
import Button from "../../ui/Button";
import Select from "../../ui/Select";
import Avatar from "../../ui/Avatar";

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

export default function Profile() {
  const { user } = useAuth();
  const { pushToast } = useToast();

  // The backend user object may carry a gender field; the auth shape doesn't yet
  // expose it, so we initialise from localStorage mct_user if present.
  function resolveInitialGender() {
    try {
      const raw = localStorage.getItem("mct_user");
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.gender || "";
      }
    } catch {
      // ignore
    }
    return "";
  }

  const [gender, setGender] = useState(resolveInitialGender);
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    try {
      const updated = await api.updateProfile(user.id, { gender: gender || null });
      // Persist to localStorage so the updated value survives a page reload
      // before the next auth fetch. We merge rather than overwrite so unrelated
      // cached fields (name, role, etc.) are preserved.
      try {
        const raw = localStorage.getItem("mct_user");
        const existing = raw ? JSON.parse(raw) : {};
        localStorage.setItem(
          "mct_user",
          JSON.stringify({ ...existing, gender: updated?.gender ?? (gender || null) })
        );
      } catch {
        // Non-fatal: localStorage is a best-effort cache.
      }
      pushToast("Profile saved.", { tone: "success", variant: "light" });
    } catch (err) {
      pushToast(err.message || "Failed to save profile.", { tone: "danger", variant: "light" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight text-ink">Profile</h2>
        <p className="mt-1 text-sm text-muted">View your details and update your preferences.</p>
      </header>

      {/* Identity card */}
      <Card className="p-6">
        <CardHeader title="Your account" />
        <div className="flex items-center gap-4">
          <Avatar name={user?.name} color={user?.avatarColor} size="lg" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-base font-semibold text-ink truncate">{user?.name || "—"}</div>
            <div className="text-sm text-muted truncate">{user?.email || "—"}</div>
            <div className="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 capitalize">
              {user?.role || "counsellor"}
            </div>
          </div>
        </div>
      </Card>

      {/* Settings form */}
      <Card className="p-6">
        <CardHeader
          title="Preferences"
          subtitle="Your gender setting is used to match voice and address style during calls."
        />
        <form onSubmit={handleSave} className="space-y-5">
          <Select
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            options={GENDER_OPTIONS}
          />

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
