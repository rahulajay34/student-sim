import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Load .env from the repo root (student-sim/) so VITE_GOOGLE_CLIENT_ID
  // lives alongside the server's GOOGLE_CLIENT_ID in one file.
  envDir: '../',
  // The OpenAI Realtime engine runs entirely over WebRTC + the browser's native
  // WebAudio API — no WASM/ONNX voice models ship to the client anymore. The
  // optimizeDeps.exclude entries that kept Vite from mangling the kokoro-js /
  // transformers.js / vad-web WASM loaders were removed along with those deps.
  server: {
    // ── ACTIVE: Express backend on :3001 (local dev while Express is live) ──────
    // To switch to Supabase Edge Functions locally, comment this block out and
    // uncomment the router proxy block below.
    proxy: {
      '/api': 'http://localhost:3001',
    },

    // ── FUTURE: Supabase Edge Functions on :54321 (uncomment at cutover) ────────
    // proxy: {
    //   '/api': {
    //     target: 'http://localhost:54321',
    //     changeOrigin: true,
    //     router: {
    //       // Session hot-path routes → session Edge Function.
    //       '/api/sessions': 'http://localhost:54321',
    //     },
    //     rewrite: (path) => {
    //       // Session hot-path: /api/sessions/:id/(message|observe|cue|realtime/...)
    //       //   → /functions/v1/session + original path
    //       const sessionHot = /^\/api\/sessions\/[^/]+(\/(?:message|observe|cue|realtime(?:\/.*)?))/;
    //       if (sessionHot.test(path)) {
    //         return '/functions/v1/session' + path;
    //       }
    //       // Everything else: /api/* → /functions/v1/api + original path
    //       return '/functions/v1/api' + path;
    //     },
    //   },
    // },
  },
})
