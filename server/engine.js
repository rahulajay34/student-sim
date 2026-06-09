// Generates the student's turns. Builds the chat message array from the stored
// transcript (the server owns conversation history) and the composed system prompt.
import { chat } from "./ollama.js";
import { buildSystemPrompt } from "./prompt.js";

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

export async function getFirstMessage(persona, scenario) {
  const systemPrompt = buildSystemPrompt(persona, scenario, 1, 50);
  return chat([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        "Start the conversation. Your very first message must be only a self-introduction of 2-3 sentences. Mention your background based on your persona and why you took the test. Nothing else.",
    },
  ]);
}

// transcript already includes the counsellor's latest message as the final turn.
export async function getStudentReply(persona, scenario, currentPhase, satisfactionScore, transcript) {
  const systemPrompt = buildSystemPrompt(persona, scenario, currentPhase, satisfactionScore);
  return chat([{ role: "system", content: systemPrompt }, ...transcriptToMessages(transcript)]);
}
