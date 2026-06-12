// _shared/lib/register.js — ported from server/register.js.
// CHANGES:
//   - Replaced readFileSync/existsSync seed loading with JSON import attributes.
//   - Removed node:fs, node:path, node:url imports entirely.
//   - loadSafe() replaced with direct JSON imports (fail-soft via try/catch at module
//     level is not needed; if JSON import fails the module fails to load, which is the
//     same fail-fast behaviour as a missing require; seed files ship with the bundle).

import registerLinesRaw from "../seed/register-lines.json" with { type: "json" };
import voiceBankRaw from "../seed/voice-bank.json" with { type: "json" };
import registerStatsRaw from "../seed/register-stats.json" with { type: "json" };

// Fail-soft: if a seed file is missing/corrupt the import will fail at module load.
// In practice these files always ship; if they are somehow absent _lines/_bank/_stats
// are left as null and the accessors return empty results.
let _lines = null;
let _bank = null;
let _stats = null;

try { _lines = registerLinesRaw; } catch { _lines = null; }
try { _bank = voiceBankRaw; } catch { _bank = null; }
try { _stats = registerStatsRaw; } catch { _stats = null; }

const _counters = {};

/**
 * Returns all register lines (student utterances from real calls), or an
 * empty array when the file is unavailable.
 * @returns {{ text: string, phase: number|null, count: number, category: string }[]}
 */
export function registerLines() {
  return _lines?.lines ?? [];
}

/**
 * Returns up to `n` voice-bank lines for a given persona category and phase,
 * rotating on consecutive calls so the same lines are not always returned first.
 * @param {string} category  - e.g. "studying", "graduate", "same-field"
 * @param {number} phase     - 1–5
 * @param {number} [n=12]    - max lines to return
 * @returns {{ text: string, synthetic: boolean }[]}
 */
export function voiceBankFor(category, phase, n = 12) {
  if (!_bank?.stages) return [];

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

  const result = [];
  for (let i = 0; i < n && i < pool.length; i++) {
    result.push(pool[(offset + i) % pool.length]);
  }
  return result;
}

/**
 * Returns word-band and filler statistics for the given phase, or null when
 * the file is unavailable or the phase has no data.
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
