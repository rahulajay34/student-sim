// _shared/env.js — universal env accessor.
// Works under Deno (globalThis.Deno?.env?.get) and Node (process.env).
// All other shared modules import getEnv() from here instead of reading
// process.env directly, so they run unchanged in both runtimes.

/**
 * getEnv(name) — read an environment variable.
 * Returns the string value, or undefined if not set.
 * @param {string} name
 * @returns {string|undefined}
 */
export function getEnv(name) {
  // Deno runtime exposes Deno.env.get()
  if (typeof globalThis !== "undefined" && globalThis.Deno?.env?.get) {
    return globalThis.Deno.env.get(name);
  }
  // Node / Edge environments expose process.env
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return undefined;
}
