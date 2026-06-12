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
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
