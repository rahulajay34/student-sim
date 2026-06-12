// _shared/lib/styleExemplars.js — ported from server/styleExemplars.js.
// CHANGES:
//   - Replaced readFileSync seed loading with JSON import attribute.
//   - Removed node:fs, node:path, node:url imports entirely.
//   - loadBank() rewritten to use the imported JSON directly.

import styleExemplarsRaw from "../seed/style-exemplars.json" with { type: "json" };

function emptyBank() {
  return { moments: {}, dials: {}, antiPatterns: [] };
}

function loadBank() {
  try {
    const parsed = styleExemplarsRaw;
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

const BANK = loadBank();

function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function exemplarsFor(phase, n = 7, seed = "") {
  const want = Math.max(0, Math.floor(Number(n) || 0));
  if (!want) return [];
  const p = Number(phase);

  const matching = Object.entries(BANK.moments).filter(([, m]) => {
    const phases = Array.isArray(m?.phases) ? m.phases : [];
    const lines = Array.isArray(m?.lines) ? m.lines.filter((l) => typeof l === "string" && l.trim()) : [];
    return phases.includes(p) && lines.length > 0;
  });
  if (!matching.length) return [];

  const base = fnv1a(`${seed}|phase${p}`);

  const momentOrder = rotate(matching, base % matching.length);

  const buckets = momentOrder.map(([name, m], i) => {
    const lines = m.lines.filter((l) => typeof l === "string" && l.trim()).map((l) => l.trim());
    const off = fnv1a(`${seed}|${name}|${p}`) % lines.length;
    return { lines: rotate(lines, off), idx: 0, _i: i };
  });

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

function rotate(arr, k) {
  const len = arr.length;
  if (len <= 1) return arr.slice();
  const off = ((Math.floor(k) % len) + len) % len;
  return arr.slice(off).concat(arr.slice(0, off));
}

export function renderAddress(line, addressTerm) {
  const text = typeof line === "string" ? line : "";
  if (addressTerm !== "ma'am") return text;
  return text.replace(/\bsir\b/gi, (match) => {
    const cap = match[0] === match[0].toUpperCase();
    return cap ? "Ma'am" : "ma'am";
  });
}

export function dials() {
  return BANK.dials || {};
}

export function antiPatterns() {
  return Array.isArray(BANK.antiPatterns) ? BANK.antiPatterns : [];
}
