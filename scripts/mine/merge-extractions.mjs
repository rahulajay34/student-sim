#!/usr/bin/env node
// Deterministic aggregation of per-call LLM extractions -> work/merged.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const OBJECTION_CATEGORIES = [
  'fee', 'emi_affordability', 'parents_family', 'time_commitment',
  'competing_priorities', 'trust_legitimacy', 'job_guarantee_placement',
  'course_fit_relevance', 'language_english', 'tech_access', 'other',
];

export function mergeExtractions(extractions) {
  // Determinism: sort by callId before processing
  const sorted = [...extractions].sort((a, b) => String(a.callId).localeCompare(String(b.callId)));

  const objections = {};
  for (const cat of OBJECTION_CATEGORIES) {
    objections[cat] = { count: 0, paidCount: 0, phrasings: [], moves: [] };
  }
  const archetypeHints = [], structures = [], bestMoves = [], worstMoves = [], quotes = [];

  for (const ex of sorted) {
    // Fix 8: validate that this is a flat per-call extraction (has callId)
    if (typeof ex.callId !== 'string') {
      throw new Error('extraction missing callId — input not flattened? Expected flat array of per-call extractions');
    }
    // Fix 9: guard objections — only iterate if it's an array (excludes strings and other non-array types)
    for (const o of Array.isArray(ex.objections) ? ex.objections : []) {
      const cat = OBJECTION_CATEGORIES.includes(o.category) ? o.category : 'other';
      const slot = objections[cat];
      slot.count += 1;
      if (ex.paid) slot.paidCount += 1;
      slot.phrasings.push({ callId: ex.callId, paid: ex.paid, phrasing: o.phrasing });
      slot.moves.push({ callId: ex.callId, paid: ex.paid, move: o.counsellorMove, outcome: o.moveOutcome || 'unresolved' });
    }
    if (ex.archetypeHint) archetypeHints.push({ callId: ex.callId, paid: ex.paid, ...ex.archetypeHint });
    if (ex.structure) structures.push({ callId: ex.callId, paid: ex.paid, ...ex.structure });
    bestMoves.push(...(ex.bestMoves || []).map((m) => ({ callId: ex.callId, paid: ex.paid, move: m })));
    worstMoves.push(...(ex.worstMoves || []).map((m) => ({ callId: ex.callId, paid: ex.paid, move: m })));
    quotes.push(...(ex.notableQuotes || []).map((q) => ({ callId: ex.callId, paid: ex.paid, ...q })));
  }

  return {
    totalCalls: sorted.length,
    paidCalls: sorted.filter((e) => e.paid).length,
    objections, archetypeHints, structures, bestMoves, worstMoves, quotes,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const work = join(dirname(fileURLToPath(import.meta.url)), 'work');
  const extractions = JSON.parse(readFileSync(join(work, 'extractions.json'), 'utf8'));
  const merged = mergeExtractions(extractions);
  writeFileSync(join(work, 'merged.json'), JSON.stringify(merged));
  console.log(`merged ${merged.totalCalls} calls (${merged.paidCalls} paid); ` +
    `objection volume=${Object.values(merged.objections).reduce((n, o) => n + o.count, 0)}`);
}
