// Generates the student's turns. Builds the chat message array from the stored
// transcript (the server owns conversation history) and the composed system prompt.
import { chat } from "./ollama.js";
import { buildSystemPrompt } from "./prompt.js";

const EMOTION_TAG_RE = /\[emotion:\s*([a-z ]{0,30})\]/gi;
const VALID_EMOTIONS = new Set(["neutral", "happy", "hesitant", "worried", "frustrated", "excited"]);

// Parses the [emotion:X] tag from anywhere in the LLM output, strips all
// occurrences (generic regex — no enum in the pattern), and returns { text, emotion }.
// Validates the FIRST captured value against the 6-value enum; falls back to "neutral".
export function parseEmotion(raw) {
  let emotion = "neutral";
  let firstCapture = null;

  // Replace all [emotion:...] tags with a single space; capture the first value.
  const text = raw.replace(EMOTION_TAG_RE, (_match, val) => {
    if (firstCapture === null) firstCapture = val.trim().toLowerCase();
    return " ";
  }).replace(/  +/g, " ").trim();

  if (firstCapture !== null && VALID_EMOTIONS.has(firstCapture)) {
    emotion = firstCapture;
  }

  return { text, emotion };
}

// Maps the stored transcript into Ollama's alternating user/assistant format.
// student -> assistant, counsellor -> user. The opening student message has no
// preceding user turn, so we inject a synthetic trigger to keep roles alternating.
function transcriptToMessages(transcript) {
  const msgs = [];
  if (transcript.length > 0 && transcript[0].role === "student") {
    msgs.push({ role: "user", content: "Start the conversation. Please introduce yourself briefly." });
  }
  for (const t of transcript) {
    msgs.push({ role: t.role === "student" ? "assistant" : "user", content: t.text });
  }
  return msgs;
}

export async function getFirstMessage(persona, scenario, course) {
  const systemPrompt = buildSystemPrompt(persona, scenario, 1, 50, course);
  const raw = await chat([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        "Start the conversation. Your very first message must be only a self-introduction of 2-3 sentences. Mention your background based on your persona and why you took the test. Nothing else.",
    },
  ]);
  return parseEmotion(raw);
}

// transcript already includes the counsellor's latest message as the final turn.
export async function getStudentReply(session) {
  const { personaSnapshot, scenarioSnapshot, currentPhase, satisfactionScore, transcript, courseSnapshot } = session;
  const systemPrompt = buildSystemPrompt(personaSnapshot, scenarioSnapshot, currentPhase, satisfactionScore, courseSnapshot);
  const raw = await chat([{ role: "system", content: systemPrompt }, ...transcriptToMessages(transcript)]);
  return parseEmotion(raw);
}
