// Persona personality system — per-persona trait schema + per-session flavour roll.
//
// Each persona carries a `personality` object (optional; DEFAULT_PERSONALITY is
// used when absent for backward compatibility with old data). At session start,
// rollSessionFlavour() picks a small per-session variation so consecutive runs
// of the same persona feel slightly different. renderPersonalitySection() turns
// the resolved flavour into a prompt-ready text block for injection by prompt.js.
//
// Trait schema:
//   talkativeness  1-5  (1 = very terse, 5 = chatty/verbose)
//   humour         1-5  (1 = completely serious, 5 = frequent jokes/light banter)
//   skepticism     1-5  (1 = trusting/open, 5 = hard to convince, questions everything)
//   formality      1-5  (1 = very informal/Hinglish, 5 = formal/polished English)
//   quirks         string[]  (2-4 short behavioural traits for flavour variety)
//   notes          string    (free-text catch-all for unusual traits)

export const DEFAULT_PERSONALITY = {
  talkativeness: 2,
  humour: 2,
  skepticism: 3,
  formality: 2,
  quirks: [],
  notes: "",
};

const MOODS = ["upbeat", "tired", "distracted", "chatty", "guarded"];

// Returns a per-session flavour object derived from the persona's personality.
// Uses standard Math.random() — this is application code, not a test/seed utility.
//
// Returned shape:
//   mood           'upbeat'|'tired'|'distracted'|'chatty'|'guarded'
//   activeQuirks   string[]  (1-2 quirks randomly selected from personality.quirks)
//   talkativeness  number    (personality value ±1, clamped 1-5)
//   humour         number    (base, no jitter — mood drives delivery instead)
//   skepticism     number    (base)
//   formality      number    (base)
//   notes          string
export function rollSessionFlavour(personality) {
  const p = personality && typeof personality === "object" ? personality : DEFAULT_PERSONALITY;

  const talkativeness = Math.min(5, Math.max(1,
    (p.talkativeness ?? DEFAULT_PERSONALITY.talkativeness) + (Math.random() < 0.5 ? 1 : -1)
  ));

  const mood = MOODS[Math.floor(Math.random() * MOODS.length)];

  const quirks = Array.isArray(p.quirks) ? p.quirks : [];
  let activeQuirks = [];
  if (quirks.length > 0) {
    // Shuffle a copy, take 1 or 2
    const shuffled = [...quirks].sort(() => Math.random() - 0.5);
    const count = quirks.length === 1 ? 1 : 1 + Math.floor(Math.random() * 2); // 1 or 2
    activeQuirks = shuffled.slice(0, count);
  }

  return {
    mood,
    activeQuirks,
    talkativeness,
    humour: p.humour ?? DEFAULT_PERSONALITY.humour,
    skepticism: p.skepticism ?? DEFAULT_PERSONALITY.skepticism,
    formality: p.formality ?? DEFAULT_PERSONALITY.formality,
    notes: p.notes ?? DEFAULT_PERSONALITY.notes,
  };
}

// Turns a resolved flavour object into a prompt section describing how this
// student speaks in this particular session. Kept intentionally brief so it
// layers cleanly on top of the persona's behaviourPrompt and registerNote.
// The [emotion:X] tag invariant is never touched here — this section describes
// speaking style only.
export function renderPersonalitySection(flavour) {
  if (!flavour || typeof flavour !== "object") return "";

  const lines = ["YOUR SPEAKING STYLE THIS SESSION:"];

  // Mood
  const moodDesc = {
    upbeat: "You are in a good mood today — a little more open and positive than usual.",
    tired: "You are tired today — your replies are even shorter than usual, and you need a moment to process things.",
    distracted: "You are a bit distracted — you may lose track slightly, ask for a repeat once, and keep replies very short.",
    chatty: "You are unusually talkative today — you may add an extra sentence or detail when you normally would not.",
    guarded: "You are feeling cautious today — you hold back more than usual and let the counsellor do the talking.",
  };
  if (flavour.mood && moodDesc[flavour.mood]) {
    lines.push(moodDesc[flavour.mood]);
  }

  // Talkativeness
  const talk = flavour.talkativeness;
  if (typeof talk === "number") {
    if (talk <= 1) lines.push("You are very terse. Single-sentence replies unless genuinely pressed.");
    else if (talk === 2) lines.push("You keep replies short — 1 to 2 sentences as a rule.");
    else if (talk === 3) lines.push("You are moderately talkative — 2 sentences is your natural length.");
    else if (talk === 4) lines.push("You tend to add a bit more context than needed — 2-3 sentences, sometimes a small aside.");
    else lines.push("You are quite chatty — you add colour and context freely, up to 3-4 sentences.");
  }

  // Humour
  const humour = flavour.humour;
  if (typeof humour === "number") {
    if (humour >= 4) lines.push("You crack a light joke or self-deprecating remark now and then — keep it brief and natural.");
    else if (humour <= 1) lines.push("You are completely serious throughout. No jokes.");
  }

  // Skepticism note
  const skep = flavour.skepticism;
  if (typeof skep === "number" && skep >= 4) {
    lines.push("You are noticeably skeptical — even reassuring answers only partly settle your doubts.");
  }

  // Formality
  const form = flavour.formality;
  if (typeof form === "number") {
    if (form <= 1) lines.push("Your language is very informal — heavy Hinglish, contractions, casual filler words.");
    else if (form >= 5) lines.push("You speak in relatively polished English — minimal Hindi mixing.");
  }

  // Active quirks
  if (Array.isArray(flavour.activeQuirks) && flavour.activeQuirks.length > 0) {
    lines.push(`ACTIVE QUIRKS THIS SESSION (work these in naturally, do NOT force them on every message):`);
    for (const q of flavour.activeQuirks) {
      lines.push(`- ${q}`);
    }
  }

  // Free-text notes
  if (flavour.notes && typeof flavour.notes === "string" && flavour.notes.trim()) {
    lines.push(flavour.notes.trim());
  }

  return lines.join("\n");
}
