// Shared formatting + presentation helpers used across pages and the UI kit.

import { useEffect, useRef, useState } from "react";

// Whether the user prefers reduced motion (read once, lazily).
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Animate a number from 0 → target over `duration` ms on mount (and whenever
// `target` changes). Returns the current animated value. Honors
// prefers-reduced-motion by snapping straight to the target.
// Non-finite targets are returned untouched so callers can render an em dash.
export function useCountUp(target, duration = 500) {
  const numeric = typeof target === "number" && Number.isFinite(target);
  // Lazy initial state avoids a synchronous setState in the effect: when motion
  // is off (or the target isn't numeric) we start already at the final value.
  const animate = numeric && duration > 0 && !prefersReducedMotion();
  const [value, setValue] = useState(() => (animate ? 0 : target));
  const frameRef = useRef(0);

  useEffect(() => {
    if (!animate) return; // nothing to schedule; value already at target
    let start = null;
    const tick = (ts) => {
      if (start == null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic for a calm settle
      setValue(t < 1 ? target * eased : target);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration, animate]);

  return numeric ? value : target;
}

// 'success' | 'warn' | 'danger' for a 0-100 satisfaction score (thresholds 70 / 50).
export function scoreColor(n) {
  if (n >= 70) return "success";
  if (n >= 50) return "warn";
  return "danger";
}

// Color token for a report overall band.
export function bandColor(band) {
  if (band === "Excellent") return "success";
  if (band === "Good") return "warn";
  return "danger";
}

// 'success' | 'warn' | 'danger' for a difficulty level.
export function difficultyColor(level) {
  if (level === "easy") return "success";
  if (level === "hard") return "danger";
  return "warn";
}

// 1-5 rubric score -> color token.
export function rubricColor(score) {
  if (score >= 4) return "success";
  if (score >= 3) return "warn";
  return "danger";
}

// Hex/Tailwind-token maps for inline styles (bars, fills) where a class won't do.
export const TOKEN_HEX = {
  success: "#10b981",
  warn: "#f59e0b",
  danger: "#f43f5e",
  brand: "#4f46e5",
  slate: "#64748b",
};

export function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function relativeDate(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export const STATUS_LABEL = {
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
};

export const statusColor = (s) => (s === "completed" ? "success" : s === "in_progress" ? "warn" : "slate");

export function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}
