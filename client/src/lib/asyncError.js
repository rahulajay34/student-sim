// ── Async error helpers ────────────────────────────────────────────────────────
// Lightweight conventions for translating thrown errors into user-facing strings
// and deciding whether a retry makes sense.

import { ApiError } from "./api";

/**
 * Convert any thrown value into a user-facing string.
 * Falls back to a generic message for non-Error values.
 */
export function toUserMessage(err) {
  if (!err) return "An unexpected error occurred.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "An unexpected error occurred.";
  return String(err) || "An unexpected error occurred.";
}

/**
 * Returns true when the error is likely transient (network blip, 5xx) and a
 * retry could succeed without user action. Returns false for 4xx client errors.
 */
export function isTransient(err) {
  if (!err) return false;
  if (err instanceof ApiError) {
    if (err.isNetwork) return true;
    // 5xx server errors are transient; 4xx are client errors (not transient).
    return typeof err.status === "number" && err.status >= 500;
  }
  // Generic network errors (fetch failed, AbortError from a timed-out request).
  if (err instanceof TypeError) return true;
  return false;
}
