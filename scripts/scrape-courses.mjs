#!/usr/bin/env node
// Fetch curated Masai program pages -> readable text dumps for LLM extraction.
// Also extracts FAQ questions (questions only, never answers) from each page for courses.json.
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

/**
 * Extract FAQ questions from a Masai program page HTML.
 * Returns string[] of question text — NEVER the answers (knowledge-bounds invariant).
 *
 * Three observed layouts are handled:
 *   Layout 1 — accordion with span.text-[18px].!font-[600] (IIM Ranchi BA, IIT Patna, PwC, …)
 *   Layout 2 — Astro island FaqsV1/Variant* with props containing "q":[0,"…"] RSC tuples
 *              (IIM Mumbai, IIT Mandi, IIT Roorkee, IIM Ranchi PM, Rotman, …)
 *   Layout 3 — BITSoM collapse-title span.!font-[500].text-left
 */
export function extractFaqQuestions(html) {
  // Decode common HTML entities that appear in page text.
  function decodeEntities(s) {
    return s
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  const faqDivIdx = html.indexOf('id="faqs"');
  if (faqDivIdx !== -1) {
    const faqSection = html.substring(faqDivIdx, faqDivIdx + 60000);

    // Layout 1: <span class="text-[18px] !font-[600] text-[#XXXXXX] pr-[16px]">QUESTION</span>
    const re1 = /<span class="text-\[18px\] !font-\[600\] text-\[#[0-9A-Fa-f]+\] pr-\[16px\]">([^<]+)<\/span>/g;
    const q1 = [];
    let m;
    while ((m = re1.exec(faqSection)) !== null) q1.push(decodeEntities(m[1].trim()));
    if (q1.length > 0) return q1;

    // Layout 3: BITSoM — <span class="…!font-[500]…text-left…">QUESTION</span>
    const re3 = /<span class="[^"]*!font-\[500\][^"]*text-left[^"]*"[^>]*>([^<]+)<\/span>/g;
    const q3 = [];
    while ((m = re3.exec(faqSection)) !== null) q3.push(decodeEntities(m[1].trim()));
    if (q3.length > 0) return q3;
  }

  // Layout 2: Astro island props contain "q":[0,"QUESTION"] RSC tuples anywhere on page.
  // Scan all astro-island props; return questions from the first island that has any.
  const islandRe = /astro-island[^>]*props="([^"]*)"/g;
  let islandMatch;
  while ((islandMatch = islandRe.exec(html)) !== null) {
    const propsStr = islandMatch[1]
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const qRe = /"q":\[0,"([^"]+)"\]/g;
    const seen = new Set();
    const qs = [];
    let m;
    while ((m = qRe.exec(propsStr)) !== null) {
      const q = m[1].trim();
      if (!seen.has(q)) { seen.add(q); qs.push(q); }
    }
    if (qs.length > 0) return qs;
  }
  return [];
}

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
      const faqQuestions = extractFaqQuestions(html);
      writeFileSync(
        file,
        `SOURCE_URL: ${url}\nSLUG: ${slug}\nCATEGORY: ${category}\nTITLE: ${title}\nMETA_DESCRIPTION: ${desc}\n\nFAQ_QUESTIONS (${faqQuestions.length}):\n${faqQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n${text}`,
      );
      console.log('ok', slug, `${text.length} chars, ${faqQuestions.length} FAQ questions`);
    } catch (e) {
      failed++;
      console.error('FAIL', slug, e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (failed) process.exit(1);
}
