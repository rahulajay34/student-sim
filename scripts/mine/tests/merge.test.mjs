import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeExtractions, OBJECTION_CATEGORIES } from '../merge-extractions.mjs';

const ex = (callId, paid, objections = [], extra = {}) => ({
  callId, paid,
  archetypeHint: { background: 'b', goal: 'g', anxiety: 'a', decisionDynamics: 'd', languageTexture: 'l' },
  objections,
  structure: { opening: 'o', presentationStartsAtPct: 30, paymentAskAtPct: 80, closeType: 'soft' },
  bestMoves: ['empathised'], worstMoves: ['rushed'],
  notableQuotes: [{ speaker: 'student', quote: 'q', why: 'w' }],
  ...extra,
});

test('aggregates objections by category with paid split', () => {
  const merged = mergeExtractions([
    ex('c1', true, [{ category: 'fee', phrasing: 'p1', counsellorMove: 'm1', moveOutcome: 'defused' }]),
    ex('c2', false, [{ category: 'fee', phrasing: 'p2', counsellorMove: 'm2', moveOutcome: 'escalated' },
                     { category: 'bogus', phrasing: 'p3', counsellorMove: 'm3', moveOutcome: 'unresolved' }]),
  ]);
  assert.equal(merged.totalCalls, 2);
  assert.equal(merged.paidCalls, 1);
  assert.equal(merged.objections.fee.count, 2);
  assert.equal(merged.objections.fee.paidCount, 1);
  assert.equal(merged.objections.other.count, 1);          // unknown category folded into 'other'
  assert.equal(merged.objections.fee.phrasings.length, 2);
  assert.equal(merged.objections.fee.moves[1].outcome, 'escalated');
});

test('pools archetype hints, structures, moves, quotes', () => {
  const merged = mergeExtractions([ex('c1', true), ex('c2', false)]);
  assert.equal(merged.archetypeHints.length, 2);
  assert.equal(merged.structures.length, 2);
  assert.equal(merged.bestMoves.length, 2);
  assert.equal(merged.worstMoves.length, 2);
  assert.equal(merged.quotes.length, 2);
  assert.ok(OBJECTION_CATEGORIES.includes('parents_family'));
});

// ── New merge tests ──────────────────────────────────────────────────────────

test('mergeExtractions: single extraction with no objections does not crash', () => {
  const merged = mergeExtractions([{ callId: 'c', paid: true }]);
  assert.equal(merged.totalCalls, 1);
  assert.equal(merged.paidCalls, 1);
  // All objection categories present with zero volume
  const totalVolume = Object.values(merged.objections).reduce((n, o) => n + o.count, 0);
  assert.equal(totalVolume, 0, 'zero objection volume when none provided');
});

test('mergeExtractions: wrapper-object input (missing callId) throws', () => {
  // Passing an object that looks like a wrapped array (not a flat per-call extraction)
  assert.throws(
    () => mergeExtractions([{ extractions: [] }]),
    (err) => err instanceof Error && err.message.includes('callId'),
  );
});

test('mergeExtractions: determinism — two extractions in either order produce identical output', () => {
  const e1 = ex('aaa', true, [{ category: 'fee', phrasing: 'p1', counsellorMove: 'm1', moveOutcome: 'defused' }]);
  const e2 = ex('zzz', false, [{ category: 'time_commitment', phrasing: 'p2', counsellorMove: 'm2', moveOutcome: 'unresolved' }]);

  const resultAB = JSON.stringify(mergeExtractions([e1, e2]));
  const resultBA = JSON.stringify(mergeExtractions([e2, e1]));

  assert.equal(resultAB, resultBA, 'output should be identical regardless of input order');
});
