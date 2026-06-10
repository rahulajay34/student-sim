#!/usr/bin/env node
// Fetch curated Masai program pages -> readable text dumps for LLM extraction.
// Usage: node scripts/scrape-courses.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'scrape-work');

export const SLUGS = [
  ['iim-ranchi/business-analytics-ai-sop', 'analytics-ai'],
  ['iim-mumbai/ai-bi', 'analytics-ai'],
  ['iit-patna/ai-ml-sop', 'data-science-ai-ml'],
  ['iit-patna/gen-ai', 'data-science-ai-ml'],
  ['iit-mandi/nlp-ai-ml', 'data-science-ai-ml'],
  ['iit-patna/software-engineering-ai', 'software-development-engineering'],
  ['iit-roorkee/software-engineering', 'software-development-engineering'],
  ['iit-roorkee/cyber-security', 'cybersecurity'],
  ['pwc/cyber-security-ethical-hacking-ai', 'cybersecurity'],
  ['iim-ranchi/executive-product-management', 'product-management-ai'],
  ['iim-rohtak/digital-marketing', 'marketing-analytics'],
  ['iim-trichy/fintech-ai', 'finance-technology'],
  ['xlri/entrepreneurship', 'entrepreneurship-leadership'],
  ['rotman/data-driven-decision-making-with-gen-ai', 'business-management'],
  ['bitsom/pgp', 'business-management'],
];

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

async function fetchPage(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (catalog-build)' } });
  if (!res.ok) {
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); return fetchPage(url, attempt + 1); }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  mkdirSync(OUT, { recursive: true });
  let failed = 0;
  for (const [slug, category] of SLUGS) {
    const url = `https://www.masaischool.com/program/${slug}`;
    const file = join(OUT, `${slug.replace('/', '__')}.txt`);
    try {
      const html = await fetchPage(url);
      const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
      const desc = (html.match(/name="description" content="([^"]*)"/i) || [])[1] || '';
      const text = htmlToText(html);
      writeFileSync(file, `SOURCE_URL: ${url}\nSLUG: ${slug}\nCATEGORY: ${category}\nTITLE: ${title}\nMETA_DESCRIPTION: ${desc}\n\n${text}`);
      console.log('ok', slug, `${text.length} chars`);
    } catch (e) {
      failed++;
      console.error('FAIL', slug, e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (failed) process.exit(1);
}
