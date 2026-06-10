#!/usr/bin/env node
// Validate server/data/courses.json shape. Exit 1 on failure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CATEGORIES = new Set(['analytics-ai', 'data-science-ai-ml', 'software-development-engineering',
  'cybersecurity', 'product-management-ai', 'marketing-analytics', 'finance-technology',
  'entrepreneurship-leadership', 'business-management']);

export function validateCourses(courses) {
  const errs = [];
  if (!Array.isArray(courses) || courses.length < 1) return ['courses must be a non-empty array'];
  const ids = new Set(), slugs = new Set();
  courses.forEach((c, i) => {
    const ctx = `courses[${i}](${c.slug || '?'})`;
    for (const k of ['id', 'slug', 'name', 'category', 'institute', 'duration', 'format', 'sourceUrl', 'scrapedAt']) {
      if (typeof c[k] !== 'string' || !c[k]) errs.push(`${ctx}: ${k} missing`);
    }
    if (!CATEGORIES.has(c.category)) errs.push(`${ctx}: bad category ${c.category}`);
    for (const k of ['feeTotal', 'feeBooking']) {
      if (!(c[k] === null || (typeof c[k] === 'number' && c[k] > 0))) errs.push(`${ctx}: ${k} must be positive number or null`);
    }
    for (const k of ['curriculum', 'outcomes', 'usps']) {
      if (!Array.isArray(c[k]) || c[k].some((x) => typeof x !== 'string' || !x)) errs.push(`${ctx}: ${k} must be string array`);
    }
    if (!Array.isArray(c.curriculum) || c.curriculum.length < 3) errs.push(`${ctx}: curriculum too thin`);
    for (const k of ['feeNote', 'emiNote', 'eligibility', 'batchInfo']) {
      if (typeof c[k] !== 'string') errs.push(`${ctx}: ${k} must be string`);
    }
    if (typeof c.active !== 'boolean') errs.push(`${ctx}: active must be boolean`);
    if (typeof c.batchInfo === 'string' && /20\d\d/.test(c.batchInfo)) {
      const years = [...c.batchInfo.matchAll(/20\d\d/g)].map((m) => Number(m[0]));
      if (years.length > 0 && years.every((y) => y < 2026)) {
        errs.push(`${ctx}: batchInfo looks past-dated`);
      }
    }
    if (ids.has(c.id)) errs.push(`${ctx}: duplicate id`);
    if (slugs.has(c.slug)) errs.push(`${ctx}: duplicate slug`);
    ids.add(c.id); slugs.add(c.slug);
  });
  return errs;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'courses.json');
  const errs = validateCourses(JSON.parse(readFileSync(p, 'utf8')));
  if (errs.length) { console.error(`FAIL\n  - ${errs.join('\n  - ')}`); process.exit(1); }
  console.log('OK courses.json');
}
