// _shared/auth.js — authentication and authorization helpers for edge functions.
//
// authenticate(req) — extract and verify the Bearer token; returns the user profile.
// assertAdmin(user) — throws 403 if user is not an admin.
// assertOwnerOrAdmin(user, ownerId) — throws 403 if user is neither owner nor admin.
// httpError(status, message) — create a structured error with an HTTP status code.
// errorResponse(err) — convert an httpError (or any Error) to a Response.

import { getSupabaseAdmin } from "./supabaseAdmin.js";

// ─────────────────────────────────────────────────────────────────────────────
// Structured HTTP error
// ─────────────────────────────────────────────────────────────────────────────
export function httpError(status, message) {
  const err = new Error(message);
  err.httpStatus = status;
  err.isHttpError = true;
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert any error to a Response. httpError instances use their status;
// everything else becomes 500.
// ─────────────────────────────────────────────────────────────────────────────
export function errorResponse(err, corsHeaders = {}) {
  const status = err?.isHttpError ? err.httpStatus : 500;
  const message = err?.message || "Internal server error";
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract Bearer token from Authorization header.
// Returns null when absent or malformed (not "Bearer <token>").
// ─────────────────────────────────────────────────────────────────────────────
function extractBearerToken(req) {
  const auth = req.headers?.get ? req.headers.get("authorization") : req.headers?.authorization;
  if (!auth || typeof auth !== "string") return null;
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// authenticate(req) — verify the Bearer JWT with Supabase Auth and return the
// caller's profile row (with role and id).
//
// Throws httpError(401, ...) when the token is missing, invalid, or expired.
// Throws httpError(404, ...) when the profile row does not exist.
// ─────────────────────────────────────────────────────────────────────────────
export async function authenticate(req) {
  const token = extractBearerToken(req);
  if (!token) throw httpError(401, "Missing or malformed Authorization header.");

  const db = getSupabaseAdmin();
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw httpError(401, "Invalid or expired token.");

  // Fetch the profile row for role + display name.
  const { data: profile, error: profErr } = await db
    .from("profiles")
    .select("id, email, name, role, avatar_color")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr) throw httpError(500, `Profile lookup failed: ${profErr.message}`);
  if (!profile) throw httpError(404, "User profile not found.");

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    avatarColor: profile.avatar_color,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// assertAdmin(user) — throws 403 if the user is not an admin.
// ─────────────────────────────────────────────────────────────────────────────
export function assertAdmin(user) {
  if (!user || user.role !== "admin") {
    throw httpError(403, "Admin access required.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// assertOwnerOrAdmin(user, ownerId) — throws 403 if user is neither the owner
// nor an admin. ownerId is the resource's owner/counsellor id (UUID string).
// ─────────────────────────────────────────────────────────────────────────────
export function assertOwnerOrAdmin(user, ownerId) {
  if (!user) throw httpError(403, "Forbidden.");
  if (user.role === "admin") return;
  if (user.id === ownerId) return;
  throw httpError(403, "You do not have access to this resource.");
}
