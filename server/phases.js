// Phase machine v2 — five phases mirroring real call structure (see
// server/data/seed/conversation-structure.json). Advancement is heuristic
// (message counts + corpus-derived markers) and NON-STRICT: milestones are
// tracked independently of the linear pointer, because real objections erupt
// in any phase.

import { detectObjectionCategory } from "./objections.js";

export const PHASE_NAMES = {
  1: "Opening",
  2: "Discovery",
  3: "Presentation",
  4: "Objections & Negotiation",
  5: "Close",
};

const DISCOVERY_RE = /(background|introduce yourself|tell me about|working|studying|graduat|experience|current(ly)? (role|job|doing)|why (do you|are you)|goal|looking for)/i;
const PRESENTATION_RE = /(curriculum|module|fee structure|programme fee|program fee|campus immersion|emi|₹|rupees|\b\d{2},?\d{3}\b)/i;
const OBJECTION_RE = /(can't afford|cannot afford|too (much|expensive|costly)|think about it|need (some )?time|talk to (my )?(parents|father|mother|family|wife|husband)|ask (my )?(parents|father|mother|family)|not sure (about|if)|worried|doubt|is (this|it) (a )?scam|is (this|it) genuine|refund|money.?back|guarantee|no time|too busy|after (my )?exam|upsc|government job|next (month|batch)|can i join later|emi|loan|interest)/i;
const PAYMENT_ASK_RE = /(block (your|the) seat|seat block|booking (fee|amount)|pay (the )?(₹|rs|rupees )?\d|secure (your|the) (seat|slot)|payment link|complete (the|your) (payment|admission)|today only|offer (ends|valid))/i;
const NEGATED_ASK_RE = /(not|never|won't|will not|no need to)[^.!?]{0,40}(send|share|ask|push|force)[^.!?]{0,40}(payment|link|pay)/i;

export function initPhaseCounters() {
  return { phase1Msgs: 0, phase2CounsellorMsgs: 0, phase3CounsellorMsgs: 0, phase4Exchanges: 0 };
}

export function initMilestones() {
  return { discoveryDone: false, presentationDone: false, paymentAsked: false, objectionsRaised: 0 };
}

/**
 * Advance the phase machine one step for `role`'s message `msg`.
 *
 * Mutates `session.currentPhase`, `session.milestones`, and
 * `session.phaseCounters` in place (existing callers unchanged).
 *
 * Additionally, when role === "student" and the text matches an objection, the
 * function returns the detected objection category string so the caller
 * (integration agent) can update the per-session objection state via
 * objections.js.  Returns `null` when no objection was detected or when
 * role === "counsellor".
 *
 * Backward-compatible: existing callers that ignore the return value are
 * unaffected.
 *
 * @param {object} session
 * @param {"counsellor"|"student"} role
 * @param {string} msg
 * @returns {string|null} Detected objection category key, or null.
 */
export function advancePhase(session, role, msg) {
  const c = session.phaseCounters || (session.phaseCounters = initPhaseCounters());
  const m = session.milestones || (session.milestones = initMilestones());
  const text = msg || "";

  // Milestones are tracked regardless of the current phase.
  let askedNow = false;
  if (role === "counsellor" && DISCOVERY_RE.test(text)) m.discoveryDone = true;
  if (role === "counsellor" && PRESENTATION_RE.test(text)) m.presentationDone = true;
  if (role === "counsellor" && PAYMENT_ASK_RE.test(text) && !NEGATED_ASK_RE.test(text)) {
    m.paymentAsked = true;
    if (session.currentPhase === 4) askedNow = true;
  }

  // Detect objection category for student messages. The broader OBJECTION_RE
  // gate keeps the objectionsRaised counter in sync; detectObjectionCategory
  // provides the fine-grained category key for the lifecycle tracker.
  let detectedCategory = null;
  if (role === "student" && session.currentPhase >= 3 && OBJECTION_RE.test(text)) {
    m.objectionsRaised += 1;
    detectedCategory = detectObjectionCategory(text);
  }

  switch (session.currentPhase) {
    case 1: // Opening -> Discovery: after greetings settle (~2 counsellor turns) or discovery probing starts
      // (#19) Only count COUNSELLOR turns so the threshold is not diluted by
      // the student's mirroring replies. With counsellor-first sessions the
      // student's first message is turn 2; without the fix a 4-way total counter
      // advanced on every message, so Opening lasted only ~2 total turns instead
      // of ~2 counsellor turns (i.e. ~4 total). Threshold stays at 2 counsellor
      // turns so Opening lasts the intended 1-2 exchange window.
      if (role === "counsellor") {
        c.phase1Msgs += 1;
        if (c.phase1Msgs >= 2 || DISCOVERY_RE.test(text)) session.currentPhase = 2;
      }
      break;
    case 2: // Discovery -> Presentation: counsellor starts presenting programme specifics
      if (role === "counsellor") {
        c.phase2CounsellorMsgs += 1;
        if (PRESENTATION_RE.test(text) || c.phase2CounsellorMsgs >= 5) session.currentPhase = 3;
      }
      break;
    case 3: // Presentation -> Objections: student pushes back, or presentation has run long
      if (role === "counsellor") c.phase3CounsellorMsgs += 1;
      if ((role === "student" && OBJECTION_RE.test(text)) || c.phase3CounsellorMsgs >= 6) session.currentPhase = 4;
      break;
    case 4: // Objections -> Close: counsellor asks for the seat-block payment (during phase 4)
      c.phase4Exchanges += 1;
      if (askedNow || c.phase4Exchanges >= 8) session.currentPhase = 5;
      break;
    default: // 5: Close — terminal
      break;
  }

  return detectedCategory;
}
