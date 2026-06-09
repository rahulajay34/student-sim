// Scores each counsellor message -10..+10 against the student's last concern.
// Runs as a separate LLM call; the result drives the live satisfaction meter.
import { chat, extractJson } from "./ollama.js";

export async function scoreMessage(counsellorMessage, lastStudentMessage) {
  const prompt = `You are evaluating a counsellor's message in a sales conversation for an IIM Ranchi programme.
The student's current concern was: ${lastStudentMessage || "(no prior student message yet)"}
The counsellor responded with: ${counsellorMessage}

Score the counsellor's response on a scale of -10 to +10 based on:
- Did they acknowledge the student's concern before responding? (+2 if yes, -2 if no)
- Did they provide specific, accurate information to address the concern? (+3 if yes, -1 if vague)
- Did they use pressure tactics or dismiss the concern? (-4 if yes)
- Did they mention relevant course benefits tied to the student's specific situation? (+2 if yes)
- Did they offer a concrete next step or solution? (+3 if yes)

Return only a JSON object with "adjustment" (integer between -10 and +10) and "reason" (one sentence).`;

  try {
    const raw = await chat([{ role: "user", content: prompt }]);
    const result = extractJson(raw);
    const adjustment = Math.max(-10, Math.min(10, Math.round(Number(result.adjustment)) || 0));
    return { adjustment, reason: result.reason || "" };
  } catch (err) {
    console.error("Scoring error:", err.message);
    return { adjustment: 0, reason: "scoring unavailable" };
  }
}
