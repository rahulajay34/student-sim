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
import { voiceBankFor, registerStatsFor } from "./register.js";
import { summarizeForPrompt } from "./objections.js";
import { computeDisposition, renderDispositionSection, stageToLegacyHint } from "./disposition.js";
import { exemplarsFor, renderAddress } from "./styleExemplars.js";

export { fmtINR };

// Resolve a session's counsellor-address term, fail-soft for old sessions that
// predate the field (missing/invalid -> null = "listen and use sir or ma'am").
function addressTermOf(session) {
  const a = session?.counsellorAddress;
  return (a === "sir" || a === "ma'am") ? a : null;
}

// The behaviour line telling the student how to address the counsellor, plus the
// "switch immediately if corrected" rule. Threaded into the prompt's behaviour
// section. null term -> "listen and use sir or ma'am accordingly".
function buildAddressSection(addressTerm) {
  if (addressTerm) {
    // The generic-example note matters when the term is "ma'am": a few config
    // meta-examples ('hello sir', 'yes sir, okay') are plain strings that can't
    // be address-rendered, so we explicitly de-fang them here.
    return `HOW YOU ADDRESS THE COUNSELLOR:\n- Address the counsellor as "${addressTerm}" every second or third sentence (matching the exemplar lines). Any example phrase in these instructions that says "sir" is generic — on THIS call always say "${addressTerm}". If they ever correct you on sir/ma'am, switch immediately and naturally without making a fuss.`;
  }
  return `HOW YOU ADDRESS THE COUNSELLOR:\n- You do not yet know whether the counsellor is "sir" or "ma'am" — listen for how they sound and use the right one accordingly. If they correct you, switch immediately and naturally without making a fuss.`;
}

// Contract C6 — the SINGLE source of truth for the language policy, used verbatim
// everywhere a language rule appears in the student prompt. Calibrated dial:
// natural Indian English with a LIGHT Hindi PARTICLE woven in roughly once every
// couple of turns (particles only — haan, thoda, achha, matlab, sentence-final
// 'na'); never full Hindi sentences or verb phrases unless the counsellor
// themselves speaks full Hindi sentences repeatedly.
export const LANGUAGE_POLICY = "Speak natural Indian English. Weave in a light Hindi particle (haan, thoda, achha, matlab, sentence-final 'na') roughly once every couple of turns — particles only, never full Hindi sentences or Hindi verb phrases, unless the counsellor themselves speaks full Hindi sentences repeatedly.";

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
// Exported so the realtime voice prompt (server/realtime.js) reuses the exact same
// scoped knowledge-bounds text rather than duplicating it. No behaviour change.
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

// Archetype texture + corpus objection repertoire (preserved from NEW).
// PHASE-SCOPED: the "WHO YOU REALLY ARE" background texture is included in ALL
// phases, but the long mined OBJECTIONS list is only relevant once the programme
// is being discussed/negotiated (phase >= 3). In Opening/Discovery a real student
// has not surfaced objections yet, so the list is omitted to cut prompt size.
function buildArchetypeBlock(persona, scenario, currentPhase) {
  const archetype = archetypeForPersona(persona);
  if (!archetype) {
    // Admin-created personas (category "custom") have no mined archetype — but
    // they still deserve a grounded objection repertoire from phase 3 on;
    // objectionRepertoire(null, …) returns the generic fallback set. Without
    // this, every custom persona ran a noticeably shallower simulation.
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

// PHASE-SCOPED: instead of injecting the full 5-phase cfg.phaseLadder every turn
// (~4 phases of irrelevant text), render only the current phase name + its
// instruction plus a single one-line pointer at the next phase (none on phase 5).
// This removes the bulk of the ladder from every prompt without losing the
// "do not jump ahead" steer.
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

// DISPOSITION — the dynamic-convincement block. REPLACES the old hardcoded
// buildScoreSection (the "AGREEMENT THRESHOLD: 70" / below-70 decline rule / five
// fixed score-band strings / numeric score exposure) AND buildConvincementSection.
// The student is now steered by an EMERGENT narrative of how they feel and what
// would move them — computed in disposition.js from score TRAJECTORY, the
// objection ledger, good-turn count, and a hidden per-session persuadability roll.
// No numbers, no score, no threshold are ever exposed to the student.
function buildDispositionSection(session) {
  const disposition = computeDisposition(session);
  return renderDispositionSection(disposition);
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

// STUDENT TUNING — two per-mock sliders the counsellor/admin set on 1-5 scales:
//   pushiness  — how assertively the student pushes back / demands specifics
//   hesitancy  — how reluctant the student is to commit / buy
// Rendered as a short behaviour steer. Text is configurable via cfg.tuning with
// fail-soft inline defaults so a missing/partial config can't break the prompt.
// Neutral (3) on a slider contributes nothing for that dimension.
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

// FAQ questions of the selected course, as QUESTION MATERIAL only (answers are
// deliberately not included — the knowledge bounds forbid the student knowing
// them). Degrades to "" when the course has no faqQuestions.
// PHASE-SCOPED: the student asks course questions during/after the presentation
// (phase >= 3), not in Opening/Discovery — so this is omitted in phases 1-2.
function buildCourseFaqSection(cfg, course, currentPhase) {
  if (currentPhase < 3) return "";
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
function buildFewShotSection(cfg, addressTerm) {
  const examples = Array.isArray(cfg.fewShot) ? cfg.fewShot.filter((s) => typeof s === "string" && s.trim()) : [];
  if (!examples.length) return "";
  const intro = cfg.fewShotIntro || "EXAMPLES OF REPLIES IN EXACTLY THIS REGISTER (do NOT copy verbatim):";
  // Exemplars are stored with "sir" — render them for the actual counsellor so
  // the examples never contradict the address section.
  return `${intro}
${examples.map((e) => `- "${renderAddress(e.trim(), addressTerm)}"`).join("\n")}`;
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

  // Talkativeness tilt: chatty -> upper end / +1 sentence; terse -> lower end.
  let lean;
  if (talk >= 4) lean = `You lean chatty, so sit at the upper end of that band and add a small extra detail where a quiet student would stop.`;
  else if (talk <= 2) lean = `You are on the terse side, so stay near the lower end — a few words is often the whole reply.`;
  else lean = `Stay around the middle of that band; a sentence or two is plenty.`;

  lines.push(`${phaseName}: real students answer in ${band} per turn${med != null ? ` (about ${med} typically)` : ""}. ${lean}`);
  return lines.join("\n");
}

// REGISTER REFERENCE — a small rotated sample of real student lines for this
// persona+phase (voiceBankFor). The mined lines are Hinglish, and the platform
// is moving to an ENGLISH-majority register, so this injection is DELIBERATELY
// kept tiny: at most ~3 stage lines, rendered in phases 2-5 (skipped only in the
// phase-1 opening, which is just a self-intro). The Hinglish backchannel block is
// dropped — it pushed the register the wrong way and added little. Renders ""
// when no artifacts exist (fail-soft).
// PHASES 2-4 mix the mined voice-bank lines with the owner-calibrated style
// exemplars for that phase (address-term rendered), deduped, still small: up to 3
// voice-bank stage lines + up to 3 style-exemplar lines. Phase 5 (Close) now also
// gets a couple of style-exemplar close lines (the voice bank stays gated to 2-4).
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

  // Mined voice-bank lines (phases 2-4 only — the bank is not gated for phase 5).
  // Address-rendered like the style exemplars: the mined corpus says "sir"
  // throughout, which contradicted the address section on ma'am calls.
  const stageLines = [];
  if (currentPhase >= 2 && currentPhase <= 4) {
    const bank = voiceBankFor(category, currentPhase, 6)
      .map((e) => (typeof e === "string" ? e : e?.text))
      .filter(Boolean);
    for (const t of bank) take(renderAddress(t, addressTerm), stageLines, 3);
  }

  // Owner-calibrated style exemplars for this phase (address-rendered, deduped
  // against the voice-bank lines above).
  const styleLines = [];
  for (const l of exemplarsFor(currentPhase, 3, seed)) {
    take(renderAddress(l, addressTerm), styleLines, 3);
  }

  const all = [...stageLines, ...styleLines];
  if (!all.length) return "";

  return `${cfg.registerRefIntro}
${all.map((t) => `- "${t}"`).join("\n")}`;
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

// SCORE-BASED BEHAVIOR OVERRIDE — absolute score level gates two hard behavior
// switches. These override the disposition narrative when active and are placed
// just before the emotion instruction so they are the highest-recency directive.
//   < 35: student is done — say a rude goodbye and end the call.
//   35–39: student is very defensive — push back sharply, give nothing easy.
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

// The [emotion:X] protocol instruction. CARVE-OUT: this is rendered AFTER the
// plain-spoken register rules and explicitly states the tag is exempt from
// every "talk like a plain student" rule, so nothing suppresses or mangles it.
export const EMOTION_INSTRUCTION = `EMOTION TAG (machine-read protocol — ALWAYS obey, exempt from every style rule above):
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
// session:  the full session object (optional) — threaded only for the dynamic
//           disposition (needs scoreHistory + id + persona/scenario traits). When
//           absent (legacy positional callers / tests) a synthetic session is
//           reconstructed from the positional persona/scenario/objectionState so
//           the disposition still renders deterministically.

// ─── Prompt-caching split ─────────────────────────────────────────────────────
// The prompt is split into two positional parts for Anthropic prompt caching:
//   stable   — everything deterministic for the full session (identity, persona,
//               scenario, knowledge bounds, situation, core anxiety, behaviour rules,
//               address, register, personality, few-shot, tangent). Cached across
//               turns with cache_control: { type: "ephemeral" }.
//   variable — everything that changes per turn or per phase (current-phase
//               instructions, disposition, tuning, momentum, objection-state,
//               verbosity, register-reference, course FAQ, score behaviour override,
//               emotion instruction, right-now turn discipline). NOT cached.
//
// The split point is immediately before buildPhaseSection — the first section
// that changes when session.currentPhase changes.  The separator between the two
// parts in the final composed string is "\n\n" (matching the template literal).
//
// buildSystemPrompt is implemented as join(buildSystemPromptParts(...)) — single
// source of truth, zero drift possible.

// Separator that joins stable + variable — must match the template exactly.
const PARTS_SEPARATOR = "\n\n";

// Returns { stable, variable } such that stable + PARTS_SEPARATOR + variable is
// byte-identical to the legacy buildSystemPrompt(...) output (after .replace /
// .trimEnd post-processing applied to the full joined string).
//
// NOTE: post-processing (.replace(/\n{3,}/g, "\n\n").trimEnd()) is applied to the
// JOINED string, not to each part individually, to preserve byte-identity.
export function buildSystemPromptParts(persona, scenario, currentPhase, satisfactionScore = 50, course = null, turnHint = null, flavour = null, convincementHint = null, objectionState = null, turnVerbosity = null, lastAdjustment = null, session = null) {
  const cfg = getPromptConfig();
  const booking = bookingOf(course);
  const archetypeBlock = buildArchetypeBlock(persona, scenario, currentPhase);
  const tuningSection = buildTuningSection(cfg, scenario);

  // DISPOSITION replaces the old score-band + convincement sections. Use the real
  // session when threaded; otherwise reconstruct a minimal one so the narrative is
  // still deterministic for positional callers.
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
  const verbositySection = buildVerbositySection(cfg, currentPhase, resolvedFlavour);
  // Style exemplars rotate by the session id; the address term decides sir/ma'am.
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

  // ── STABLE prefix (cached across turns) ──────────────────────────────────────
  // Sections: identity, general profile, archetype texture, scenario, knowledge
  // bounds, situation, core anxiety.
  // NOTE: archetypeBlock itself is phase-gated (empty in phases 1-2, populated
  // from phase 3). Because it changes at the phase-3 boundary the block sits in
  // the stable part and the cached token count changes once at that transition —
  // Anthropic invalidates and re-caches when the text changes, which is correct.
  const stable = `You are a student who is ${persona.label}. ${identityLine}

${buildGeneralProfile(cfg)}
${archetypeBlock ? `\n${archetypeBlock}\n` : ""}
${buildScenarioSection(scenario)}

${buildKnowledgeBounds(cfg, course)}

YOUR SITUATION:
You have already paid ₹99 and cleared the qualifier test. This means you have some genuine interest — you would not have paid and taken the test if you were completely uninterested. But you have not committed anything significant yet. The counsellor on this call will at some point ask you to pay ${booking} to block your seat.

YOUR CORE ANXIETY:
${persona.coreAnxiety}`;

  // ── VARIABLE suffix (NOT cached — changes per turn / per phase) ───────────────
  // Sections: phase instructions, disposition, tuning, momentum, objection-state,
  // behaviour prompt, behaviour rules, address, register note, verbosity, natural
  // speech, few-shot, personality, register reference, tangent, course FAQ,
  // turn-verbosity override, score-behavior override, emotion instruction, RIGHT NOW.
  const variable = `${buildPhaseSection(cfg, currentPhase, booking)}

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

${buildTurnSection(cfg, turnHint, currentPhase, course)}`;

  return { stable, variable };
}

export function buildSystemPrompt(persona, scenario, currentPhase, satisfactionScore = 50, course = null, turnHint = null, flavour = null, convincementHint = null, objectionState = null, turnVerbosity = null, lastAdjustment = null, session = null) {
  const { stable, variable } = buildSystemPromptParts(persona, scenario, currentPhase, satisfactionScore, course, turnHint, flavour, convincementHint, objectionState, turnVerbosity, lastAdjustment, session);
  return (stable + PARTS_SEPARATOR + variable).replace(/\n{3,}/g, "\n\n").trimEnd();
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

  // Thread the full session as the LAST positional arg so the disposition narrative
  // reads the real scoreHistory + id + traits (not a reconstructed stub).
  return buildSystemPrompt(
    personaSnapshot, scenarioSnapshot, currentPhase, satisfactionScore, courseSnapshot,
    null, personalityFlavour, convincementHint, objectionState, turnVerbosity, lastAdjustment, session,
  );
}

// LEGACY — retained only for back-compat and its unit tests. The live student
// willingness is computed by disposition.js (computeConvincementHint delegates
// there); nothing in the runtime prompt path reads these threshold params anymore.
export function convincementParamsFor(difficulty, hesitancy = 3) {
  const cfg = getPromptConfig();
  const conv = cfg.convincement || {};
  const thresholds = conv.thresholds || { easy: 55, medium: 60, hard: 70 };
  const effortTurns = conv.effortTurns || { easy: 2, medium: 3, hard: 5 };
  const d = (difficulty === "easy" || difficulty === "hard") ? difficulty : "medium";
  let threshold = typeof thresholds[d] === "number" ? thresholds[d] : 60;
  let effort = typeof effortTurns[d] === "number" ? effortTurns[d] : 3;

  // The hesitancy slider (1-5, neutral 3) shifts how hard it is to reach "ready":
  // a hesitant prospect needs a higher score and more good turns; an eager one,
  // less. Deltas are configurable (fail-soft to ±6 per step on the threshold and
  // ±1 per step on the effort). The threshold is clamped to a sane 35-95 band.
  const hes = clamp15(hesitancy);
  if (hes !== 3) {
    const thrStep = typeof conv.hesitancyThresholdStep === "number" ? conv.hesitancyThresholdStep : 6;
    const effStep = typeof conv.hesitancyEffortStep === "number" ? conv.hesitancyEffortStep : 1;
    threshold = Math.min(95, Math.max(35, threshold + (hes - 3) * thrStep));
    effort = Math.max(1, effort + Math.round((hes - 3) * effStep));
  }
  return { difficulty: d, threshold, effortTurns: effort };
}

// THIN ALIAS over the dynamic disposition (W4). The old hardcoded threshold logic
// is gone; willingness now emerges from disposition.js. This wrapper is kept so
// existing imports (engine.js, cues.js, etc.) keep working — it maps the emergent
// disposition.stage to the legacy three-value hint string:
//   guarded | listening -> 'resistant'
//   warming             -> 'warming'
//   ready               -> 'ready'
export function computeConvincementHint(session) {
  if (!session) return "resistant";
  const { stage } = computeDisposition(session);
  return stageToLegacyHint(stage);
}
