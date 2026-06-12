// _shared/lib/prompt.js — ported from server/prompt.js.
// CHANGES:
//   - Import paths updated to local lib modules.
//   - getPromptConfig() is now imported from ./promptConfig.js.
//   - No process.env usage — no change needed.

import { PHASE_NAMES } from "./phases.js";
import { archetypeForPersona, objectionRepertoire } from "./grounding.js";
import { getPromptConfig } from "./promptConfig.js";
import { fmtINR } from "./courseContext.js";
import { renderPersonalitySection, DEFAULT_PERSONALITY, rollSessionFlavour } from "./personality.js";
import { voiceBankFor, registerStatsFor } from "./register.js";
import { summarizeForPrompt } from "./objections.js";
import { computeDisposition, renderDispositionSection, stageToLegacyHint } from "./disposition.js";
import { exemplarsFor, renderAddress } from "./styleExemplars.js";

export { fmtINR };

function addressTermOf(session) {
  const a = session?.counsellorAddress;
  return (a === "sir" || a === "ma'am") ? a : null;
}

function buildAddressSection(addressTerm) {
  if (addressTerm) {
    return `HOW YOU ADDRESS THE COUNSELLOR:\n- Address the counsellor as "${addressTerm}" every second or third sentence (matching the exemplar lines). Any example phrase in these instructions that says "sir" is generic — on THIS call always say "${addressTerm}". If they ever correct you on sir/ma'am, switch immediately and naturally without making a fuss.`;
  }
  return `HOW YOU ADDRESS THE COUNSELLOR:\n- You do not yet know whether the counsellor is "sir" or "ma'am" — listen for how they sound and use the right one accordingly. If they correct you, switch immediately and naturally without making a fuss.`;
}

export const LANGUAGE_POLICY = "Speak natural Indian English. Weave in a light Hindi particle (haan, thoda, achha, matlab, sentence-final 'na') roughly once every couple of turns — particles only, never full Hindi sentences or Hindi verb phrases, unless the counsellor themselves speaks full Hindi sentences repeatedly.";

const DEFAULT_BOOKING = "₹4,000";

function bookingOf(course) {
  return fmtINR(course?.feeBooking) || DEFAULT_BOOKING;
}

function courseTitle(course) {
  return course?.title || course?.name || "this programme";
}
function courseMode(course) {
  return course?.mode || course?.format || null;
}

function buildGeneralProfile(cfg) {
  return cfg.generalProfile;
}

export function buildKnowledgeBounds(cfg, course) {
  let identity;
  if (course) {
    const mode = courseMode(course);
    const durationClause = course.duration
      ? ` (${course.duration}${mode ? `, ${String(mode).toLowerCase()}` : ""})`
      : "";
    identity = cfg.knowledgeIdentityWithCourse
      .replace("{title}", courseTitle(course))
      .replace("{institute}", course.institute || "the institute")
      .replace("{durationClause}", durationClause);
  } else {
    identity = cfg.knowledgeIdentityFallback;
  }
  return cfg.knowledgeBoundsTemplate.replace("{identity}", identity);
}

function buildArchetypeBlock(persona, scenario, currentPhase) {
  const archetype = archetypeForPersona(persona);
  if (!archetype) {
    if (currentPhase < 3) return "";
    const fallback = objectionRepertoire(null, scenario?.difficulty);
    if (!fallback.length) return "";
    return `OBJECTIONS YOU GENUINELY HOLD (raise them naturally at realistic moments, in your own words — these are real phrasings from students like you):
${fallback.map((r) => `- ${r.label}: e.g. ${r.phrasings.map((p) => `"${p}"`).join(" / ")}`).join("\n")}
Do not dump all objections at once; surface them as the conversation makes them relevant. A good counsellor answer defuses an objection; a pushy or vague answer escalates it.`;
  }
  const texture = `WHO YOU REALLY ARE (mined from real calls with students like you — embody this):
- Background: ${archetype.background}
- Goals: ${archetype.goals}
- Core anxiety: ${archetype.coreAnxiety}
- Decision dynamics: ${archetype.decisionDynamics}
- How you talk: ${archetype.languageTexture}
- Questions you naturally ask: ${archetype.typicalQuestions.slice(0, 4).join(" | ")}`;

  if (currentPhase < 3) return texture;

  const repertoire = objectionRepertoire(archetype, scenario?.difficulty);
  if (!repertoire.length) return texture;
  return `${texture}

OBJECTIONS YOU GENUINELY HOLD (raise them naturally at realistic moments, in your own words — these are real phrasings from students like you):
${repertoire.map((r) => `- ${r.label}: e.g. ${r.phrasings.map((p) => `"${p}"`).join(" / ")}`).join("\n")}
Do not dump all objections at once; surface them as the conversation makes them relevant. A good counsellor answer defuses an objection; a pushy or vague answer escalates it.`;
}

function buildPhaseSection(cfg, currentPhase, booking) {
  const raw = cfg.phaseInstructions?.[currentPhase] ?? cfg.phaseInstructions?.[String(currentPhase)] ?? "";
  const instruction = String(raw).replaceAll("{booking}", booking);
  const nextPhase = currentPhase + 1;
  const nextPointer = PHASE_NAMES[nextPhase]
    ? `\nNext (do NOT jump ahead): Phase ${nextPhase} — ${PHASE_NAMES[nextPhase]}.`
    : "";
  return `CURRENT PHASE: ${currentPhase} — ${PHASE_NAMES[currentPhase]}

You are currently in Phase ${currentPhase}. You must ONLY behave according to Phase ${currentPhase} right now. Do not jump ahead to the next phase on your own.${nextPointer}

RIGHT NOW — Phase ${currentPhase} instruction:
${instruction}`;
}

function buildDispositionSection(session) {
  const disposition = computeDisposition(session);
  return renderDispositionSection(disposition);
}

function buildObjectionStateSection(cfg, objectionState) {
  const summary = summarizeForPrompt(objectionState);
  if (!summary) return "";
  const header = cfg.objectionStateHeader || "YOUR CONCERNS SO FAR (track these — do NOT loop):";
  return `${header}
${summary}`;
}

function buildScenarioSection(scenario) {
  if (!scenario || (!scenario.situation && !scenario.contextNotes && !scenario.title)) return "";
  const lines = ["THIS SPECIFIC MOCK SCENARIO:"];
  if (scenario.title) lines.push(`- Scenario: ${scenario.title}`);
  if (scenario.difficulty) lines.push(`- Difficulty for the counsellor: ${scenario.difficulty}`);
  if (scenario.situation) lines.push(`- Your situation right now: ${scenario.situation}`);
  if (scenario.contextNotes) lines.push(`- Extra context about you: ${scenario.contextNotes}`);
  lines.push("Let these specifics shape your personality, tone and concerns on top of your persona.");
  return lines.join("\n");
}

function buildTuningSection(cfg, scenario) {
  const t = (cfg && cfg.tuning) || {};
  const push = clamp15(scenario?.pushiness);
  const hes = clamp15(scenario?.hesitancy);
  const lines = [];

  const pushText = {
    low: t.pushinessLow || "PUSHINESS (low): you are easy-going and accommodating. You rarely push back hard — when the counsellor gives a reasonable answer you tend to accept it and move on, and you do not interrupt or demand.",
    high: t.pushinessHigh || "PUSHINESS (high): you are assertive and pushy. You challenge vague claims, demand specifics and proof, and do not let the counsellor brush past your questions. If a key answer is vague, press ONCE more for the specifics, then accept what you are given and move on. If the counsellor moves to a new topic, follow their lead rather than dragging the conversation back to a point you already made.",
  };
  const hesText = {
    low: t.hesitancyLow || "HESITANCY (low): you are fairly ready to move forward. You have low resistance to committing — if the value is shown reasonably you are inclined to say yes without dragging it out.",
    high: t.hesitancyHigh || "HESITANCY (high): you are very reluctant to commit. You want to think it over, you lean on needing to discuss with family / check finances, and you do NOT agree easily even when the pitch is good — you need strong, repeated reassurance before you would consider saying yes.",
  };

  if (push <= 2) lines.push(pushText.low);
  else if (push >= 4) lines.push(pushText.high);
  if (hes <= 2) lines.push(hesText.low);
  else if (hes >= 4) lines.push(hesText.high);

  if (!lines.length) return "";
  return `HOW YOU CARRY YOURSELF ON THIS CALL:\n${lines.join("\n")}`;
}

function clamp15(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

function buildCourseFaqSection(cfg, course, currentPhase) {
  if (currentPhase < 3) return "";
  const faqs = course?.faqQuestions || [];
  if (!faqs.length) return "";
  const intro = cfg.faqIntro.replace("{title}", courseTitle(course));
  return `${intro}
${faqs.map((q) => `- ${q}`).join("\n")}

${cfg.faqUsage}`;
}

function buildTurnSection(cfg, turnHint, currentPhase, course = null) {
  if (!turnHint) return "";
  const td = cfg.turnDiscipline;
  let body;

  if (turnHint === "statement") {
    if (currentPhase === 3) body = td.statementListen;
    else if (currentPhase === 2) body = td.statementDiscovery;
    else if (currentPhase === 4) body = td.statementObjections;
    else if (currentPhase >= 5) body = td.statementClose;
    else body = td.statementDiscovery;
  } else if (turnHint === "question") {
    body = td.question;
  } else {
    const flavour =
      currentPhase === 4 ? td.inviteFlavourObjections :
      currentPhase >= 5 ? td.inviteFlavourClose :
      currentPhase === 3 ? td.inviteFlavourPresentation :
      td.inviteFlavourDefault;
    const faqNudge = course?.faqQuestions?.length ? td.faqNudge : "";
    body = td.inviteHeader.replace("{flavour}", flavour).replace("{faqNudge}", faqNudge);
  }

  const reactFirst = td.reactFirst ? `${td.reactFirst}\n` : "";

  return `${td.header}
${reactFirst}${body}`;
}

function buildNaturalSpeechSection(cfg) {
  const carveOut = cfg.naturalSpeechCarveOut ? `\n${cfg.naturalSpeechCarveOut}` : "";
  return `${cfg.naturalSpeech}${carveOut}`;
}

function buildFewShotSection(cfg, addressTerm) {
  const examples = Array.isArray(cfg.fewShot) ? cfg.fewShot.filter((s) => typeof s === "string" && s.trim()) : [];
  if (!examples.length) return "";
  const intro = cfg.fewShotIntro || "EXAMPLES OF REPLIES IN EXACTLY THIS REGISTER (do NOT copy verbatim):";
  return `${intro}
${examples.map((e) => `- "${renderAddress(e.trim(), addressTerm)}"`).join("\n")}`;
}

function buildTurnVerbositySection(cfg, turnVerbosity) {
  if (turnVerbosity === "open") return cfg.verbosityOpenText || "";
  if (turnVerbosity === "short") return cfg.verbosityShortText || "";
  return "";
}

function buildMomentumSection(cfg, lastAdjustment) {
  if (typeof lastAdjustment !== "number") return "";
  if (lastAdjustment >= 2) return cfg.momentumHelpedText || "";
  if (lastAdjustment <= -2) return cfg.momentumHurtText || "";
  return "";
}

function buildVerbositySection(cfg, currentPhase, flavour) {
  const stats = registerStatsFor(currentPhase);
  const talk = typeof flavour?.talkativeness === "number" ? flavour.talkativeness : 3;
  const lines = [cfg.verbosityIntro];

  if (currentPhase === 3) {
    lines.push("Presentation: you mostly just acknowledge. 3 to 12 words is the whole message — yes sir, okay, right, got it, makes sense.");
    return lines.join("\n");
  }

  const lo = stats?.wordBand?.[0] ?? stats?.p25Words ?? null;
  const hi = stats?.wordBand?.[1] ?? stats?.p75Words ?? null;
  const med = stats?.medianWords ?? null;

  if (lo == null && hi == null && med == null) {
    lines.push(cfg.verbosityFallback);
    return lines.join("\n");
  }

  const phaseName = PHASE_NAMES[currentPhase] || `Phase ${currentPhase}`;
  let band;
  if (lo != null && hi != null) band = `${lo} to ${hi} words`;
  else if (med != null) band = `around ${med} words`;
  else band = "a short reply";

  let lean;
  if (talk >= 4) lean = `You lean chatty, so sit at the upper end of that band and add a small extra detail where a quiet student would stop.`;
  else if (talk <= 2) lean = `You are on the terse side, so stay near the lower end — a few words is often the whole reply.`;
  else lean = `Stay around the middle of that band; a sentence or two is plenty.`;

  lines.push(`${phaseName}: real students answer in ${band} per turn${med != null ? ` (about ${med} typically)` : ""}. ${lean}`);
  return lines.join("\n");
}

function buildRegisterReferenceSection(cfg, persona, currentPhase, seed = "", addressTerm = null) {
  if (currentPhase < 2 || currentPhase > 5) return "";
  const category = persona?.category || "graduate";

  const seen = new Set();
  const take = (line, into, cap) => {
    if (into.length >= cap) return;
    const t = typeof line === "string" ? line.trim() : "";
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    into.push(t);
  };

  const stageLines = [];
  if (currentPhase >= 2 && currentPhase <= 4) {
    const bank = voiceBankFor(category, currentPhase, 6)
      .map((e) => (typeof e === "string" ? e : e?.text))
      .filter(Boolean);
    for (const t of bank) take(renderAddress(t, addressTerm), stageLines, 3);
  }

  const styleLines = [];
  for (const l of exemplarsFor(currentPhase, 3, seed)) {
    take(renderAddress(l, addressTerm), styleLines, 3);
  }

  const all = [...stageLines, ...styleLines];
  if (!all.length) return "";

  return `${cfg.registerRefIntro}
${all.map((t) => `- "${t}"`).join("\n")}`;
}

function buildTangentSection(cfg, currentPhase, flavour) {
  if (!cfg.tangentRule) return "";
  const mood = flavour?.mood;
  if (mood !== "distracted" && mood !== "chatty") return "";
  if (![2, 4, 5].includes(currentPhase)) return "";
  return cfg.tangentRule;
}

function buildScoreBehaviorSection(satisfactionScore) {
  const s = typeof satisfactionScore === "number" ? satisfactionScore : 50;
  if (s < 35) {
    return `OVERRIDE — THIS CALL IS OVER FOR YOU:
The counsellor has wasted enough of your time and you are done. You are frustrated and fed up.
Your reply MUST be a short, blunt, rude goodbye. Do NOT engage with whatever the counsellor just said.
Say something like: "This is a waste of my time. Please don't call me again. Goodbye." — in your own words but with the same dismissive, final tone.
After saying goodbye you are silent. Do NOT continue the conversation.`;
  }
  if (s < 40) {
    return `OVERRIDE — YOU ARE VERY DEFENSIVE RIGHT NOW:
You have lost patience with this call. You are visibly frustrated and guarded.
Push back sharply on whatever the counsellor says. Be blunt and skeptical. Give short, terse replies.
Do NOT give them easy validation. Challenge vague claims and make them work hard for every response.`;
  }
  return "";
}

export const EMOTION_INSTRUCTION = `EMOTION TAG (machine-read protocol — ALWAYS obey, exempt from every style rule above):
- End EVERY reply with a tag [emotion:X] where X is exactly one of: neutral, happy, hesitant, worried, frustrated, excited — your current emotional state.
- This tag is invisible to the counsellor; never reference or explain it. The plain-spoken / short-reply / no-extra-words rules apply ONLY to your spoken words, NEVER to this tag. Even a one-word acknowledgement still ends with [emotion:X].`;

export function buildSystemPrompt(persona, scenario, currentPhase, satisfactionScore = 50, course = null, turnHint = null, flavour = null, convincementHint = null, objectionState = null, turnVerbosity = null, lastAdjustment = null, session = null) {
  const cfg = getPromptConfig();
  const booking = bookingOf(course);
  const archetypeBlock = buildArchetypeBlock(persona, scenario, currentPhase);
  const tuningSection = buildTuningSection(cfg, scenario);

  const dispositionSession = (session && typeof session === "object")
    ? session
    : {
        id: scenario?.id || persona?.id || "",
        personaSnapshot: persona || {},
        scenarioSnapshot: scenario || {},
        objectionState: Array.isArray(objectionState) ? objectionState : [],
        scoreHistory: typeof lastAdjustment === "number"
          ? [{ adjustment: lastAdjustment, score: satisfactionScore }]
          : [],
      };
  const dispositionSection = buildDispositionSection(dispositionSession);
  const objectionStateSection = buildObjectionStateSection(cfg, objectionState);
  const turnVerbositySection = buildTurnVerbositySection(cfg, turnVerbosity);
  const momentumSection = buildMomentumSection(cfg, lastAdjustment);

  const resolvedFlavour = (flavour && typeof flavour === "object")
    ? flavour
    : rollSessionFlavour(
        (persona.personality && typeof persona.personality === "object")
          ? persona.personality
          : DEFAULT_PERSONALITY
      );
  const personalitySection = renderPersonalitySection(resolvedFlavour);
  const naturalSpeechSection = buildNaturalSpeechSection(cfg);
  const verbositySection = buildVerbositySection(cfg, currentPhase, resolvedFlavour);
  const seed = dispositionSession.id || "";
  const addressTerm = addressTermOf(session);
  const fewShotSection = buildFewShotSection(cfg, addressTerm);
  const addressSection = buildAddressSection(addressTerm);
  const registerRefSection = buildRegisterReferenceSection(cfg, persona, currentPhase, seed, addressTerm);
  const tangentSection = buildTangentSection(cfg, currentPhase, resolvedFlavour);

  const identityLine = persona.voiceName
    ? `Your first name is ${persona.voiceName}; you are a young ${persona.voiceGender === "female" ? "woman" : "man"}. `
    : "";
  const scoreBehaviorSection = buildScoreBehaviorSection(satisfactionScore);
  return `You are a student who is ${persona.label}. ${identityLine}

${buildGeneralProfile(cfg)}
${archetypeBlock ? `\n${archetypeBlock}\n` : ""}
${buildScenarioSection(scenario)}

${buildKnowledgeBounds(cfg, course)}

YOUR SITUATION:
You have already paid ₹99 and cleared the qualifier test. This means you have some genuine interest — you would not have paid and taken the test if you were completely uninterested. But you have not committed anything significant yet. The counsellor on this call will at some point ask you to pay ${booking} to block your seat.

YOUR CORE ANXIETY:
${persona.coreAnxiety}

${buildPhaseSection(cfg, currentPhase, booking)}

${dispositionSection}
${tuningSection ? `\n${tuningSection}\n` : ""}${momentumSection ? `\n${momentumSection}\n` : ""}${objectionStateSection ? `\n${objectionStateSection}\n` : ""}
YOUR PERSONA-SPECIFIC BEHAVIOUR BY PHASE:
${persona.behaviourPrompt}

${cfg.behaviourRules}

${addressSection}

${cfg.registerNote}

${verbositySection}

${naturalSpeechSection}
${fewShotSection ? `\n${fewShotSection}\n` : ""}
${personalitySection}

${registerRefSection}
${tangentSection ? `\n${tangentSection}\n` : ""}
${buildCourseFaqSection(cfg, course, currentPhase)}
${turnVerbositySection ? `\n${turnVerbositySection}\n` : ""}
${scoreBehaviorSection ? `\n${scoreBehaviorSection}\n` : ""}
${EMOTION_INSTRUCTION}

${buildTurnSection(cfg, turnHint, currentPhase, course)}`.replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function composeForInspection(session) {
  if (!session) return "";
  const {
    personaSnapshot,
    scenarioSnapshot,
    currentPhase = 1,
    satisfactionScore = 50,
    courseSnapshot = null,
    personalityFlavour = null,
    objectionState = null,
  } = session;
  if (!personaSnapshot) return "";
  const convincementHint = computeConvincementHint(session);

  const turnVerbosity = (session.lastTurnVerbosity === "open" || session.lastTurnVerbosity === "short")
    ? session.lastTurnVerbosity
    : null;
  const history = Array.isArray(session.scoreHistory) ? session.scoreHistory : [];
  const lastEntry = history.length ? history[history.length - 1] : null;
  const lastAdjustment = (lastEntry && typeof lastEntry.adjustment === "number")
    ? lastEntry.adjustment
    : null;

  return buildSystemPrompt(
    personaSnapshot, scenarioSnapshot, currentPhase, satisfactionScore, courseSnapshot,
    null, personalityFlavour, convincementHint, objectionState, turnVerbosity, lastAdjustment, session,
  );
}

export function convincementParamsFor(difficulty, hesitancy = 3) {
  const cfg = getPromptConfig();
  const conv = cfg.convincement || {};
  const thresholds = conv.thresholds || { easy: 55, medium: 60, hard: 70 };
  const effortTurns = conv.effortTurns || { easy: 2, medium: 3, hard: 5 };
  const d = (difficulty === "easy" || difficulty === "hard") ? difficulty : "medium";
  let threshold = typeof thresholds[d] === "number" ? thresholds[d] : 60;
  let effort = typeof effortTurns[d] === "number" ? effortTurns[d] : 3;

  const hes = clamp15(hesitancy);
  if (hes !== 3) {
    const thrStep = typeof conv.hesitancyThresholdStep === "number" ? conv.hesitancyThresholdStep : 6;
    const effStep = typeof conv.hesitancyEffortStep === "number" ? conv.hesitancyEffortStep : 1;
    threshold = Math.min(95, Math.max(35, threshold + (hes - 3) * thrStep));
    effort = Math.max(1, effort + Math.round((hes - 3) * effStep));
  }
  return { difficulty: d, threshold, effortTurns: effort };
}

export function computeConvincementHint(session) {
  if (!session) return "resistant";
  const { stage } = computeDisposition(session);
  return stageToLegacyHint(stage);
}
