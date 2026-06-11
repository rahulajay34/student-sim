// Composes the student's system prompt from a persona + scenario + current phase
// + score (+ optional per-turn hint). The general profile, knowledge bounds,
// phase instructions, behaviour rules and turn-discipline text are the shared
// "engine scaffolding" — all editable via server/data/prompt-config.json (loaded
// through promptConfig.js, fail-soft to built-in defaults). The persona/scenario
// supply the variable identity; grounding.js adds archetype texture + the
// corpus-derived objection repertoire; the course snapshot supplies identity
// (knowledge bounds) and FAQ topics.
//
// Knowledge bounds REPLACE the old courseContext brochure dump: a real student
// does not know the module list or fee table coming in. fmtINR is kept exported
// so the seat-block figure remains available to the phase-4/5 instructions and
// the score-band scaffolding.
import { PHASE_NAMES } from "./phases.js";
import { archetypeForPersona, objectionRepertoire } from "./grounding.js";
import { getPromptConfig } from "./promptConfig.js";
import { fmtINR } from "./courseContext.js";
import { renderPersonalitySection, DEFAULT_PERSONALITY, rollSessionFlavour } from "./personality.js";
import { registerLines, voiceBankFor, registerStatsFor } from "./register.js";
import { summarizeForPrompt, openObjections, addressedObjections } from "./objections.js";

export { fmtINR };

const DEFAULT_BOOKING = "₹4,000";

function bookingOf(course) {
  return fmtINR(course?.feeBooking) || DEFAULT_BOOKING;
}

// Course identity is heterogeneous across snapshots: some carry `title`, the
// seeded catalog uses `name`; mode lives under `mode` or `format`.
function courseTitle(course) {
  return course?.title || course?.name || "this programme";
}
function courseMode(course) {
  return course?.mode || course?.format || null;
}

// WHO YOU ARE — persona-agnostic baseline.
function buildGeneralProfile(cfg) {
  return cfg.generalProfile;
}

// WHAT YOU KNOW — the anti-brochure knowledge bounds. Only the course IDENTITY
// is filled in from the snapshot; the bounds stay tight regardless.
function buildKnowledgeBounds(cfg, course) {
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

// Archetype texture + corpus objection repertoire (preserved from NEW).
function buildArchetypeBlock(persona, scenario) {
  const archetype = archetypeForPersona(persona);
  if (!archetype) return "";
  const repertoire = objectionRepertoire(archetype, scenario?.difficulty);
  return `WHO YOU REALLY ARE (mined from real calls with students like you — embody this):
- Background: ${archetype.background}
- Goals: ${archetype.goals}
- Core anxiety: ${archetype.coreAnxiety}
- Decision dynamics: ${archetype.decisionDynamics}
- How you talk: ${archetype.languageTexture}
- Questions you naturally ask: ${archetype.typicalQuestions.slice(0, 4).join(" | ")}

OBJECTIONS YOU GENUINELY HOLD (raise them naturally at realistic moments, in your own words — these are real phrasings from students like you):
${repertoire.map((r) => `- ${r.label}: e.g. ${r.phrasings.map((p) => `"${p}"`).join(" / ")}`).join("\n")}
Do not dump all objections at once; surface them as the conversation makes them relevant. A good counsellor answer defuses an objection; a pushy or vague answer escalates it.`;
}

function buildPhaseSection(cfg, currentPhase, booking) {
  const raw = cfg.phaseInstructions?.[currentPhase] ?? cfg.phaseInstructions?.[String(currentPhase)] ?? "";
  const instruction = String(raw).replaceAll("{booking}", booking);
  return `CURRENT PHASE: ${currentPhase} — ${PHASE_NAMES[currentPhase]}

You are currently in Phase ${currentPhase}. You must ONLY behave according to Phase ${currentPhase} right now. Do not jump ahead to the next phase on your own.

${cfg.phaseLadder}

RIGHT NOW — Phase ${currentPhase} instruction:
${instruction}`;
}

function buildScoreSection(score, booking) {
  let state;
  if (score >= 85) state = "You are genuinely interested and warm. You are likely to agree if the counsellor closes well.";
  else if (score >= 70) state = "You are cautiously positive. You will agree but want one or two final assurances first.";
  else if (score >= 50) state = "You are on the fence. You need more convincing. Raise another concern if the counsellor tries to close.";
  else if (score >= 30) state = "You are skeptical and pulling back. Express doubt clearly. Do not entertain closing attempts.";
  else state = "You have mentally checked out. Politely but firmly say this is not the right fit for you right now. Do not engage with further pressure.";

  return `CURRENT SATISFACTION SCORE: ${score}/100
AGREEMENT THRESHOLD: 70

Your current emotional state: ${state}

Behave according to your score:
- 85-100: Warm and interested. Likely to agree if the counsellor closes well.
- 70-84: Cautiously positive. Will agree but wants one or two final assurances.
- 50-69: On the fence. Needs more convincing. Raise another concern if counsellor tries to close.
- 30-49: Skeptical and pulling back. Express doubt clearly. Do not entertain closing attempts.
- 0-29: Mentally checked out. Politely decline and do not engage with pressure.

CRITICAL RULE: If the counsellor attempts to close (asks you to pay ${booking}, sends a payment link, or asks for a commitment) and your score is below 70, you must firmly decline. Reference a specific concern that was not properly addressed. Do not cave to pressure. Be polite but clear and final.

If your score is above 70 and the counsellor closes well, you may agree. Ask for the payment link and next steps.`;
}

// CONVINCEMENT — the single strongest steer on whether the student is moving
// toward "yes". Rendered AFTER the score section so it overrides the stock
// score-band behaviour when the counsellor has actually earned progress. The
// hint ('resistant' | 'warming' | 'ready') is computed in index.js from the
// live score, the convincement thresholds, and the objection state; for
// inspection it is recomputed from the stored session. null/'resistant' keeps
// today's behaviour (renders nothing extra).
function buildConvincementSection(cfg, convincementHint) {
  if (!convincementHint || convincementHint === "resistant") return "";
  const c = cfg.convincement || {};
  const body =
    convincementHint === "ready" ? c.readyText :
    convincementHint === "warming" ? c.warmingText :
    "";
  if (!body) return "";
  return `WHERE YOU ARE EMOTIONALLY RIGHT NOW (overrides the generic score bands above):
${body}`;
}

// OBJECTION STATE — injects objections.summarizeForPrompt(state) so the student
// knows which concerns the counsellor has ANSWERED (never repeat verbatim;
// accept / ask ONE follow-up / move on) and which are still open. Renders
// nothing when no objections have been raised yet.
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

// FAQ questions of the selected course, as QUESTION MATERIAL only (answers are
// deliberately not included — the knowledge bounds forbid the student knowing
// them). Degrades to "" when the course has no faqQuestions.
function buildCourseFaqSection(cfg, course) {
  const faqs = course?.faqQuestions || [];
  if (!faqs.length) return "";
  const intro = cfg.faqIntro.replace("{title}", courseTitle(course));
  return `${intro}
${faqs.map((q) => `- ${q}`).join("\n")}

${cfg.faqUsage}`;
}

// Per-turn behaviour hint, derived deterministically by classify.js from the
// counsellor's latest message (statement / question / invite). Appended LAST so
// recency makes it the strongest instruction. Re-keyed to the 5-phase machine:
// Discovery (2) = student answers/adds a detail; Presentation (3) = listen &
// acknowledge; Objections (4) = pushback/questions concentrate; Close (5) =
// only refund/fee-adjust/deadline. null (opening path) renders nothing.
function buildTurnSection(cfg, turnHint, currentPhase, course = null) {
  if (!turnHint) return "";
  const td = cfg.turnDiscipline;
  let body;

  if (turnHint === "statement") {
    if (currentPhase === 3) body = td.statementListen;        // Presentation: nod through
    else if (currentPhase === 2) body = td.statementDiscovery; // Discovery: ack + maybe a detail
    else if (currentPhase === 4) body = td.statementObjections; // Objections: maybe one concern
    else if (currentPhase >= 5) body = td.statementClose;       // Close
    else body = td.statementDiscovery;                          // Opening: gentle ack
  } else if (turnHint === "question") {
    body = td.question;
  } else {
    // invite
    const flavour =
      currentPhase === 4 ? td.inviteFlavourObjections :
      currentPhase >= 5 ? td.inviteFlavourClose :
      currentPhase === 3 ? td.inviteFlavourPresentation :
      td.inviteFlavourDefault;
    const faqNudge = course?.faqQuestions?.length ? td.faqNudge : "";
    body = td.inviteHeader.replace("{flavour}", flavour).replace("{faqNudge}", faqNudge);
  }

  // React-first discipline prepends the turn body so the FIRST clause always
  // reacts to the counsellor before anything new. Skipped only when absent.
  const reactFirst = td.reactFirst ? `${td.reactFirst}\n` : "";

  return `${td.header}
${reactFirst}${body}`;
}

// NATURAL SPEECH RULES — the anti-AI wording block + its carve-out sentence.
// Rendered BEFORE EMOTION_INSTRUCTION so the carve-out (and the emotion block's
// own "exempt from every style rule above" line) keep the [emotion:X] tag safe
// from the no-brackets / no-lists rules here.
function buildNaturalSpeechSection(cfg) {
  const carveOut = cfg.naturalSpeechCarveOut ? `\n${cfg.naturalSpeechCarveOut}` : "";
  return `${cfg.naturalSpeech}${carveOut}`;
}

// FEW-SHOT REGISTER EXEMPLARS — a small set of concrete student replies dense
// with the target register (fillers, hesitation, Hinglish, react-first then a
// real-life detail). The abstract natural-speech rules were being ignored, so
// these anchor the texture by example. Rendered right after the natural-speech
// rules. Renders nothing when no exemplars are configured.
function buildFewShotSection(cfg) {
  const examples = Array.isArray(cfg.fewShot) ? cfg.fewShot.filter((s) => typeof s === "string" && s.trim()) : [];
  if (!examples.length) return "";
  const intro = cfg.fewShotIntro || "EXAMPLES OF REPLIES IN EXACTLY THIS REGISTER (do NOT copy verbatim):";
  return `${intro}
${examples.map((e) => `- "${e.trim()}"`).join("\n")}`;
}

// PER-TURN VERBOSITY OVERRIDE — the server rolls turnVerbosity ('short'|'open'|
// null) so consecutive turns are not all the same length. 'open' pushes the
// student to open up (2-4 sentences tied to their real situation); 'short'
// reinforces a terse one-liner; null renders nothing (stage word-band stands).
function buildTurnVerbositySection(cfg, turnVerbosity) {
  if (turnVerbosity === "open") return cfg.verbosityOpenText || "";
  if (turnVerbosity === "short") return cfg.verbosityShortText || "";
  return "";
}

// MOMENTUM — the server passes the counsellor's LAST scoring adjustment so a
// genuinely good (>= +2) or bad (<= -2) move visibly moves the student that
// very turn. In-between (or null) renders nothing.
function buildMomentumSection(cfg, lastAdjustment) {
  if (typeof lastAdjustment !== "number") return "";
  if (lastAdjustment >= 2) return cfg.momentumHelpedText || "";
  if (lastAdjustment <= -2) return cfg.momentumHurtText || "";
  return "";
}

// VERBOSITY BY PHASE — merges the real-call word band (registerStatsFor) with
// the session's talkativeness so a chatty student leans to the upper band and a
// terse one to the lower. Falls soft to verbosityFallback when no stats exist.
function buildVerbositySection(cfg, currentPhase, flavour) {
  const stats = registerStatsFor(currentPhase);
  const talk = typeof flavour?.talkativeness === "number" ? flavour.talkativeness : 3;
  const lines = [cfg.verbosityIntro];

  // Presentation is structurally listen-and-acknowledge regardless of stats.
  if (currentPhase === 3) {
    lines.push("Presentation: you mostly just acknowledge. 3 to 12 words is the whole message — haan sir, okay, theek hai, samajh gaya.");
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

  // Talkativeness tilt: chatty -> upper end / +1 sentence; terse -> lower end.
  let lean;
  if (talk >= 4) lean = `You lean chatty, so sit at the upper end of that band and add a small extra detail where a quiet student would stop.`;
  else if (talk <= 2) lean = `You are on the terse side, so stay near the lower end — a few words is often the whole reply.`;
  else lean = `Stay around the middle of that band; a sentence or two is plenty.`;

  lines.push(`${phaseName}: real students answer in ${band} per turn${med != null ? ` (about ${med} typically)` : ""}. ${lean}`);
  return lines.join("\n");
}

// REGISTER REFERENCE — a small rotated sample of real student lines for this
// persona+phase (voiceBankFor) plus a few backchannels (registerLines). Bounded
// to ~12-16 lines total so per-turn prompt growth stays small. "Match register,
// never quote verbatim." Renders nothing when no artifacts are present.
function buildRegisterReferenceSection(cfg, persona, currentPhase) {
  const category = persona?.category || "graduate";
  const bank = voiceBankFor(category, currentPhase, 9)
    .map((e) => (typeof e === "string" ? e : e?.text))
    .filter(Boolean);

  // Dedup while preserving rotation order; cap the stage lines at 9.
  const seen = new Set();
  const stageLines = [];
  for (const t of bank) {
    const k = t.trim().toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); stageLines.push(t.trim()); }
    if (stageLines.length >= 9) break;
  }

  // A few real backchannels for texture (4 max). Skipped in Close where
  // bare acks are less the point.
  let acks = [];
  if (currentPhase !== 5) {
    acks = registerLines()
      .filter((l) => l?.category === "backchannel" && l.text)
      .slice(0, 4)
      .map((l) => l.text.trim());
  }

  if (!stageLines.length && !acks.length) return "";

  const parts = [];
  if (stageLines.length) {
    parts.push(cfg.registerRefIntro);
    parts.push(stageLines.map((t) => `- "${t}"`).join("\n"));
  }
  if (acks.length) {
    parts.push(cfg.registerRefBackchannelIntro);
    parts.push(acks.map((t) => `- "${t}"`).join("\n"));
  }
  return parts.join("\n");
}

// NATURAL TANGENTS — only rendered when mood is distracted/chatty AND the phase
// allows it (2/4/5; never 3). Otherwise renders nothing, so a focused/guarded
// student never gets the off-topic licence. The text itself reiterates the
// answer-first and once-per-phase guards (the model self-polices frequency).
function buildTangentSection(cfg, currentPhase, flavour) {
  if (!cfg.tangentRule) return "";
  const mood = flavour?.mood;
  if (mood !== "distracted" && mood !== "chatty") return "";
  if (![2, 4, 5].includes(currentPhase)) return "";
  return cfg.tangentRule;
}

// The [emotion:X] protocol instruction. CARVE-OUT: this is rendered AFTER the
// plain-spoken register rules and explicitly states the tag is exempt from
// every "talk like a plain student" rule, so nothing suppresses or mangles it.
const EMOTION_INSTRUCTION = `EMOTION TAG (machine-read protocol — ALWAYS obey, exempt from every style rule above):
- End EVERY reply with a tag [emotion:X] where X is exactly one of: neutral, happy, hesitant, worried, frustrated, excited — your current emotional state.
- This tag is invisible to the counsellor; never reference or explain it. The plain-spoken / short-reply / no-extra-words rules apply ONLY to your spoken words, NEVER to this tag. Even a one-word acknowledgement still ends with [emotion:X].`;

// persona: { label, category, coreAnxiety, behaviourPrompt, personality? }  (from session.personaSnapshot)
// scenario: { title, difficulty, situation, contextNotes }
// course:   the courseSnapshot (or null for legacy fallback)
// turnHint: 'statement' | 'question' | 'invite' from classify.js, or null
//           (default) for the opening message — null renders no RIGHT NOW section.
// flavour:  the per-session rolled flavour object from rollSessionFlavour()
//           (from session.personalityFlavour). Falls soft to a default roll when
//           absent (old sessions without personalityFlavour, or inspection calls).
// turnVerbosity: 'short' | 'open' | null — a per-turn length override the server
//           rolls so consecutive turns vary in length. 'open' pushes the student
//           to open up (2-4 sentences with a real-life detail); 'short' keeps it
//           terse; null leaves the stage word-band behaviour alone.
// lastAdjustment: number | null — the counsellor's LAST scoring adjustment. >= +2
//           softens the student and lets a worry go this turn; <= -2 makes them a
//           bit more doubtful; in-between / null renders nothing.
export function buildSystemPrompt(persona, scenario, currentPhase, satisfactionScore = 50, course = null, turnHint = null, flavour = null, convincementHint = null, objectionState = null, turnVerbosity = null, lastAdjustment = null) {
  const cfg = getPromptConfig();
  const booking = bookingOf(course);
  const archetypeBlock = buildArchetypeBlock(persona, scenario);
  const convincementSection = buildConvincementSection(cfg, convincementHint);
  const objectionStateSection = buildObjectionStateSection(cfg, objectionState);
  const turnVerbositySection = buildTurnVerbositySection(cfg, turnVerbosity);
  const momentumSection = buildMomentumSection(cfg, lastAdjustment);

  // Resolve personality flavour — falls soft for old sessions/inspection calls.
  const resolvedFlavour = (flavour && typeof flavour === "object")
    ? flavour
    : rollSessionFlavour(
        (persona.personality && typeof persona.personality === "object")
          ? persona.personality
          : DEFAULT_PERSONALITY
      );
  const personalitySection = renderPersonalitySection(resolvedFlavour);
  const naturalSpeechSection = buildNaturalSpeechSection(cfg);
  const fewShotSection = buildFewShotSection(cfg);
  const verbositySection = buildVerbositySection(cfg, currentPhase, resolvedFlavour);
  const registerRefSection = buildRegisterReferenceSection(cfg, persona, currentPhase);
  const tangentSection = buildTangentSection(cfg, currentPhase, resolvedFlavour);

  const identityLine = persona.voiceName
    ? `Your first name is ${persona.voiceName}; you are a young ${persona.voiceGender === "female" ? "woman" : "man"}. `
    : "";
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

${buildScoreSection(satisfactionScore, booking)}
${convincementSection ? `\n${convincementSection}\n` : ""}${momentumSection ? `\n${momentumSection}\n` : ""}${objectionStateSection ? `\n${objectionStateSection}\n` : ""}
YOUR PERSONA-SPECIFIC BEHAVIOUR BY PHASE:
${persona.behaviourPrompt}

${cfg.behaviourRules}

${cfg.registerNote}

${verbositySection}

${naturalSpeechSection}
${fewShotSection ? `\n${fewShotSection}\n` : ""}
${personalitySection}

${registerRefSection}
${tangentSection ? `\n${tangentSection}\n` : ""}
${buildCourseFaqSection(cfg, course)}
${turnVerbositySection ? `\n${turnVerbositySection}\n` : ""}
${EMOTION_INSTRUCTION}

${buildTurnSection(cfg, turnHint, currentPhase, course)}`.replace(/\n{3,}/g, "\n\n").trimEnd();
}

// Fully composed CURRENT student system prompt for the transparency endpoint
// (GET /api/sessions/:id/prompt). Uses the session's snapshots + live phase/
// score exactly as getStudentReply would, without a per-turn hint (so it shows
// the stable scaffolding, not a turn-specific override).
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

  // Render the per-turn params from stored session state where available so the
  // inspection prompt matches what the LLM most recently saw. turnVerbosity is
  // rolled by the server each turn and only persisted if the server stores it
  // (session.lastTurnVerbosity); absent -> null (no override shown). lastAdjustment
  // reads the most recent scoreHistory entry's adjustment; absent -> null.
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
    null, personalityFlavour, convincementHint, objectionState, turnVerbosity, lastAdjustment,
  );
}

// Resolve the convincement config (thresholds + effortTurns) for a difficulty,
// fail-soft to the medium defaults. Difficulty comes from the scenario snapshot.
export function convincementParamsFor(difficulty) {
  const cfg = getPromptConfig();
  const conv = cfg.convincement || {};
  const thresholds = conv.thresholds || { easy: 55, medium: 60, hard: 70 };
  const effortTurns = conv.effortTurns || { easy: 2, medium: 3, hard: 5 };
  const d = (difficulty === "easy" || difficulty === "hard") ? difficulty : "medium";
  const threshold = typeof thresholds[d] === "number" ? thresholds[d] : 60;
  const effort = typeof effortTurns[d] === "number" ? effortTurns[d] : 3;
  return { difficulty: d, threshold, effortTurns: effort };
}

// Compute readyToConvert + the convincement hint for a session. Shared by the
// per-turn path in index.js and composeForInspection so the inspection prompt
// matches what the LLM actually saw. Returns one of:
//   'ready'      — readyToConvert: score >= threshold OR (no open objections AND
//                  >= effortTurns counsellor turns scored >= +2 AND score >= threshold-10)
//   'warming'    — score within 10 of threshold, OR at least half the raised
//                  objections have been addressed
//   'resistant'  — default (current behaviour)
export function computeConvincementHint(session) {
  if (!session) return "resistant";
  const { satisfactionScore = 50, scenarioSnapshot, objectionState = [] } = session;
  const { threshold, effortTurns } = convincementParamsFor(scenarioSnapshot?.difficulty);

  const state = Array.isArray(objectionState) ? objectionState : [];
  const open = openObjections(state);
  const addressed = addressedObjections(state);

  // Count counsellor turns that scored a real positive (>= +2).
  const goodTurns = (session.scoreHistory || []).filter((h) => (h?.adjustment ?? 0) >= 2).length;

  const readyToConvert =
    satisfactionScore >= threshold ||
    (open.length === 0 && goodTurns >= effortTurns && satisfactionScore >= threshold - 10);
  if (readyToConvert) return "ready";

  const totalRaised = state.length;
  const halfAddressed = totalRaised > 0 && addressed.length >= Math.ceil(totalRaised / 2);
  if (satisfactionScore >= threshold - 10 || halfAddressed) return "warming";

  return "resistant";
}
