#!/usr/bin/env node
// scripts/mine/diarize.mjs
//
// Stage 1b of the mining pipeline: LLM-based text diarization + denoising of
// raw counselling call transcripts (noisy ASR, no speaker labels).
//
// Reads:   scripts/mine/work/calls.json   (output of prepare.py)
// Writes:  scripts/mine/work/diarized/<callId>.json   (PII still present; git-ignored)
//
// Output shape per call:
//   { callId, turns:[{speaker:'counsellor'|'student', phase:1-5|null, text}],
//     diarizationConfidence, ambiguous, ambiguousNote }
//
// Phase labels TARGET the 5-phase model:
//   1 Opening  2 Discovery  3 Presentation  4 Objections & Negotiation  5 Close
//
// Usage:
//   node scripts/mine/diarize.mjs                 # stratified ~30-call subset
//   node scripts/mine/diarize.mjs --n 50          # custom subset size
//   node scripts/mine/diarize.mjs --all           # all calls in calls.json
//   node scripts/mine/diarize.mjs --concurrency 4
//   node scripts/mine/diarize.mjs --fixture       # dry-run on built-in fixture (no API key needed)
//
// Idempotent: skips calls already present in work/diarized/.
//
// Re-run order:
//   prepare.py -> sample.py -> make_batches.py -> extraction workflow ->
//   assemble-extractions.mjs -> merge-extractions.mjs -> synthesis agents -> validator
//   [NEW] After prepare.py: node scripts/mine/diarize.mjs [--all]
//   The diarized/ outputs feed downstream corpus-quality filters if you build them.

import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MINE_DIR = __dirname;
const REPO_ROOT = join(__dirname, "..", "..");
const WORK_DIR = join(MINE_DIR, "work");
const CALLS_JSON = join(WORK_DIR, "calls.json");
const OUT_DIR = join(WORK_DIR, "diarized");

// ---------------------------------------------------------------------------
// Model / sampling — conform to AGREED API/CONTRACT DECISIONS:
//   single model env override OLLAMA_MODEL; diarization uses DETERMINISTIC_SAMPLING
// ---------------------------------------------------------------------------
const DEFAULT_MODEL = "nemotron-3-nano:30b";
const MODEL = process.env.OLLAMA_MODEL || DEFAULT_MODEL;
const OLLAMA_URL = "https://ollama.com/api/chat";
const SAMPLING = { temperature: 0.2 };          // DETERMINISTIC_SAMPLING
const TIMEOUT_MS = 240_000;                      // 4 min per call

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const val = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const ALL = flag("--all");
const FIXTURE_MODE = flag("--fixture");
const SUBSET_N = parseInt(val("--n", "30"), 10);
const CONCURRENCY = parseInt(val("--concurrency", "4"), 10);

// ---------------------------------------------------------------------------
// API key — same load strategy as server/ollama.js (no dotenv dep)
// ---------------------------------------------------------------------------
function loadKey() {
  if (process.env.OLLAMA_API_KEY) return process.env.OLLAMA_API_KEY;
  try {
    const env = fs.readFileSync(join(REPO_ROOT, ".env"), "utf-8");
    const m = env.match(/^\s*OLLAMA_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Call-ID scheme: sha1(email|slotDate|slotTime)[:10] — matches prepare.py
// (exported so tests can verify without re-implementing it)
// ---------------------------------------------------------------------------
export function callId(email, slotDate, slotTime) {
  const key = `${email}|${slotDate}|${slotTime}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 10);
}

// ---------------------------------------------------------------------------
// Robust JSON extraction — mirrors server/ollama.js extractJson
// ---------------------------------------------------------------------------
export function extractJson(raw) {
  const s = String(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON object found in model response");
  return JSON.parse(m[0]);
}

// ---------------------------------------------------------------------------
// Valid phase values for the 5-phase model
// ---------------------------------------------------------------------------
const VALID_PHASES = new Set([1, 2, 3, 4, 5]);

// ---------------------------------------------------------------------------
// The diarization system prompt — 5-phase model
// ---------------------------------------------------------------------------
const COURSE_FACTS = `THE CALL: a counsellor sells the "Executive Certification Programme in Business Analytics & AI" (IIM Ranchi × Masai). ~6 months, 8–10 hrs/week, online + a campus immersion; qualifier test Rs 99 (already paid); counsellor pushes the student to pay Rs 4,000 NOW to block a seat; total ~Rs 62,000. Modules: SQL, Python, data viz, business analytics, ML, AI/leadership.`;

export const SYSTEM_PROMPT = `You are a transcription analyst restoring structure to a NOISY, speaker-unlabeled ASR transcript of a REAL Indian counselling video call (English / Hinglish).

Two speakers only:
- "counsellor": academic counsellor — LEADS, greets, probes background, explains the programme/fees, handles objections, pushes for the Rs 4,000 seat-blocking payment.
- "student": prospective student — introduces themselves, answers questions, raises objections (time, money/ROI, "let me ask my parents", confidence), often SHORT / passive / hesitant.

${COURSE_FACTS}

THE PROBLEM: no speaker labels, no turn boundaries (speakers switch mid-stream unmarked), plus ASR garble (invented stutter loops, mangled words/names). Infer turns + who is speaking from semantic content + the canonical 5-phase arc:

Phase 1 Opening:      greetings, audibility check ("can you hear me?"), camera ask.
Phase 2 Discovery:    counsellor asks about background/goals; student ANSWERS questions (introduces self, shares current situation, explains motivation).
Phase 3 Presentation: counsellor explains curriculum/fees/IIM brand; student gives SHORT ACKNOWLEDGEMENTS ("okay", "haan", "theek hai") — this is the LISTENING phase.
Phase 4 Objections & Negotiation: student raises concerns (fees, time, parents, job guarantee, EMI); counsellor handles them; pushback CONCENTRATES here.
Phase 5 Close:        counsellor asks for Rs 4,000 seat-block payment; student commits, defers, or declines.

REGISTER RULES (most important — this data will train a simulated student):
- PRESERVE authentic texture: keep Hinglish exactly (haan, theek hai, matlab, sir, nahi, thoda...), keep hesitations/fillers/self-corrections, keep short/passive student answers.
- Do NOT translate to clean English. Do NOT make the student articulate/polished.
- REMOVE ONLY mechanical ASR noise: invented stutter loops ("be able to be able to"), garbled repeats, pure dead-air setup chatter — UNLESS it carries natural call rhythm.
- When unsure if something is a real disfluency or ASR artifact, KEEP it.

Return ONLY a JSON object — no markdown, no commentary:
{
  "diarizationConfidence": <0.0..1.0>,
  "ambiguous": <true if long stretches were a coin-flip>,
  "ambiguousNote": "<short note or empty string>",
  "turns": [
    { "speaker": "counsellor" | "student", "phase": 1|2|3|4|5|null, "text": "<one turn, register preserved>" }
  ]
}
Phase tags: use 1–5 per the model above; null if the turn is ambiguous or clearly setup chatter. Phases generally ascend but may repeat in phase 4 (objections can recur).`;

// ---------------------------------------------------------------------------
// Build the user message for a single call
// ---------------------------------------------------------------------------
export function buildUserMessage(transcriptRaw) {
  return `Diarize this call transcript:\n\n${transcriptRaw}`;
}

// ---------------------------------------------------------------------------
// Validate and normalise turns from the LLM response
// ---------------------------------------------------------------------------
export function normaliseTurns(rawTurns) {
  if (!Array.isArray(rawTurns)) return [];
  return rawTurns
    .filter((t) => t && typeof t.text === "string" && t.text.trim() &&
                   (t.speaker === "counsellor" || t.speaker === "student"))
    .map((t) => {
      const phaseNum = Number(t.phase);
      return {
        speaker: t.speaker,
        phase: VALID_PHASES.has(phaseNum) ? phaseNum : null,
        text: t.text.trim(),
      };
    });
}

// ---------------------------------------------------------------------------
// LLM call — direct fetch (no node_modules dep for this offline script)
// ---------------------------------------------------------------------------
async function ollamaChat(messages, key) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, messages, stream: false, options: SAMPLING }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.message?.content || "";
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Stratified subset selection (mirrors old diarize-ollama.mjs)
// ---------------------------------------------------------------------------
function pickEven(arr, k) {
  if (k >= arr.length) return arr.slice();
  if (k <= 1) return [arr[Math.floor(arr.length / 2)]];
  const out = [];
  for (let i = 0; i < k; i++) {
    out.push(arr[Math.floor((i * (arr.length - 1)) / (k - 1))]);
  }
  return out;
}

function selectSubset(calls, n) {
  const paid = calls.filter((c) => c.paid).sort((a, b) => (a.transcriptChars || 0) - (b.transcriptChars || 0));
  const unpaid = calls.filter((c) => !c.paid).sort((a, b) => (a.transcriptChars || 0) - (b.transcriptChars || 0));
  const ratio = calls.length ? paid.length / calls.length : 0.18;
  const targetPaid = Math.max(1, Math.min(paid.length, Math.round(n * ratio)));
  return [...pickEven(paid, targetPaid), ...pickEven(unpaid, n - targetPaid)];
}

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------
async function runPool(items, worker, concurrency) {
  const queue = items.slice();
  let active = 0, done = 0;
  const results = [];
  return await new Promise((resolve) => {
    const next = () => {
      if (!queue.length && active === 0) return resolve(results);
      while (active < concurrency && queue.length) {
        const item = queue.shift();
        active++;
        worker(item)
          .then((r) => results.push(r))
          .catch((e) => results.push({ id: item.id, ok: false, error: e.message }))
          .finally(() => {
            active--;
            done++;
            console.log(`  [${done}/${items.length}] ${item.id}`);
            next();
          });
      }
    };
    next();
  });
}

// ---------------------------------------------------------------------------
// Diarize a single call entry (has: id, transcript, paid, durationMin, ...)
// ---------------------------------------------------------------------------
async function diarizeOne(entry, key) {
  const outPath = join(OUT_DIR, `${entry.id}.json`);
  if (fs.existsSync(outPath)) return { id: entry.id, ok: true, skipped: true };

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(entry.transcript || "") },
  ];

  let parsed, lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await ollamaChat(messages, key);
      parsed = extractJson(content);
      if (Array.isArray(parsed.turns) && parsed.turns.length) break;
      throw new Error("empty turns array from model");
    } catch (e) {
      lastErr = e;
      parsed = null;
    }
  }
  if (!parsed) throw lastErr || new Error("diarization failed after 2 attempts");

  const turns = normaliseTurns(parsed.turns);
  if (!turns.length) throw new Error("no valid turns after normalisation");

  const out = {
    callId: entry.id,
    diarizationConfidence: Math.min(1, Math.max(0, Number(parsed.diarizationConfidence) || 0)),
    ambiguous: !!parsed.ambiguous,
    ambiguousNote: typeof parsed.ambiguousNote === "string" ? parsed.ambiguousNote : "",
    turns,
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  return { id: entry.id, ok: true, turns: turns.length, confidence: out.diarizationConfidence };
}

// ---------------------------------------------------------------------------
// Fixture mode — run against bundled 2-call synthetic fixture, no API needed
// ---------------------------------------------------------------------------
const FIXTURE_CALLS = [
  {
    id: callId("fixture.student1@example.com", "2026-01-10", "10:00:00"),
    counselor: "arshiya",
    paid: true,
    durationMin: 18.0,
    transcriptChars: 900,
    transcript: `hello am i audible yes yes you are can you turn on your camera sure so myself rahul I am in final year BCA from jaipur mujhe data analytics mein jaana hai acha okay so rahul tell me what are you planning after bca job dhundh raha hoon but skills nahi hain actually so this programme is six months by IIM Ranchi with masai you learn sql python analytics and campus immersion also acha theek hai fees kitni hai total fees is 62000 but emi option hai around 10800 per month and you only need 4000 to block the seat 4000 abhi dena hoga papa se baat karni padegi yaar of course speak to your father shall i send you the payment link yes send kar dijiye main shaam tak confirm karta hoon`,
  },
  {
    id: callId("fixture.student2@example.com", "2026-01-11", "14:00:00"),
    counselor: "deepak",
    paid: false,
    durationMin: 9.5,
    transcriptChars: 650,
    transcript: `hi myself priya BCom last year graduated kiya job nahi mil rahi so thought I will try this okay priya so this programme is the best you should join what is actually taught mujhe coding bilkul nahi aati everything is covered from basics SQL python machine learning you become job ready placement guarantee hai kya because I have seen courses say job milegi but nothing happens we have good placement support 62000 is too much honestly nahi ho payega right now youtube pe bhi free mein padh sakte na youtube cannot give IIM certificate just pay 4000 now nahi sir pehle ghar discuss karungi thank you`,
  },
];

async function runFixtureMode() {
  console.log("=== diarize.mjs (fixture mode — no API call) ===");
  console.log(`Fixture calls: ${FIXTURE_CALLS.length}`);
  for (const call of FIXTURE_CALLS) {
    const out = {
      callId: call.id,
      diarizationConfidence: 0.88,
      ambiguous: false,
      ambiguousNote: "",
      turns: [
        { speaker: "student", phase: 1, text: "Hello, am I audible?" },
        { speaker: "counsellor", phase: 1, text: "Yes, you are audible." },
        { speaker: "counsellor", phase: 2, text: "Tell me about yourself." },
        { speaker: "student", phase: 2, text: "Myself Rahul, BCA final year." },
        { speaker: "counsellor", phase: 3, text: "This programme is 6 months by IIM Ranchi." },
        { speaker: "student", phase: 3, text: "Acha theek hai." },
        { speaker: "student", phase: 4, text: "Fees kitni hai? Papa se baat karni padegi." },
        { speaker: "counsellor", phase: 4, text: "EMI option hai. Block seat with 4000." },
        { speaker: "student", phase: 5, text: "Send the link, will confirm evening." },
      ],
    };
    console.log(`  ${call.id}: ${out.turns.length} turns (fixture, no LLM)`);
  }
  console.log("Fixture mode OK — validate output shape above.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (FIXTURE_MODE) return runFixtureMode();

  const KEY = loadKey();
  if (!KEY) {
    console.error("ERROR: OLLAMA_API_KEY not found (checked env + repo-root .env)");
    process.exit(1);
  }

  if (!fs.existsSync(CALLS_JSON)) {
    console.error(`ERROR: ${CALLS_JSON} not found — run prepare.py first.\n` +
      "  cd <repo> && python3 scripts/mine/prepare.py");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let calls;
  try {
    calls = JSON.parse(fs.readFileSync(CALLS_JSON, "utf-8"));
  } catch (e) {
    console.error(`ERROR: Could not parse ${CALLS_JSON}: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(calls) || calls.length === 0) {
    console.error("ERROR: calls.json is empty or not an array — re-run prepare.py");
    process.exit(1);
  }

  const selected = ALL ? calls : selectSubset(calls, Math.min(SUBSET_N, calls.length));
  const todo = selected.filter((c) => !fs.existsSync(join(OUT_DIR, `${c.id}.json`)));

  console.log("=== diarize.mjs ===");
  console.log(`Model: ${MODEL}  calls: ${calls.length}  selected: ${selected.length}  todo: ${todo.length}  concurrency: ${CONCURRENCY}`);
  if (!todo.length) {
    console.log("Nothing to do — all selected calls already diarized.");
    return;
  }

  const t0 = Date.now();
  const results = await runPool(todo, (entry) => diarizeOne(entry, KEY), CONCURRENCY);
  const ok = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.filter((r) => !r.ok);
  const elapsed = Math.round((Date.now() - t0) / 1000);

  console.log(`\nDone in ${elapsed}s.  Wrote: ${ok}  Failed: ${failed.length}`);
  if (failed.length) {
    console.error("Failed calls:\n" + failed.map((f) => `  ${f.id}: ${f.error}`).join("\n"));
  }
  console.log(`Output: ${OUT_DIR}`);
  console.log("Next: assemble-extractions.mjs (after LLM extraction workflow)");
}

// Only run when executed directly (not when imported by tests)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
