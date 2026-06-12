// _shared/path.js — route path normalization for edge functions.
//
// Edge function URLs have the form:
//   https://<project>.supabase.co/functions/v1/<fnName>/…
//
// The client SPA talks to /api/… on the same origin in dev (Vite proxy) and in
// production (Supabase rewrites or a direct fetch with the full URL). Strip the
// three leading segments so route handlers can match plain paths like
// "/sessions/:id/message".
//
// normalizePath(req, fnName?) — returns the path with the following prefixes
//   removed (in order, each applied at most once, sequentially):
//   1. /functions/v1/<fnName>
//   2. /functions/v1
//   3. /<fnName>
//   4. /api
//
// All four are attempted in order (no break after first match). This handles
// double-prefix production URLs like /functions/v1/api/api/counsellors → /counsellors.
//
// The result always starts with "/" and has no trailing slash (unless it is "/").

export function normalizePath(req, fnName) {
  // Accept either a Request object (Deno/fetch API) or a plain URL string.
  let raw;
  if (typeof req === "string") {
    raw = req;
  } else if (req && typeof req.url === "string") {
    try {
      raw = new URL(req.url).pathname;
    } catch {
      raw = req.url;
    }
  } else {
    raw = "/";
  }

  // Strip query string if somehow still attached.
  const qIdx = raw.indexOf("?");
  let path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;

  // Normalize to always start with "/".
  if (!path.startsWith("/")) path = "/" + path;

  // Strip each qualifying prefix exactly once, in order.
  // Each prefix is only removed if present at the start of the current path.
  // This handles double-prefix production URLs like:
  //   /functions/v1/api/api/counsellors -> /counsellors
  //   /functions/v1/session/api/sessions/X/message -> /sessions/X/message
  const prefixes = [];
  if (fnName) {
    prefixes.push(`/functions/v1/${fnName}`);
  }
  prefixes.push("/functions/v1");
  if (fnName) {
    prefixes.push(`/${fnName}`);
  }
  prefixes.push("/api");

  for (const prefix of prefixes) {
    if (path === prefix || path.startsWith(prefix + "/")) {
      path = path.slice(prefix.length) || "/";
      // no break — continue to strip further qualifying prefixes
    }
  }

  // Remove trailing slash (keep bare "/" as-is).
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  return path;
}
