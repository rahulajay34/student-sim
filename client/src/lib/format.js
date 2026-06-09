// Shared formatting + presentation helpers used across pages and the UI kit.

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
