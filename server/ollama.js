// Thin re-export shim — all implementation lives in ./llm.js.
// The file name is kept for import compatibility: every server module imports
// from "./ollama.js" and the test suite imports stripThink from "../ollama.js".
export {
  chat,
  chatStream,
  chatStreamCollect,
  stripThink,
  extractJson,
  MODEL,
  STUDENT_SAMPLING,
  DETERMINISTIC_SAMPLING,
  REPORT_TIMEOUT_MS,
  FAST_OPTIONS,
  REASONING_OPTIONS,
  DEFAULT_TIMEOUT_MS,
  resolveModel,
  _setClientForTests,
} from "./llm.js";
