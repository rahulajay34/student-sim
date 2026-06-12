import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import { api } from "../../lib/api.js";
import { initials } from "../../lib/format.js";

const ROLES = ["counsellor", "admin", "superadmin"];

const ROLE_LABEL = {
  counsellor: "Counsellor",
  admin: "Admin",
  superadmin: "Super Admin",
};

const ROLE_COLOR = {
  counsellor: "bg-sky-100 text-sky-700",
  admin: "bg-indigo-100 text-indigo-700",
  superadmin: "bg-purple-100 text-purple-700",
};

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState({});
  const [feedback, setFeedback] = useState({});

  useEffect(() => {
    api.getUsers()
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleRoleChange(userId, newRole) {
    setSaving((s) => ({ ...s, [userId]: true }));
    setFeedback((f) => ({ ...f, [userId]: null }));
    try {
      const updated = await api.updateUserRole(userId, newRole);
      setUsers((us) => us.map((u) => (u.id === updated.id ? updated : u)));
      setFeedback((f) => ({ ...f, [userId]: "saved" }));
      setTimeout(() => setFeedback((f) => ({ ...f, [userId]: null })), 2000);
    } catch (err) {
      setFeedback((f) => ({ ...f, [userId]: err.message || "Failed to save" }));
    } finally {
      setSaving((s) => ({ ...s, [userId]: false }));
    }
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-muted text-sm">
        Loading users…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">User Management</h2>
        <p className="mt-1 text-sm text-muted">
          Assign roles to control what each person can access.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-left">
              <th className="px-5 py-3.5 font-semibold text-ink">User</th>
              <th className="px-5 py-3.5 font-semibold text-ink">Email</th>
              <th className="px-5 py-3.5 font-semibold text-ink">Current role</th>
              <th className="px-5 py-3.5 font-semibold text-ink">Change role</th>
              <th className="px-5 py-3.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => {
              const isSelf = u.id === currentUser?.id;
              const isSaving = saving[u.id];
              const fb = feedback[u.id];
              return (
                <tr key={u.id} className="hover:bg-canvas/50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ background: u.avatarColor || "#6B7280" }}
                      >
                        {initials(u.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-ink truncate">
                          {u.name}
                          {isSelf && (
                            <span className="ml-1.5 text-xs text-muted">(you)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-muted truncate max-w-[200px]">{u.email}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLOR[u.role] || "bg-gray-100 text-gray-700"}`}>
                      {ROLE_LABEL[u.role] || u.role}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <select
                      value={u.role}
                      disabled={isSelf || isSaving}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-4 text-right w-28">
                    {isSaving && (
                      <span className="text-xs text-muted">Saving…</span>
                    )}
                    {!isSaving && fb === "saved" && (
                      <span className="text-xs text-success font-medium">Saved</span>
                    )}
                    {!isSaving && fb && fb !== "saved" && (
                      <span className="text-xs text-danger">{fb}</span>
                    )}
                    {isSelf && !isSaving && !fb && (
                      <span className="text-xs text-muted">Can't edit yourself</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="py-12 text-center text-sm text-muted">No users found.</div>
        )}
      </div>

      <div className="rounded-xl border border-line bg-canvas px-4 py-3 text-xs text-muted space-y-1">
        <p><strong className="font-semibold text-ink">Counsellor</strong> — access to the counselling workspace: mock sessions, reports.</p>
        <p><strong className="font-semibold text-ink">Admin</strong> — full site access: manage personas, courses, rubrics, assignments, and view all reports.</p>
        <p><strong className="font-semibold text-ink">Super Admin</strong> — can assign and change roles for any user.</p>
      </div>
    </div>
  );
}
