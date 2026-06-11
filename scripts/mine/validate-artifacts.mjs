#!/usr/bin/env node
// Shape + PII validation for server/data/seed/*.json. Exit 1 on any failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EMAIL_RE = /[\w.+-]+@[\w-]+\.\w{2,}/g;
const PROVIDER_RE = /\b(gmail|googlemail|yahoo|hotmail|outlook|rediff(?:mail)?)\b/gi;
const MOBILE_RE = /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g;

export function piiScan(artifact) {
  const str = JSON.stringify(artifact);
  const messages = [];

  for (const h of str.match(EMAIL_RE) || []) {
    messages.push(`PII email found: ${h}`);
  }
  for (const h of str.match(PROVIDER_RE) || []) {
    messages.push(`PII provider token found: ${h}`);
  }
  for (const h of str.match(MOBILE_RE) || []) {
    messages.push(`PII mobile found: ${h}`);
  }
  if (str.includes('"callId"')) {
    messages.push('callId leaked into artifact — un-redacted copy from merged.json');
  }

  return messages;
}

function req(obj, key, type, errs, ctx) {
  const v = obj?.[key];
  const ok = type === 'array' ? Array.isArray(v)
    : type === 'number' ? typeof v === 'number'
    : type === 'string' ? typeof v === 'string' && v.length > 0
    : typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!ok) errs.push(`${ctx}: missing/invalid ${key} (${type})`);
  return ok;
}

function reqStringArray(obj, key, errs, ctx, { nonEmpty = false } = {}) {
  const v = obj?.[key];
  if (!Array.isArray(v)) {
    errs.push(`${ctx}: missing/invalid ${key} (string[])`);
    return false;
  }
  let ok = true;
  v.forEach((item, idx) => {
    if (typeof item !== 'string' || item.length === 0) {
      errs.push(`${ctx}.${key}[${idx}]: expected non-empty string, got ${JSON.stringify(item)}`);
      ok = false;
    }
  });
  if (nonEmpty && v.length === 0) {
    errs.push(`${ctx}.${key} is empty`);
    ok = false;
  }
  return ok;
}

const CHECKS = {
  'archetypes.json': (a, errs) => {
    if (!req(a, 'archetypes', 'array', errs, 'root')) return;
    if (a.archetypes.length < 6 || a.archetypes.length > 10) {
      errs.push(`archetypes count ${a.archetypes.length}, want 6-10`);
    }
    const keys = [];
    a.archetypes.forEach((x, i) => {
      for (const k of ['key', 'name', 'background', 'goals', 'coreAnxiety', 'decisionDynamics', 'languageTexture']) {
        req(x, k, 'string', errs, `archetypes[${i}]`);
      }
      if (typeof x.key === 'string') keys.push(x.key);
      reqStringArray(x, 'typicalQuestions', errs, `archetypes[${i}]`, { nonEmpty: true });
      if (req(x, 'evidence', 'object', errs, `archetypes[${i}]`)) {
        req(x.evidence, 'corpusSharePct', 'number', errs, `archetypes[${i}].evidence`);
        req(x.evidence, 'conversionRatePct', 'number', errs, `archetypes[${i}].evidence`);
        // Fraction-vs-percent heuristic for corpusSharePct
        if (typeof x.evidence.corpusSharePct === 'number' && x.evidence.corpusSharePct <= 1) {
          // Only flag if we have at least 2 archetypes overall and all are <= 1
          // We'll do this after the loop
        }
      }
    });
    // Duplicate key detection
    if (new Set(keys).size !== keys.length) {
      errs.push('archetypes.json: duplicate archetype key values');
    }
    // Fraction-vs-percent heuristic for corpusSharePct: if >=2 archetypes and all <= 1
    const archsWithPct = a.archetypes.filter((x) => x.evidence && typeof x.evidence.corpusSharePct === 'number');
    if (archsWithPct.length >= 2 && archsWithPct.every((x) => x.evidence.corpusSharePct <= 1)) {
      errs.push('evidence.corpusSharePct values look like fractions (all <= 1); want percents');
    }
  },
  'objections.json': (a, errs) => {
    if (!req(a, 'categories', 'array', errs, 'root')) return;
    if (a.categories.length < 6) errs.push(`only ${a.categories.length} objection categories, want >=6`);
    const keys = [];
    a.categories.forEach((c, i) => {
      for (const k of ['key', 'label']) req(c, k, 'string', errs, `categories[${i}]`);
      if (typeof c.key === 'string') keys.push(c.key);
      req(c, 'frequencyPct', 'number', errs, `categories[${i}]`);
      for (const k of ['phrasings', 'counterMovesThatWorked', 'movesThatFailed']) {
        reqStringArray(c, k, errs, `categories[${i}]`, { nonEmpty: true });
      }
    });
    // Duplicate key detection
    if (new Set(keys).size !== keys.length) {
      errs.push('objections.json: duplicate category key values');
    }
    // Fraction-vs-percent heuristic for frequencyPct
    const withPct = a.categories.filter((c) => typeof c.frequencyPct === 'number');
    if (withPct.length >= 2 && withPct.every((c) => c.frequencyPct <= 1)) {
      errs.push('frequencyPct values look like fractions (all <= 1); want percents');
    }
  },
  'conversation-structure.json': (a, errs) => {
    if (req(a, 'phases', 'array', errs, 'root') && a.phases.length !== 5) {
      errs.push(`phases length ${a.phases.length}, want 5`);
    }
    (a.phases || []).forEach((p, i) => {
      req(p, 'name', 'string', errs, `phases[${i}]`);
      req(p, 'typicalSharePct', 'number', errs, `phases[${i}]`);
      reqStringArray(p, 'markers', errs, `phases[${i}]`, { nonEmpty: true });
    });
    reqStringArray(a, 'openingPatterns', errs, 'root', { nonEmpty: true });
    req(a, 'paymentAskNorms', 'object', errs, 'root');
    // Fraction-vs-percent heuristic for typicalSharePct
    const phases = a.phases || [];
    const withPct = phases.filter((p) => typeof p.typicalSharePct === 'number');
    if (withPct.length >= 2 && withPct.every((p) => p.typicalSharePct <= 1)) {
      errs.push('phases[].typicalSharePct values look like fractions (all <= 1); want percents');
    }
  },
  'rubric-anchors.json': (a, errs) => {
    if (!req(a, 'criteria', 'array', errs, 'root')) return;
    if (a.criteria.length !== 8) errs.push(`criteria length ${a.criteria.length}, want 8`);
    let sum = 0;
    const keys = [];
    a.criteria.forEach((c, i) => {
      for (const k of ['key', 'label']) req(c, k, 'string', errs, `criteria[${i}]`);
      if (typeof c.key === 'string') keys.push(c.key);
      if (req(c, 'weight', 'number', errs, `criteria[${i}]`)) sum += c.weight;
      if (req(c, 'anchors', 'object', errs, `criteria[${i}]`)) {
        for (const lvl of ['1', '2', '3', '4', '5']) {
          req(c.anchors, lvl, 'string', errs, `criteria[${i}].anchors`);
        }
      }
    });
    // Duplicate key detection
    if (new Set(keys).size !== keys.length) {
      errs.push('rubric-anchors.json: duplicate criteria key values');
    }
    if (Math.abs(sum - 100) > 1e-6) errs.push(`weights sum ${sum}, want 100`);
  },
  'benchmarks.json': (a, errs) => {
    if (req(a, 'text', 'object', errs, 'root')) {
      req(a.text, 'durationMin', 'object', errs, 'text');
      req(a.text, 'paidVsUnpaid', 'object', errs, 'text');
    }
    // prosody block is added by the audio pipeline later; validate shape only if present
    if (a.prosody) {
      for (const grp of ['paid', 'unpaid']) {
        if (req(a.prosody, grp, 'object', errs, 'prosody')) {
          for (const k of ['counsellorWpm', 'counsellorTalkRatio', 'counsellorPauseRatio', 'counsellorPitchVarSemitones']) {
            req(a.prosody[grp], k, 'number', errs, `prosody.${grp}`);
          }
        }
      }
    }
  },

  // ── New register artifacts ────────────────────────────────────────────────

  'register-lines.json': (a, errs) => {
    req(a, 'source', 'string', errs, 'root');
    req(a, 'totalTurns', 'number', errs, 'root');
    req(a, 'uniqueLines', 'number', errs, 'root');
    if (!req(a, 'lines', 'array', errs, 'root')) return;
    if (a.lines.length < 50) errs.push(`lines array has only ${a.lines.length} entries, want >=50`);
    const VALID_CATEGORIES = new Set(['question', 'concern', 'answer', 'backchannel']);
    const VALID_PHASES = new Set([null, 1, 2, 3, 4, 5]);
    a.lines.forEach((l, i) => {
      req(l, 'text', 'string', errs, `lines[${i}]`);
      req(l, 'count', 'number', errs, `lines[${i}]`);
      if (!VALID_CATEGORIES.has(l.category)) {
        errs.push(`lines[${i}].category "${l.category}" not in {question,concern,answer,backchannel}`);
      }
      if (!VALID_PHASES.has(l.phase)) {
        errs.push(`lines[${i}].phase ${l.phase} not in {null,1,2,3,4,5}`);
      }
      // PII heuristic: no capitalized tokens that look like names in text
      if (typeof l.text === 'string' && /\bN\s+[A-Z][a-z]+\s+\d{3}/.test(l.text)) {
        errs.push(`lines[${i}]: possible email-ID pattern detected`);
      }
    });
  },

  'voice-bank.json': (a, errs) => {
    req(a, 'source', 'string', errs, 'root');
    if (!req(a, 'stages', 'array', errs, 'root')) return;
    if (a.stages.length < 5) errs.push(`stages array has only ${a.stages.length} entries, want >=5`);
    const VALID_PHASES = new Set([1, 2, 3, 4, 5]);
    const VALID_CATEGORIES = new Set(['studying', 'graduate', 'same-field', 'diff-field', 'non-working']);
    a.stages.forEach((s, i) => {
      req(s, 'id', 'string', errs, `stages[${i}]`);
      req(s, 'name', 'string', errs, `stages[${i}]`);
      if (!req(s, 'phases', 'array', errs, `stages[${i}]`)) return;
      s.phases.forEach((p, j) => {
        if (!VALID_PHASES.has(p)) {
          errs.push(`stages[${i}].phases[${j}] = ${p} not in {1,2,3,4,5}`);
        }
      });
      if (!req(s, 'common', 'array', errs, `stages[${i}]`)) return;
      s.common.forEach((e, j) => req(e, 'text', 'string', errs, `stages[${i}].common[${j}]`));
      const bp = s.byPersona ?? {};
      Object.keys(bp).forEach((cat) => {
        if (!VALID_CATEGORIES.has(cat)) {
          errs.push(`stages[${i}].byPersona has unknown category "${cat}"`);
        }
        bp[cat].forEach((e, j) => req(e, 'text', 'string', errs, `stages[${i}].byPersona.${cat}[${j}]`));
      });
    });
  },

  'register-stats.json': (a, errs) => {
    req(a, 'source', 'string', errs, 'root');
    if (!req(a, 'byPhase', 'object', errs, 'root')) return;
    // Must have entries for phases 1–5 (phase 4 may be approximated)
    const EXPECTED_PHASES = ['1', '2', '3', '4', '5'];
    for (const p of EXPECTED_PHASES) {
      if (!a.byPhase[p]) {
        errs.push(`byPhase missing phase "${p}"`);
      } else {
        req(a.byPhase[p], 'medianWords', 'number', errs, `byPhase.${p}`);
        req(a.byPhase[p], 'turnCount', 'number', errs, `byPhase.${p}`);
      }
    }
    if (!req(a, 'phaseWordBands', 'object', errs, 'root')) return;
    for (const p of EXPECTED_PHASES) {
      if (!Array.isArray(a.phaseWordBands?.[p]) || a.phaseWordBands[p].length !== 2) {
        errs.push(`phaseWordBands.${p} must be [min, max] tuple`);
      }
    }
    if (!req(a, 'fillers', 'array', errs, 'root')) return;
    a.fillers.forEach((f, i) => req(f, 'value', 'string', errs, `fillers[${i}]`));
    // Source path must not contain Windows user paths
    const srcStr = JSON.stringify(a.source ?? '');
    if (/Users\\\\[a-zA-Z]+\\\\|Users\/[a-zA-Z]+\//.test(srcStr)) {
      errs.push('source field contains a user home path — scrub it');
    }
  },
};

export function validateArtifact(name, artifact) {
  const errs = [];
  CHECKS[name]?.(artifact, errs);
  errs.push(...piiScan(artifact));
  return errs;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'data', 'seed');
  let failed = false;
  for (const name of Object.keys(CHECKS)) {
    const path = join(seedDir, name);
    if (!existsSync(path)) { console.error(`MISSING ${name}`); failed = true; continue; }
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      console.error(`FAIL ${name} (parse error: ${e.message})`);
      failed = true;
      continue;
    }
    const errs = validateArtifact(name, artifact);
    if (errs.length) { failed = true; console.error(`FAIL ${name}\n  - ${errs.join('\n  - ')}`); }
    else console.log(`OK   ${name}`);
  }
  process.exit(failed ? 1 : 0);
}
