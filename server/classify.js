// Deterministic classifier for the counsellor's latest message. Drives the
// per-turn behaviour hint in prompt.js: a real student nods through
// explanations ("statement"), answers what they are asked ("question"), and
// asks their own questions mainly when invited ("invite"). No LLM, no deps —
// counsellor input arrives typed or via STT, so only ~half of real questions
// carry a "?" and detection must work on interrogative shape, Hinglish-aware.

// Invite = an invite frame anchored to an invite NOUN ("any questions/doubts"),
// so "do you have any earphones?" stays a plain question.
const INVITE_PATTERNS = [
  /\b(?:any|koi(?:\s+(?:aur|bhi))?|kuch|aur|more|other|further)\s+(?:other\s+|more\s+|further\s+|bhi\s+)?(?:questions?|doubts?|quer(?:y|ies)|concerns?|sawaa?l|savaa?l|shanka|confusions?)\b/i,
  /\b(?:questions?|doubts?)\s+(?:so far|till now|until now|are there)\b/i,
  /\bdo you (?:have|want to ask)\b[^.?!]*\b(?:questions?|doubts?|quer(?:y|ies)|concerns?)\b/i,
  /\bkuch\s+(?:aur\s+)?p(?:oo|u)chh?na\s+(?:hai|chah)/i,
  /\b(?:sawaa?l|savaa?l|doubt)\s+(?:hai|ho|hain)\b/i,
  /\bfeel free to ask\b/i,
  /\bwhat (?:questions?|doubts?) do you have\b/i,
  /\banything (?:else )?you (?:want|would like|'?d like) to (?:ask|know)\b/i,
  // Reversed order: "you can ask me anything" / "please ask me anything".
  /\b(?:you can|please|go ahead(?:\s+and)?)\s+ask(?:\s+me)?\s+anything\b/i,
];

// "For any queries, feel free to reach out on WhatsApp" is a goodbye, and
// "you can ask me in between or at the end" is protocol-setting — neither is
// an invitation to ask NOW. "cont(?:ract)" covers the ASR garble of "contact".
const FAREWELL_GUARD = /\b(?:feel free to (?:reach|contact|connect|whatsapp|message)|reach (?:out|me)|(?:can|may) (?:directly |always |anytime )?(?:reach|contact|call|whatsapp|message)|whats\s?app|contact (?:me|number)|point of cont(?:act|ract)|my number|later you can|after (?:the|this) call|help (?:you )?with|ask me (?:in between|at the end|later|any\s?time)|in between or at the end)\b/i;

// Confirmation tags that make a sentence rhetorical, not a real question.
// Devanagari equivalents included — the STT emits Hindi acks in Devanagari and
// "ठीक है ना?" was being classified as a real question.
const TAG_QUESTION = /(?:^|[,\s])(?:right|okay|ok|correct|theek hai|thik hai|haina|hai na|na|got it|fine|yes|yeah|clear|samajh gaye?|understood|ठीक है(?: ना)?|सही है(?: ना)?|समझ गए(?: ना)?|क्लियर|ना)\s*\?\s*$/i;

// Latin Hinglish + Devanagari interrogatives (Scribe STT transcribes spoken
// Hindi in Devanagari, so क्या/कैसे/कितना must classify like kya/kaise/kitna).
const INTERROGATIVE_START = /^(?:so,?\s+|and\s+|but\s+|toh\s+|okay,?\s+|ok,?\s+|तो\s+|अच्छा,?\s+)?(?:what|why|how|when|where|which|who(?:m|se)?|kya|kyu|kyun|kaise|kitn[aei]|kab|kaha[an]?|kaun|do|does|did|are|is|was|were|can|could|will|would|should|shall|have|has|had|may|am|क्या|क्यों|क्यूँ|कैसे|कैसा|कितन[ाेी]|कब|कहाँ|कहां|कौन)(?:\b|(?=\s))/iu;

// Imperative speak-requests carry no "?" but demand an answer:
// "Please tell me about your background.", "Introduce yourself."
const SPEAK_REQUEST = /(?:\b(?:tell me|let me know|share (?:your|with me)|walk me through|describe|explain to me|introduce yourself|bata(?:o|iye|ye|na)?|boliye)\b|बताओ|बताइए|बताइये|बोलिए)/iu;

function sentencesOf(text) {
  return String(text).split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Returns "statement" | "question" | "invite" for the counsellor's latest turn.
export function classifyCounsellorTurn(text) {
  const t = String(text || "").trim();
  if (!t) return "statement";
  const sentences = sentencesOf(t);

  // 1. Invite — scan every sentence; a farewell marker in the same sentence demotes it.
  for (const s of sentences) {
    if (INVITE_PATTERNS.some((re) => re.test(s)) && !FAREWELL_GUARD.test(s)) return "invite";
  }

  // Question shape is judged on the tail: long explanations often end in the
  // real question, while early embedded "?"s are rhetorical flow.
  const tail = sentences.slice(-2);

  // 2. Pure confirmation tag at the end -> rhetorical -> statement,
  //    unless the rest of the tail still asks something real.
  const last = sentences[sentences.length - 1] || "";
  if (TAG_QUESTION.test(last)) {
    const stripped = last.replace(TAG_QUESTION, "");
    const rest = [...tail.slice(0, -1), stripped];
    const stillAsks = rest.some(
      (s) => s.includes("?") || INTERROGATIVE_START.test(s) || SPEAK_REQUEST.test(s)
    );
    if (!stillAsks) return "statement";
  }

  // 3. Direct question / speak-request in the tail.
  for (const s of tail) {
    const noTag = s.replace(TAG_QUESTION, "");
    if (noTag.includes("?")) return "question";
    if (INTERROGATIVE_START.test(noTag)) return "question";
    if (SPEAK_REQUEST.test(noTag)) return "question";
  }

  // 4. Default: the counsellor is explaining.
  return "statement";
}
