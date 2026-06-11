// Deterministic parser: persona-profiles.md -> server/data/leadProfiles.json.
// Verbatim extraction (no LLM) so the 170 real-call profile descriptions are exact.
//
// Source format per section:
//   ## Currently Studying (44 profiles)
//   **<label>**
//   > <description...>            (one or more consecutive blockquote lines)
//
// Re-run: node scripts/build-lead-profiles.mjs
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "persona-profiles.md");
const OUT = join(ROOT, "server", "data", "leadProfiles.json");

// Section header keyword -> one of the four valid profile categories.
function categoryFor(header) {
  const h = header.toLowerCase();
  if (h.includes("currently studying")) return "studying";
  if (h.includes("same field")) return "same-field";
  if (h.includes("different field")) return "diff-field";
  if (h.includes("not studying") || h.includes("not working") || h.includes("non-working")) return "non-working";
  return null;
}

// Best-effort first-name extraction (the `name` field is metadata; the UI shows
// `label` + `description`). Prefer the description's lead-in, fall back to the label.
const ADJ_STOP = new Set([
  "this", "is", "a", "the", "likely", "an", "year", "old", "soft", "spoken",
]);
function extractName(label, description) {
  const descPatterns = [
    /^This is (?:likely |probably |a |an )?([A-Z][a-z'’]+)/,
    /^([A-Z][a-z'’]+) (?:is|was|works|runs|joins|calls|introduces|comes|dropped|did|handles|finished)/,
  ];
  for (const re of descPatterns) {
    const m = description.match(re);
    if (m && !ADJ_STOP.has(m[1].toLowerCase())) return m[1];
  }
  // Fallback: first capitalised token in the label that isn't a leading adjective.
  const beforeComma = label.split(",")[0];
  for (const w of beforeComma.split(/\s+/)) {
    const clean = w.replace(/[^A-Za-z'’-]/g, "");
    if (/^[A-Z][a-z'’-]+$/.test(clean) && !ADJ_STOP.has(clean.toLowerCase())) return clean;
  }
  return "";
}

const lines = readFileSync(SRC, "utf8").split("\n");
const profiles = [];
let category = null;
let pendingLabel = null;
let descBuf = [];

function flush() {
  if (pendingLabel && descBuf.length && category) {
    const description = descBuf.join(" ").replace(/\s+/g, " ").trim();
    const id = `lead-${String(profiles.length + 1).padStart(3, "0")}`;
    profiles.push({ id, category, name: extractName(pendingLabel, description), label: pendingLabel, description });
  }
  pendingLabel = null;
  descBuf = [];
}

for (const raw of lines) {
  const line = raw.replace(/\r$/, "");
  if (line.startsWith("## ")) { flush(); category = categoryFor(line.slice(3)); continue; }
  const boldMatch = line.match(/^\*\*(.+?)\*\*\s*$/);
  if (boldMatch) { flush(); pendingLabel = boldMatch[1].trim(); descBuf = []; continue; }
  if (line.startsWith(">")) { descBuf.push(line.replace(/^>\s?/, "").trim()); continue; }
  // Blank or other line: a blank line after a blockquote ends the current profile's desc,
  // but we keep accumulating until the next ** or ## so multi-line quotes still join.
}
flush();

const counts = profiles.reduce((acc, p) => ((acc[p.category] = (acc[p.category] || 0) + 1), acc), {});
writeFileSync(OUT, JSON.stringify({ profiles }, null, 2) + "\n");
console.log(`Wrote ${profiles.length} profiles -> ${OUT}`);
console.log("Per category:", JSON.stringify(counts));
console.log("Sample:", JSON.stringify(profiles[0], null, 2));
const missingName = profiles.filter((p) => !p.name).length;
console.log(`Profiles with empty name: ${missingName}`);
