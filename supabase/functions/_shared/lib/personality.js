// _shared/lib/personality.js — ported from server/personality.js.
// CHANGES: no fs/path/process.env deps — byte-identical logic.

export const DEFAULT_PERSONALITY = {
  talkativeness: 2,
  humour: 2,
  skepticism: 3,
  formality: 3,
  quirks: [],
  notes: "",
};

const MOODS = ["upbeat", "tired", "distracted", "chatty", "guarded"];

export function rollSessionFlavour(personality) {
  const p = personality && typeof personality === "object" ? personality : DEFAULT_PERSONALITY;

  const talkativeness = Math.min(5, Math.max(1,
    (p.talkativeness ?? DEFAULT_PERSONALITY.talkativeness) + (Math.random() < 0.5 ? 1 : -1)
  ));

  const mood = MOODS[Math.floor(Math.random() * MOODS.length)];

  const quirks = Array.isArray(p.quirks) ? p.quirks : [];
  let activeQuirks = [];
  if (quirks.length > 0) {
    const shuffled = [...quirks].sort(() => Math.random() - 0.5);
    const count = quirks.length === 1 ? 1 : 1 + Math.floor(Math.random() * 2);
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

export function renderPersonalitySection(flavour) {
  if (!flavour || typeof flavour !== "object") return "";

  const lines = ["YOUR SPEAKING STYLE THIS SESSION:"];

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

  const talk = flavour.talkativeness;
  if (typeof talk === "number") {
    if (talk <= 1) {
      lines.push("You are very terse. Single-sentence replies unless genuinely pressed.");
      lines.push("You almost never volunteer personal details — you answer only what you are directly asked. Even when a topic connects to your real life, you stay brief and do not add colour.");
    } else if (talk === 2) {
      lines.push("You keep replies short — 1 to 2 sentences as a rule.");
      lines.push("You rarely add personal context unless the counsellor's point hits very close to home. Even then, keep it to a few words.");
    } else if (talk === 3) {
      lines.push("You are moderately talkative — 2 sentences is your natural length.");
      lines.push("When the counsellor mentions something real to you (fees, job, family, timing), you may add one brief personal detail, but only if it genuinely fits. Do not force it.");
    } else if (talk === 4) {
      lines.push("You tend to add a bit more context than needed — 2-3 sentences, sometimes a small aside.");
      lines.push("You lean toward sharing: when a topic connects to your real situation, you naturally add one specific personal detail and occasionally volunteer a related thought before moving on. Keep each aside brief — one sentence.");
    } else {
      lines.push("You are quite chatty — you add colour and context freely, up to 3-4 sentences.");
      lines.push("You frequently react with feeling and personal detail when something resonates. You may occasionally bring up a related thought or a light aside even when not asked. Still stay roughly on-topic — this is a counselling call.");
    }
  }

  const humour = flavour.humour;
  if (typeof humour === "number") {
    if (humour >= 4) lines.push("You crack a light joke or self-deprecating remark now and then — keep it brief and natural.");
    else if (humour === 3 && typeof talk === "number" && talk >= 4) lines.push("You occasionally react with a short light comment if something amuses you, but keep it very brief.");
    else if (humour <= 1) lines.push("You are completely serious throughout. No jokes.");
  }

  const skep = flavour.skepticism;
  if (typeof skep === "number" && skep >= 4) {
    lines.push("You are noticeably skeptical — even reassuring answers only partly settle your doubts.");
  }

  const form = flavour.formality;
  if (typeof form === "number") {
    if (form >= 4) {
      lines.push("Your English is on the more polished and correct side for your background.");
    } else if (form <= 2) {
      lines.push("Your English is casual and a little imperfect — small grammar slips are natural for you.");
    }
  }

  if (Array.isArray(flavour.activeQuirks) && flavour.activeQuirks.length > 0) {
    lines.push(`ACTIVE QUIRKS THIS SESSION (work these in naturally, do NOT force them on every message):`);
    for (const q of flavour.activeQuirks) {
      lines.push(`- ${q}`);
    }
  }

  if (flavour.notes && typeof flavour.notes === "string" && flavour.notes.trim()) {
    lines.push(flavour.notes.trim());
  }

  return lines.join("\n");
}
