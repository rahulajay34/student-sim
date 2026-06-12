// ── Unified toast primitive ────────────────────────────────────────────────────
// Replaces the local ToastStack in Session.jsx (dark pill, top-center) and the
// local Toast in Prompts.jsx (light, bottom-right). Both variants are supported
// through the same provider and hook.
//
// Usage:
//   <ToastProvider>{children}</ToastProvider>   (wrap once in main.jsx)
//   const { pushToast } = useToast();
//   pushToast("Something went wrong", { tone: "danger", ttl: 6000, variant: "light" })
//
// react-refresh/only-export-components warning is acceptable (co-located hooks +
// provider per CLAUDE.md).

import { createContext, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

// ── Dark pill stack (top-center) — default variant, used over the call screen ──
function DarkToastStack({ toasts, onDismiss }) {
  // The live region must exist BEFORE a toast lands in it — screen readers ignore
  // announcements in a region injected together with its content.
  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "min(92vw, 460px)",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 12,
            background:
              t.tone === "danger"
                ? "rgba(45,18,18,0.96)"
                : t.tone === "success"
                ? "rgba(14,30,20,0.96)"
                : "rgba(38,30,12,0.96)",
            border: `1px solid ${
              t.tone === "danger"
                ? "#7f1d1d"
                : t.tone === "success"
                ? "#064e3b"
                : "#854d0e"
            }`,
            color:
              t.tone === "danger"
                ? "#fca5a5"
                : t.tone === "success"
                ? "#6ee7b7"
                : "#fcd9a5",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            fontSize: "0.8125rem",
            lineHeight: 1.45,
          }}
        >
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              opacity: 0.7,
              fontSize: "0.9375rem",
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Light toast (bottom-right) — used in admin pages ─────────────────────────
function LightToastStack({ toasts, onDismiss }) {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2"
      style={{ pointerEvents: "none" }}
    >
      {toasts.map((t) => {
        const colorClass =
          t.tone === "danger"
            ? "border-danger/30 bg-danger-soft text-danger"
            : t.tone === "warn"
            ? "border-warn/30 bg-warn-soft text-warn"
            : "border-success/30 bg-success-soft text-success";
        return (
          <div
            key={t.id}
            role="status"
            style={{ pointerEvents: "auto" }}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg ${colorClass}`}
          >
            {t.message}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => onDismiss(t.id)}
              className="ml-1 opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function ToastProvider({ children }) {
  const [darkToasts, setDarkToasts] = useState([]);
  const [lightToasts, setLightToasts] = useState([]);
  const idRef = useRef(0);

  function pushToast(message, { tone = "warn", ttl = 6000, variant = "dark" } = {}) {
    const id = ++idRef.current;
    const setter = variant === "light" ? setLightToasts : setDarkToasts;
    setter((prev) => [...prev, { id, message, tone }]);
    if (ttl) {
      setTimeout(() => {
        setter((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    }
  }

  function dismissDark(id) {
    setDarkToasts((prev) => prev.filter((t) => t.id !== id));
  }
  function dismissLight(id) {
    setLightToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <DarkToastStack toasts={darkToasts} onDismiss={dismissDark} />
      <LightToastStack toasts={lightToasts} onDismiss={dismissLight} />
    </ToastContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
