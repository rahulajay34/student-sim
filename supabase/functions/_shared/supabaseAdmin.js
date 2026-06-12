// _shared/supabaseAdmin.js — lazy singleton service-role Supabase client.
// Resolves SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY via getEnv() so this works
// under both Deno (edge functions) and Node 25 (validation/tests).
//
// NOTE: @supabase/supabase-js resolves via the Deno import map (import_map.json)
// under Deno. Under Node it must be available in the project's node_modules.

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./env.js";

let _admin = null;

export function getSupabaseAdmin() {
  if (_admin) return _admin;
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }
  _admin = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _admin;
}

// Test helper — reset the singleton (e.g. between test cases).
export function _resetAdminForTests() {
  _admin = null;
}
