#!/usr/bin/env node
// Build server/data/rubric-templates.json from the mined anchors (idempotent).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const anchors = JSON.parse(readFileSync(join(root, 'server/data/seed/rubric-anchors.json'), 'utf8'));
const template = {
  id: 'rt-grounded-v2',
  name: 'Grounded v2 (Real-Call Anchored)',
  description: 'Default rubric mined from 216 real counselling calls: 8 criteria with behaviour-anchored levels quoting real call moments. Voice Delivery is scored only in voice sessions.',
  criteria: anchors.criteria,
  isDefault: true,
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};
writeFileSync(join(root, 'server/data/rubric-templates.json'), JSON.stringify([template], null, 2) + "\n");
console.log(`seeded rubric-templates.json: ${template.criteria.length} criteria, weights sum ${template.criteria.reduce((n, c) => n + c.weight, 0)}`);
