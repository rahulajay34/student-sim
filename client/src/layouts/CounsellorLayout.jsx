import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../ui/Sidebar.jsx";
import Topbar from "../ui/Topbar.jsx";
import { useAuth } from "../lib/auth.jsx";
import { initials } from "../lib/format.js";

const NAV = [
  { to: "/app", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/app/mocks", label: "My Mocks", icon: "mocks" },
  { to: "/app/practice", label: "Practice", icon: "practice" },
  { to: "/app/reports", label: "Reports", icon: "reports" },
];

function titleFor(path) {
  if (path.startsWith("/app/mocks")) return "My Mocks";
  if (path.startsWith("/app/practice")) return "Practice";
  if (path.startsWith("/app/reports")) return "Reports";
  return "Dashboard";
}

export default function CounsellorLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  const footer = (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: user?.avatarColor || "#0EA5E9" }}>
        {initials(user?.name)}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-semibold text-ink">{user?.name}</div>
        <div className="truncate text-xs text-muted">Counsellor</div>
      </div>
      <button onClick={logout} title="Log out" className="rounded-lg p-2 text-muted hover:bg-canvas hover:text-danger">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M17 16l4-4m0 0l-4-4m4 4H7M13 16v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar brand="Masai" subtitle="Counselling Trainer" items={NAV} footer={footer} open={open} onClose={() => setOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={titleFor(pathname)} onMenu={() => setOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl animate-fadeup">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
