import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // onnxruntime-web (used by kokoro-js, transformers.js and vad-web) ships a
  // WASM loader that Vite's dependency pre-bundler rewrites into a broken
  // path (".vite/deps/ort-wasm-*.mjs" -> 404). Excluding these makes Vite
  // serve them as native ESM so the WASM/WebGPU backends initialise correctly.
  optimizeDeps: {
    // These packages ship WASM loaders whose paths Vite's pre-bundler rewrites
    // to .vite/deps/ort-wasm-*.mjs → 404. Keep them excluded so WASM resolves
    // correctly directly from node_modules.
    //
    // @ricky0123/vad-web is also excluded because it calls
    // require("onnxruntime-web/wasm") at module-top-level, which breaks in the
    // browser when pre-bundled. Instead, the useVoiceConversation hook imports
    // it lazily via a dynamic import() only when voice mode is enabled.
    exclude: [
      '@huggingface/transformers',
      'kokoro-js',
      '@ricky0123/vad-web',
      'onnxruntime-web',
    ],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
