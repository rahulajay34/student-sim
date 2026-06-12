// Supabase singleton client.
// Guards against missing env vars so Vite builds succeed without a real project
// (the app will show an error on first auth call rather than crashing at import time).
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "[supabase] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env. " +
      "Auth calls will fail until they are provided."
  );
}

export const supabase = createClient(url || "https://placeholder.supabase.co", anonKey || "placeholder", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
