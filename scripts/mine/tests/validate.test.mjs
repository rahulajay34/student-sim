import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArtifact, piiScan } from '../validate-artifacts.mjs';

const goodAnchors = {
  criteria: ['rapport', 'discovery', 'presentation', 'objections', 'knowledge', 'closing', 'communication', 'voice_delivery']
    .map((key, i) => ({
      key, label: key, weight: [10, 15, 15, 20, 15, 10, 10, 5][i],
      anchors: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e' },
    })),
};

test('accepts valid rubric-anchors', () => {
  assert.deepEqual(validateArtifact('rubric-anchors.json', goodAnchors), []);
});

test('rejects weights not summing to 100', () => {
  const bad = structuredClone(goodAnchors);
  bad.criteria[0].weight = 50;
  assert.ok(validateArtifact('rubric-anchors.json', bad).length > 0);
});

test('rejects archetypes outside 6-10 range', () => {
  const errs = validateArtifact('archetypes.json', { archetypes: [] });
  assert.ok(errs.length > 0);
});

test('pii scan catches emails', () => {
  assert.ok(piiScan({ a: 'reach me at foo.bar@gmail.com' }).length > 0);
  assert.equal(piiScan({ a: 'fee is 50,000 plus GST' }).length, 0);
});

// ── objections.json ───────────────────────────────────────────────────────────

function makeObjCategory(key, overrides = {}) {
  return {
    key,
    label: key,
    frequencyPct: 15,
    phrasings: ['I cannot afford it', 'It is too expensive'],
    counterMovesThatWorked: ['Offered EMI breakdown', 'Shared ROI stats'],
    movesThatFailed: ['Discounted immediately', 'Ignored concern'],
    ...overrides,
  };
}

const goodObjections = {
  categories: [
    makeObjCategory('fee'),
    makeObjCategory('emi_affordability'),
    makeObjCategory('parents_family'),
    makeObjCategory('time_commitment'),
    makeObjCategory('trust_legitimacy'),
    makeObjCategory('job_guarantee'),
  ],
};

test('objections.json: valid artifact with >=6 categories passes', () => {
  assert.deepEqual(validateArtifact('objections.json', goodObjections), []);
});

test('objections.json: object-shaped phrasings items fail (string-item + callId pii)', () => {
  const bad = structuredClone(goodObjections);
  bad.categories[0].phrasings = [{ callId: 'c1', phrasing: 'too costly' }];
  const errs = validateArtifact('objections.json', bad);
  assert.ok(errs.length > 0, 'should have errors');
  // Must flag the non-string item
  assert.ok(errs.some((e) => e.includes('phrasings')), 'should flag phrasings item type');
  // Must also flag callId PII
  assert.ok(errs.some((e) => e.includes('callId')), 'should flag callId PII');
});

test('objections.json: all-fractions frequencyPct fails', () => {
  const bad = {
    categories: [
      makeObjCategory('fee', { frequencyPct: 0.3 }),
      makeObjCategory('emi_affordability', { frequencyPct: 0.2 }),
      makeObjCategory('parents_family', { frequencyPct: 0.15 }),
      makeObjCategory('time_commitment', { frequencyPct: 0.1 }),
      makeObjCategory('trust_legitimacy', { frequencyPct: 0.15 }),
      makeObjCategory('job_guarantee', { frequencyPct: 0.1 }),
    ],
  };
  const errs = validateArtifact('objections.json', bad);
  assert.ok(errs.some((e) => e.includes('fractions') && e.includes('frequencyPct')));
});

// ── conversation-structure.json ───────────────────────────────────────────────

function makePhase(name, overrides = {}) {
  return { name, typicalSharePct: 20, markers: ['opened with greeting', 'introduced purpose'], ...overrides };
}

const goodConvStructure = {
  phases: [
    makePhase('opening'),
    makePhase('rapport_building'),
    makePhase('course_presentation'),
    makePhase('objection_handling'),
    makePhase('closing'),
  ],
  openingPatterns: ['Introduced self and programme', 'Asked about background'],
  paymentAskNorms: { medianAtPct: 80, range: '70-90' },
};

test('conversation-structure.json: valid 5-phase artifact passes', () => {
  assert.deepEqual(validateArtifact('conversation-structure.json', goodConvStructure), []);
});

test('conversation-structure.json: 4 phases fails', () => {
  const bad = structuredClone(goodConvStructure);
  bad.phases = bad.phases.slice(0, 4);
  const errs = validateArtifact('conversation-structure.json', bad);
  assert.ok(errs.some((e) => e.includes('phases length')));
});

test('conversation-structure.json: paymentAskNorms as array fails', () => {
  const bad = structuredClone(goodConvStructure);
  bad.paymentAskNorms = [{ medianAtPct: 80 }];
  const errs = validateArtifact('conversation-structure.json', bad);
  assert.ok(errs.some((e) => e.includes('paymentAskNorms')));
});

// ── benchmarks.json ───────────────────────────────────────────────────────────

const goodBenchmarks = {
  text: {
    durationMin: { median: 22, p25: 15, p75: 30 },
    paidVsUnpaid: { paidMedianMin: 28, unpaidMedianMin: 18 },
  },
};

const goodProsody = {
  paid: {
    counsellorWpm: 145,
    counsellorTalkRatio: 0.55,
    counsellorPauseRatio: 0.08,
    counsellorPitchVarSemitones: 3.2,
  },
  unpaid: {
    counsellorWpm: 160,
    counsellorTalkRatio: 0.65,
    counsellorPauseRatio: 0.05,
    counsellorPitchVarSemitones: 1.8,
  },
};

test('benchmarks.json: valid text block passes', () => {
  assert.deepEqual(validateArtifact('benchmarks.json', goodBenchmarks), []);
});

test('benchmarks.json: valid text block with prosody passes', () => {
  const artifact = { ...goodBenchmarks, prosody: goodProsody };
  assert.deepEqual(validateArtifact('benchmarks.json', artifact), []);
});

test('benchmarks.json: prosody missing counsellorWpm fails', () => {
  const bad = structuredClone({ ...goodBenchmarks, prosody: goodProsody });
  delete bad.prosody.paid.counsellorWpm;
  const errs = validateArtifact('benchmarks.json', bad);
  assert.ok(errs.some((e) => e.includes('counsellorWpm')));
});

// ── rubric-anchors duplicate keys and float weights ───────────────────────────

test('rubric-anchors: duplicate key values fail', () => {
  const bad = structuredClone(goodAnchors);
  bad.criteria[1].key = bad.criteria[0].key; // make duplicate
  const errs = validateArtifact('rubric-anchors.json', bad);
  assert.ok(errs.some((e) => e.includes('duplicate')));
});

test('rubric-anchors: float weights summing to exactly 100 pass the SUM check', () => {
  // 8 × 12.5 = 100.0
  const floatAnchors = {
    criteria: ['rapport', 'discovery', 'presentation', 'objections', 'knowledge', 'closing', 'communication', 'voice_delivery']
      .map((key) => ({
        key, label: key, weight: 12.5,
        anchors: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e' },
      })),
  };
  const errs = validateArtifact('rubric-anchors.json', floatAnchors);
  assert.ok(!errs.some((e) => e.includes('weights sum')), `should not flag sum: ${errs}`);
});

// ── piiScan extended ─────────────────────────────────────────────────────────

test('piiScan: spoken-form provider token is flagged', () => {
  // "938 at the rate gmail dot com" — contains the word gmail as a token
  const hits = piiScan({ contact: '938 at the rate gmail dot com' });
  assert.ok(hits.length > 0, 'should flag gmail provider token');
  assert.ok(hits.some((h) => h.includes('gmail')));
});

test('piiScan: Indian mobile number is flagged', () => {
  const hits = piiScan({ msg: 'call me on 6396651918' });
  assert.ok(hits.length > 0, 'should flag mobile number');
  assert.ok(hits.some((h) => h.includes('mobile')));
});

test('piiScan: spaced mobile number is flagged', () => {
  const hits = piiScan({ msg: 'reach me at 98765 43210' });
  assert.ok(hits.length > 0, 'should flag spaced mobile');
});

test('piiScan: object with callId key is flagged', () => {
  const hits = piiScan({ callId: 'abc123', text: 'hello world' });
  assert.ok(hits.some((h) => h.includes('callId')));
});

test('piiScan: clean marketing text has zero hits', () => {
  // No email, no provider tokens, no mobile numbers, no callId
  const hits = piiScan({
    title: 'IIM Ranchi Analytics Programme',
    description: 'Advance your career with data science skills. Fee: 50000. Batch starts July 2026.',
    contact: 'Reach the admissions team via the website.',
  });
  assert.equal(hits.length, 0, `expected 0 hits but got: ${hits}`);
});

// ── archetypes duplicate keys fail ───────────────────────────────────────────

function makeArchetype(key, overrides = {}) {
  return {
    key,
    name: `Archetype ${key}`,
    background: 'Working professional',
    goals: 'Career advancement',
    coreAnxiety: 'Job security',
    decisionDynamics: 'Analytical',
    languageTexture: 'Formal',
    typicalQuestions: ['What is the ROI?', 'What is the placement rate?'],
    evidence: { corpusSharePct: 20, conversionRatePct: 35 },
    ...overrides,
  };
}

const goodArchetypes = {
  archetypes: [
    makeArchetype('analytical'),
    makeArchetype('aspirational'),
    makeArchetype('cautious'),
    makeArchetype('dependent'),
    makeArchetype('pragmatic'),
    makeArchetype('skeptical'),
  ],
};

test('archetypes: valid artifact with 6 unique keys passes', () => {
  assert.deepEqual(validateArtifact('archetypes.json', goodArchetypes), []);
});

test('archetypes: duplicate key values fail', () => {
  const bad = structuredClone(goodArchetypes);
  bad.archetypes[1].key = bad.archetypes[0].key; // duplicate
  const errs = validateArtifact('archetypes.json', bad);
  assert.ok(errs.some((e) => e.includes('duplicate')));
});
