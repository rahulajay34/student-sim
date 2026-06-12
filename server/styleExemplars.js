// Owner-calibrated speech-style exemplars for the student bot.
//
// Loads server/data/seed/style-exemplars.json ONCE (fail-soft to an empty bank)
// and exposes deterministic helpers for both the voice prompt (realtime.js) and
// the text prompt (prompt.js):
//
//   exemplarsFor(phase, n, seed)  -> n style lines for the given phase, sampled
//       ACROSS the moments whose `phases` include that phase, rotated
//       deterministically by a session-id hash (no Math.random — same seed +
//       phase always returns the same lines, covering different moments when it
//       can so the texture does not collapse onto one moment).
//   renderAddress(line, addressTerm) -> replaces standalone 'sir' (word-boundary,
//       case-insensitive, capitalisation preserved) with the address term when
//       addressTerm === "ma'am"; otherwise returns the line unchanged.
//   dials()        -> the calibration dials object (fail-soft to {}).
//   antiPatterns() -> the "never do this" array (fail-soft to []).
//
// These are STYLE anchors (texture: fillers, rhythm, light Hindi particles,
// address term), NOT scripts to repeat verbatim. The owner curated the JSON; this
// module never mutates it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "data", "seed", "style-exemplars.json");

// ---------------------------------------------------------------------------
// Load once, fail soft.
// ---------------------------------------------------------------------------
function loadBank() {
  try {
    const raw = readFileSync(SEED_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyBank();
    return {
      moments: (parsed.moments && typeof parsed.moments === "object") ? parsed.moments : {},
      dials: (parsed.dials && typeof parsed.dials === "object") ? parsed.dials : {},
      antiPatterns: Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns : [],
    };
  } catch {
    return emptyBank();
  }
}

function emptyBank() {
  return { moments: {}, dials: {}, antiPatterns: [] };
}

const BANK = loadBank();

// ---------------------------------------------------------------------------
// Deterministic hash (FNV-1a, matching disposition.js's approach — no deps,
// no Math.random). Maps an arbitrary seed string to an unsigned 32-bit int.
// ---------------------------------------------------------------------------
function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// exemplarsFor — n style lines for a phase, sampled across matching moments.
// ---------------------------------------------------------------------------
// Strategy: collect every moment whose `phases` array includes `phase`. Rotate
// the MOMENT order by the seed hash, then round-robin one line at a time from
// each moment (each moment's line list also rotated by the seed) so the result
// spreads across different moments before it ever takes a second line from one.
// Fully deterministic for a (phase, n, seed) triple.
export function exemplarsFor(phase, n = 7, seed = "") {
  const want = Math.max(0, Math.floor(Number(n) || 0));
  if (!want) return [];
  const p = Number(phase);

  // Moments matching this phase, as [name, lines[]].
  const matching = Object.entries(BANK.moments).filter(([, m]) => {
    const phases = Array.isArray(m?.phases) ? m.phases : [];
    const lines = Array.isArray(m?.lines) ? m.lines.filter((l) => typeof l === "string" && l.trim()) : [];
    return phases.includes(p) && lines.length > 0;
  });
  if (!matching.length) return [];

  const base = fnv1a(`${seed}|phase${p}`);

  // Rotate moment order deterministically.
  const momentOrder = rotate(matching, base % matching.length);

  // Pre-rotate each moment's lines deterministically (different offset per moment
  // so two phases sharing the same moments don't surface the identical line).
  const buckets = momentOrder.map(([name, m], i) => {
    const lines = m.lines.filter((l) => typeof l === "string" && l.trim()).map((l) => l.trim());
    const off = fnv1a(`${seed}|${name}|${p}`) % lines.length;
    return { lines: rotate(lines, off), idx: 0, _i: i };
  });

  // Round-robin across buckets so different moments are covered first.
  const out = [];
  const seen = new Set();
  let exhausted = 0;
  while (out.length < want && exhausted < buckets.length) {
    exhausted = 0;
    for (const b of buckets) {
      if (out.length >= want) break;
      if (b.idx >= b.lines.length) { exhausted += 1; continue; }
      const line = b.lines[b.idx];
      b.idx += 1;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out;
}

// Rotate an array left by `k` (deterministic, non-mutating).
function rotate(arr, k) {
  const len = arr.length;
  if (len <= 1) return arr.slice();
  const off = ((Math.floor(k) % len) + len) % len;
  return arr.slice(off).concat(arr.slice(0, off));
}

// ---------------------------------------------------------------------------
// renderAddress — swap standalone 'sir' -> the address term (only for "ma'am").
// ---------------------------------------------------------------------------
// Word-boundary, case-insensitive. Preserves capitalisation: a capitalised "Sir"
// (e.g. sentence-start) becomes "Ma'am"; lowercase "sir" becomes "ma'am". Any
// addressTerm other than "ma'am" (including null / "sir") leaves the line as-is,
// since the exemplars are authored with 'sir'.
export function renderAddress(line, addressTerm) {
  const text = typeof line === "string" ? line : "";
  if (addressTerm !== "ma'am") return text;
  return text.replace(/\bsir\b/gi, (match) => {
    const cap = match[0] === match[0].toUpperCase();
    return cap ? "Ma'am" : "ma'am";
  });
}

// ---------------------------------------------------------------------------
// Accessors.
// ---------------------------------------------------------------------------
export function dials() {
  return BANK.dials || {};
}

export function antiPatterns() {
  return Array.isArray(BANK.antiPatterns) ? BANK.antiPatterns : [];
}
