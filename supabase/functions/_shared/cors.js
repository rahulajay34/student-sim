// _shared/cors.js — CORS headers and OPTIONS preflight handler.
//
// corsHeaders(origin?) — returns a headers object with CORS fields.
//   If the request origin is in the ALLOWED_ORIGINS env-var list it is reflected;
//   otherwise the first entry is used (or "*" when no list is configured).
//
// handlePreflight(req, corsHeaders?) — returns a 204 Response for OPTIONS, or
//   null when the method is not OPTIONS (caller should continue handling).

import { getEnv } from "./env.js";

// Parse the comma-separated ALLOWED_ORIGINS env var.  Returns an empty array
// when unset (treated as "allow any origin" below, using "*").
function allowedOrigins() {
  const raw = getEnv("ALLOWED_ORIGINS") || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Resolve the CORS value for the Access-Control-Allow-Origin header.
// - If the request origin matches the allowlist → reflect it.
// - If the allowlist is empty → "*" (open; safe for unauthenticated routes).
// - Otherwise → use the first allowlisted origin (keeps the header valid; the
//   browser will still reject mismatches, but avoids a bare rejection).
function resolveOrigin(requestOrigin) {
  const list = allowedOrigins();
  if (!list.length) return "*";
  if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;
  return list[0];
}

export function corsHeaders(requestOrigin) {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(requestOrigin),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-User-Id",
    "Access-Control-Max-Age": "86400",
  };
}

// Returns a 204 Response when the method is OPTIONS; null otherwise.
export function handlePreflight(req) {
  if (req.method !== "OPTIONS") return null;
  const origin = req.headers?.get ? req.headers.get("origin") : req.headers?.origin;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
