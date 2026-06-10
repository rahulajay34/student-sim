export const meta = {
  name: 'mine-transcripts',
  description: 'Extract structured patterns from 216 real counselling calls (27 batches, sonnet agents)',
  phases: [{ title: 'Extract', detail: 'one sonnet agent per 8-call batch; writes extraction JSON to disk', model: 'sonnet' }],
}

const SUMMARY = {
  type: 'object',
  required: ['batchId', 'callsExtracted', 'objectionEvents', 'outputFile'],
  properties: {
    batchId: { type: 'string' },
    callsExtracted: { type: 'number' },
    objectionEvents: { type: 'number' },
    outputFile: { type: 'string' },
  },
}

phase('Extract')
const batchFiles = Array.from({ length: 27 }, (_, i) => `/Users/rahul/Downloads/student-sim/scripts/mine/work/batches/batch-${String(i + 1).padStart(2, '0')}.json`)
const results = await parallel(batchFiles.map((f) => () => {
  const batchId = f.split('/').pop().replace('.json', '')
  const outFile = `/Users/rahul/Downloads/student-sim/scripts/mine/work/extractions/${batchId}.extraction.json`
  return agent(
`You are a meticulous conversation-data miner working on REAL sales-counselling call transcripts (Masai School admission counselling for Indian students). Your batch file: ${f}

STEP 1 — Dump the batch to readable text (transcripts are single giant lines; do NOT use Read directly on the JSON). Run this exact Bash command:
node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync("${f}","utf8"));const wrap=t=>t.replace(/(.{1,150})(\\s+|$)/g,"$1\\n");let out="";for(const c of b.calls){out+="\\n===== CALL "+c.id+" | paid="+c.paid+" | duration="+c.durationMin+"min =====\\n"+wrap(c.transcript)+"\\n";}fs.writeFileSync("/tmp/mine-${batchId}.txt",out);console.log("calls:",b.calls.length);'

STEP 2 — Read /tmp/mine-${batchId}.txt fully (use offset/limit if needed; typical size 1500-3000 lines).

STEP 3 — For EACH call in the batch, produce one extraction object:
{
  "callId": "<the id from the ===== header>",
  "paid": <the paid flag from the header>,
  "archetypeHint": {
    "background": "who this student is (fresher/working/year gap, degree, city tier if mentioned)",
    "goal": "what they want from the course",
    "anxiety": "their core worry",
    "decisionDynamics": "who/what drives the decision (parents fund it, employer, savings, exam backup plan...)",
    "languageTexture": "how they speak: Hinglish phrases, fillers, formality, confidence (with 1-2 short verbatim examples, names redacted)"
  },
  "objections": [ for EVERY distinct objection the student raises:
    { "category": one of ["fee","emi_affordability","parents_family","time_commitment","competing_priorities","trust_legitimacy","job_guarantee_placement","course_fit_relevance","language_english","tech_access","other"],
      "phrasing": "short near-verbatim quote, redacted",
      "counsellorMove": "what the counsellor did in response",
      "moveOutcome": "defused" | "escalated" | "unresolved" (judge from what followed) }
  ],
  "structure": {
    "opening": "how the call opens (audibility check, intro pattern...)",
    "presentationStartsAtPct": <0-100 position where fee/curriculum presentation begins, null if absent>,
    "paymentAskAtPct": <0-100 position where counsellor asks for payment/booking, null if absent>,
    "closeType": "how it ends: payment commitment / follow-up scheduled / brush-off / abrupt..."
  },
  "bestMoves": ["counsellor behaviours that visibly helped"],
  "worstMoves": ["counsellor behaviours that visibly hurt"],
  "notableQuotes": [ 1-3 per call: { "speaker": "student"|"counsellor", "quote": "redacted verbatim", "why": "why it matters" } ]
}

CRITICAL RULES:
- Transcripts have NO speaker labels — infer speakers from content (counsellor opens with audibility checks/intro, presents fees; student answers about background).
- REDACTION: replace any person name inside quotes/phrasings with [Student] or [Counsellor]. NEVER output emails, phone numbers, or spoken-form emails ("938 at the rate gmail" → write [email]). Numbers that are fees/durations are fine and valuable.
- Calls with tiny/garbage transcripts (<200 chars): still emit an extraction with empty objections/quotes arrays and best-effort structure ("opening": "n/a" etc.).
- Position percentages are rough estimates from where text appears in the transcript.

STEP 4 — Write the file ${outFile} with the Write tool, containing EXACTLY: {"extractions": [<one object per call, in batch order>]}

STEP 5 — Return the summary: batchId="${batchId}", callsExtracted=<count>, objectionEvents=<total objections across calls>, outputFile="${outFile}".`,
    { model: 'sonnet', schema: SUMMARY, label: batchId, phase: 'Extract' }
  )
}))

const ok = results.filter(Boolean)
const calls = ok.reduce((n, r) => n + r.callsExtracted, 0)
const objections = ok.reduce((n, r) => n + r.objectionEvents, 0)
log(`${ok.length}/${batchFiles.length} batches done; ${calls} calls, ${objections} objection events`)
return { batchesDone: ok.length, batchesTotal: batchFiles.length, calls, objections, failed: batchFiles.length - ok.length }