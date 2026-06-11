// register.js — fail-soft loader for real-call register artifacts.
// Missing files resolve to null and never crash the server.
//
// Exports:
//   registerLines()               → all lines from register-lines.json or []
//   voiceBankFor(category, phase, n=12) → rotated sample of lines for persona+phase
//   registerStatsFor(phase)       → word-band / filler stats for a phase or null
//
// Valid persona categories: studying | graduate | same-field | diff-field | non-working
// Phases: 1=Opening, 2=Discovery, 3=Presentation, 4=Objections+Negotiation, 5=Close

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED = join(dirname(fileURLToPath(import.meta.url)), "data", "seed");

function loadSafe(filename) {
  const path = join(SEED, filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Load once at module initialisation; null if file absent/corrupt.
const _lines = loadSafe("register-lines.json");
const _bank = loadSafe("voice-bank.json");
const _stats = loadSafe("register-stats.json");

// Module-level rotation counters keyed by `${category}-${phase}`.
const _counters = {};

/**
 * Returns all register lines (student utterances from real calls), or an
 * empty array when the file is unavailable.
 *
 * @returns {{ text: string, phase: number|null, count: number, category: string }[]}
 */
export function registerLines() {
  return _lines?.lines ?? [];
}

/**
 * Returns up to `n` voice-bank lines for a given persona category and phase,
 * rotating on consecutive calls so the same lines are not always returned first.
 *
 * Merges the stage's `common` pool with the `byPersona[category]` pool.
 * Stages whose `phases` array includes `phase` are eligible.
 *
 * @param {string} category  - e.g. "studying", "graduate", "same-field"
 * @param {number} phase     - 1–5
 * @param {number} [n=12]    - max lines to return
 * @returns {{ text: string, synthetic: boolean }[]}
 */
export function voiceBankFor(category, phase, n = 12) {
  if (!_bank?.stages) return [];

  // Collect all eligible entries from matching stages
  const pool = [];
  for (const stage of _bank.stages) {
    if (!Array.isArray(stage.phases) || !stage.phases.includes(phase)) continue;
    for (const entry of stage.common ?? []) pool.push(entry);
    for (const entry of (stage.byPersona?.[category] ?? [])) pool.push(entry);
  }

  if (pool.length === 0) return [];

  const key = `${category}-${phase}`;
  const offset = (_counters[key] ?? 0) % pool.length;
  _counters[key] = offset + n;

  // Rotate: take a window starting from `offset`, wrapping around
  const result = [];
  for (let i = 0; i < n && i < pool.length; i++) {
    result.push(pool[(offset + i) % pool.length]);
  }
  return result;
}

/**
 * Returns word-band and filler statistics for the given phase, or null when
 * the file is unavailable or the phase has no data.
 *
 * @param {number} phase - 1–5
 * @returns {{ medianWords?: number, p25Words?: number, p75Words?: number,
 *             wordBand?: [number, number], fillers?: object[] } | null}
 */
export function registerStatsFor(phase) {
  if (!_stats) return null;

  const byPhase = _stats.byPhase?.[String(phase)] ?? null;
  const wordBand = _stats.phaseWordBands?.[String(phase)] ?? null;

  if (!byPhase && !wordBand) return null;

  return {
    ...(byPhase ?? {}),
    wordBand: wordBand ?? null,
    fillers: _stats.fillers ?? [],
    hinglish: _stats.hinglish ?? null,
  };
}
