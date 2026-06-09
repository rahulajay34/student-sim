// Ollama Cloud client (gpt-oss:120b served from ollama.com). Despite the legacy
// project name, this app does NOT use Google Gemini.
import { Ollama } from "ollama";

let _ollama = null;
function getOllama() {
  if (!_ollama) {
    _ollama = new Ollama({
      host: "https://ollama.com",
      headers: { Authorization: "Bearer " + process.env.OLLAMA_API_KEY },
    });
  }
  return _ollama;
}

export const MODEL = "gpt-oss:120b";

// Thin wrapper so callers just pass messages and get the text back.
export async function chat(messages) {
  const response = await getOllama().chat({ model: MODEL, stream: false, messages });
  return response.message.content;
}

// Robustly pull the first JSON object out of an LLM response (handles ```json fences).
export function extractJson(raw) {
  const stripped = String(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model response");
  return JSON.parse(match[0]);
}
