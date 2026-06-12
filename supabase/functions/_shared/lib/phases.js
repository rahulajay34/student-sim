// _shared/lib/phases.js — ported from server/phases.js.
// CHANGES: replaced import path for objections.js.
// Otherwise byte-identical logic.

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
const PAYMENT_ASK_RE = /(block (your|the) seat|seat block|booking (fee|amount)|pay (the )?(₹|rs|rupees )?\d|secure (your|the) (seat|slot)|payment link|complete (the|your) (payment|admission)|(?:today only|offer (?:ends|valid))[^.!?]{0,40}(?:seat|pay|₹|rs\b|fee|book)|(?:seat|pay|₹|rs\b|fee|book)[^.!?]{0,40}(?:today only|offer (?:ends|valid)))/i;
const NEGATED_ASK_RE = /(not|never|won't|will not|no need to)[^.!?]{0,40}(send|share|ask|push|force)[^.!?]{0,40}(payment|link|pay)/i;

export function initPhaseCounters() {
  return { phase1Msgs: 0, phase2CounsellorMsgs: 0, phase3CounsellorMsgs: 0, phase4Exchanges: 0 };
}

export function initMilestones() {
  return { discoveryDone: false, presentationDone: false, paymentAsked: false, objectionsRaised: 0 };
}

export function advancePhase(session, role, msg) {
  const c = session.phaseCounters || (session.phaseCounters = initPhaseCounters());
  const m = session.milestones || (session.milestones = initMilestones());
  const text = msg || "";

  let askedNow = false;
  if (role === "counsellor" && DISCOVERY_RE.test(text)) m.discoveryDone = true;
  if (role === "counsellor" && PRESENTATION_RE.test(text)) m.presentationDone = true;
  if (role === "counsellor" && PAYMENT_ASK_RE.test(text) && !NEGATED_ASK_RE.test(text)) {
    m.paymentAsked = true;
    if (session.currentPhase === 4) askedNow = true;
  }

  let detectedCategory = null;
  if (role === "student" && session.currentPhase >= 3 && OBJECTION_RE.test(text)) {
    m.objectionsRaised += 1;
    detectedCategory = detectObjectionCategory(text);
  }

  switch (session.currentPhase) {
    case 1:
      if (role === "counsellor") {
        c.phase1Msgs += 1;
        if (c.phase1Msgs >= 2 || DISCOVERY_RE.test(text)) session.currentPhase = 2;
      }
      break;
    case 2:
      if (role === "counsellor") {
        c.phase2CounsellorMsgs += 1;
        if (PRESENTATION_RE.test(text) || c.phase2CounsellorMsgs >= 5) session.currentPhase = 3;
      }
      break;
    case 3:
      if (role === "counsellor") c.phase3CounsellorMsgs += 1;
      if ((role === "student" && OBJECTION_RE.test(text)) || c.phase3CounsellorMsgs >= 6) session.currentPhase = 4;
      break;
    case 4:
      c.phase4Exchanges += 1;
      if (askedNow || c.phase4Exchanges >= 8) session.currentPhase = 5;
      break;
    default:
      break;
  }

  return detectedCategory;
}
