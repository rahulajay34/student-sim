#!/usr/bin/env node
// Assemble + validate per-batch extraction files (written by workflow agents)
// into work/extractions.json for merge-extractions.mjs.
// Validation mirrors schemas/extraction.schema.json (hand-rolled, no deps).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WORK = join(dirname(fileURLToPath(import.meta.url)), 'work');
const EXT_DIR = join(WORK, 'extractions');

const CATEGORIES = new Set([
  'fee', 'emi_affordability', 'parents_family', 'time_commitment',
  'competing_priorities', 'trust_legitimacy', 'job_guarantee_placement',
  'course_fit_relevance', 'language_english', 'tech_access', 'other',
]);
const OUTCOMES = new Set(['defused', 'escalated', 'unresolved']);
const SPEAKERS = new Set(['student', 'counsellor']);
const HINT_KEYS = ['background', 'goal', 'anxiety', 'decisionDynamics', 'languageTexture'];

function validateExtraction(ex, errs, ctx) {
  if (typeof ex.callId !== 'string') errs.push(`${ctx}: callId missing`);
  if (typeof ex.paid !== 'boolean') errs.push(`${ctx}: paid not boolean`);
  for (const k of HINT_KEYS) {
    if (typeof ex.archetypeHint?.[k] !== 'string' || !ex.archetypeHint[k]) {
      errs.push(`${ctx}: archetypeHint.${k} missing`);
    }
  }
  if (!Array.isArray(ex.objections)) errs.push(`${ctx}: objections not array`);
  for (const [j, o] of (Array.isArray(ex.objections) ? ex.objections : []).entries()) {
    if (!CATEGORIES.has(o.category)) errs.push(`${ctx}.objections[${j}]: bad category ${o.category}`);
    if (!OUTCOMES.has(o.moveOutcome)) errs.push(`${ctx}.objections[${j}]: bad moveOutcome ${o.moveOutcome}`);
    if (typeof o.phrasing !== 'string' || typeof o.counsellorMove !== 'string') {
      errs.push(`${ctx}.objections[${j}]: phrasing/counsellorMove not strings`);
    }
  }
  const st = ex.structure || {};
  if (typeof st.opening !== 'string' || typeof st.closeType !== 'string') {
    errs.push(`${ctx}: structure.opening/closeType missing`);
  }
  for (const k of ['presentationStartsAtPct', 'paymentAskAtPct']) {
    if (!(st[k] === null || typeof st[k] === 'number')) errs.push(`${ctx}: structure.${k} not number|null`);
  }
  for (const k of ['bestMoves', 'worstMoves']) {
    if (!Array.isArray(ex[k]) || ex[k].some((m) => typeof m !== 'string')) {
      errs.push(`${ctx}: ${k} not string array`);
    }
  }
  if (!Array.isArray(ex.notableQuotes)) errs.push(`${ctx}: notableQuotes not array`);
  for (const [j, q] of (Array.isArray(ex.notableQuotes) ? ex.notableQuotes : []).entries()) {
    if (!SPEAKERS.has(q.speaker) || typeof q.quote !== 'string' || typeof q.why !== 'string') {
      errs.push(`${ctx}.notableQuotes[${j}]: bad quote entry`);
    }
  }
}

const expectedIds = new Set();
for (const f of readdirSync(join(WORK, 'batches')).filter((f) => f.endsWith('.json')).sort()) {
  for (const c of JSON.parse(readFileSync(join(WORK, 'batches', f), 'utf8')).calls) expectedIds.add(c.id);
}

const all = [];
const errs = [];
const files = readdirSync(EXT_DIR).filter((f) => f.endsWith('.json')).sort();
for (const f of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(EXT_DIR, f), 'utf8'));
  } catch (e) {
    errs.push(`${f}: parse error ${e.message}`);
    continue;
  }
  const list = Array.isArray(data) ? data : data.extractions;
  if (!Array.isArray(list)) { errs.push(`${f}: no extractions array`); continue; }
  for (const [i, ex] of list.entries()) validateExtraction(ex, errs, `${f}[${i}]`);
  all.push(...list);
}

const seen = new Set(all.map((e) => e.callId));
const missing = [...expectedIds].filter((id) => !seen.has(id));
const dupes = all.length - seen.size;
const unexpected = [...seen].filter((id) => !expectedIds.has(id));

if (errs.length) console.error(`VALIDATION ERRORS (${errs.length}):\n  - ${errs.slice(0, 40).join('\n  - ')}`);
if (missing.length) console.error(`MISSING ${missing.length} callIds: ${missing.join(', ')}`);
if (unexpected.length) console.error(`UNEXPECTED callIds: ${unexpected.join(', ')}`);
if (dupes) console.error(`DUPLICATE extractions: ${dupes}`);

if (errs.length || missing.length || unexpected.length || dupes) process.exit(1);
writeFileSync(join(WORK, 'extractions.json'), JSON.stringify(all));
console.log(`assembled ${all.length} extractions from ${files.length} batch files; coverage complete`);
