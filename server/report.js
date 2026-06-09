// Generates a rubric-based coaching report from a finished session's transcript.
// One LLM call produces the qualitative judgement; the overall % is computed
// deterministically from the rubric scores and weights.
import { chat, extractJson } from "./ollama.js";
import { PHASE_NAMES } from "./phases.js";

export const RUBRIC = [
  { key: "rapport", label: "Rapport & Opening", weight: 15 },
  { key: "discovery", label: "Needs Discovery", weight: 20 },
  { key: "objections", label: "Objection Handling", weight: 25 },
  { key: "knowledge", label: "Product Knowledge & Accuracy", weight: 15 },
  { key: "closing", label: "Closing & Next Steps", weight: 15 },
  { key: "communication", label: "Communication & Empathy", weight: 10 },
];

const LEVELS = { 1: "Poor", 2: "Developing", 3: "Competent", 4: "Proficient", 5: "Excellent" };

const clampScore = (n) => Math.max(1, Math.min(5, Math.round(Number(n)) || 1));
const bandFor = (pct) => (pct >= 75 ? "Excellent" : pct >= 50 ? "Good" : "Needs Work");

function transcriptText(transcript) {
  return transcript
    .map((t) => `${t.role === "counsellor" ? "COUNSELLOR" : "STUDENT"}: ${t.text}`)
    .join("\n");
}

function buildPrompt(session) {
  const rubricLines = RUBRIC.map((r) => `- ${r.key} (${r.label}, weight ${r.weight}%)`).join("\n");
  return `You are a senior sales-training coach evaluating a mock counselling call. A counsellor was selling the "Executive Certification Programme in Business Analytics and AI" (IIM Ranchi x Masai) to a simulated prospective student.

STUDENT PERSONA: ${session.personaSnapshot?.label || "student"}
SCENARIO: ${session.scenarioSnapshot?.title || "n/a"} (difficulty: ${session.scenarioSnapshot?.difficulty || "n/a"})
FINAL STUDENT SATISFACTION: ${session.satisfactionScore}/100 (agreement threshold is 70)

FULL TRANSCRIPT:
${transcriptText(session.transcript)}

Evaluate the COUNSELLOR (not the student) on these rubric criteria, each scored 1-5:
${rubricLines}

Return ONLY a JSON object with this exact shape:
{
  "rubric": [ { "key": "rapport", "score": 1-5, "justification": "one sentence grounded in the transcript" }, ... one per criterion ],
  "phaseBreakdown": [ { "phase": 1, "summary": "...", "didWell": "...", "toImprove": "..." }, ... for phases 1-4 ],
  "strengths": [ { "point": "...", "quote": "short quote from the counsellor" }, ... 2-3 items ],
  "improvements": [ { "point": "...", "quote": "short quote", "suggestion": "concrete advice" }, ... 2-3 items ],
  "outcome": "Converted" | "Not Converted",
  "outcomeDetail": "one sentence on whether the student agreed to pay the 4000 rupee seat fee and why"
}
Score honestly and specifically. Do not output anything except the JSON object.`;
}

function fallback() {
  return {
    rubric: RUBRIC.map((r) => ({ key: r.key, score: 3, justification: "Automatic evaluation was unavailable for this session." })),
    phaseBreakdown: [1, 2, 3, 4].map((p) => ({ phase: p, name: PHASE_NAMES[p], summary: "Not evaluated.", didWell: "", toImprove: "" })),
    strengths: [],
    improvements: [],
    outcome: "Not Converted",
    outcomeDetail: "Report generation fell back to defaults.",
  };
}

export async function generateReport(session, { counsellorName } = {}) {
  let parsed;
  try {
    parsed = extractJson(await chat([{ role: "user", content: buildPrompt(session) }]));
  } catch (err) {
    console.error("Report generation error:", err.message);
    parsed = fallback();
  }

  // Normalise rubric, fill missing keys, attach labels/weights/levels.
  const byKey = Object.fromEntries((parsed.rubric || []).map((r) => [r.key, r]));
  const rubric = RUBRIC.map((def) => {
    const got = byKey[def.key] || {};
    const score = clampScore(got.score);
    return { key: def.key, label: def.label, weight: def.weight, score, level: LEVELS[score], justification: got.justification || "" };
  });

  const totalWeight = RUBRIC.reduce((s, r) => s + r.weight, 0);
  const percent = Math.round(rubric.reduce((s, r) => s + (r.score / 5) * r.weight, 0) / totalWeight * 100);

  const phaseBreakdown = [1, 2, 3, 4].map((p) => {
    const got = (parsed.phaseBreakdown || []).find((x) => Number(x.phase) === p) || {};
    return { phase: p, name: PHASE_NAMES[p], summary: got.summary || "", didWell: got.didWell || "", toImprove: got.toImprove || "" };
  });

  const outcome = parsed.outcome === "Converted" ? "Converted" : "Not Converted";

  return {
    overall: { percent, band: bandFor(percent), outcome, outcomeDetail: parsed.outcomeDetail || "" },
    rubric,
    phaseBreakdown,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    scoreArc: (session.scoreHistory || []).map((h) => ({ turn: h.turn, score: h.score })),
    counsellorName: counsellorName || "",
    personaName: session.personaSnapshot?.name || "",
    scenarioTitle: session.scenarioSnapshot?.title || "",
  };
}
