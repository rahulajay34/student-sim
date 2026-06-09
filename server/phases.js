// Heuristic 4-phase conversation state machine. Phase advancement is rule-based
// (message counts per role + keyword detection), not LLM-decided.

export const PHASE_NAMES = {
  1: "Student Introduction",
  2: "Course Information",
  3: "Concerns and Objections",
  4: "Closing",
};

const PHASE2_KEYWORDS = [
  "iim ranchi", "iim", "masai", "programme", "program", "course",
  "curriculum", "module", "fee", "faculty", "duration", "let me tell you",
  "let me explain", "6 month", "six month", "batch",
];

export function initPhaseCounters() {
  return {
    phase1StudentMsgs: 1, // the opening self-introduction counts as the first
    phase2CounsellorMsgs: 0,
    phase3StudentMsgs: 0,
    phase3CounsellorMsgs: 0,
  };
}

// Mutates session.currentPhase / session.phaseCounters in place.
export function advancePhase(session, role, messageContent) {
  const lower = (messageContent || "").toLowerCase();
  const c = session.phaseCounters;

  if (session.currentPhase === 1) {
    if (role === "student") {
      c.phase1StudentMsgs++;
    } else if (role === "counsellor" && c.phase1StudentMsgs >= 2) {
      if (PHASE2_KEYWORDS.some((k) => lower.includes(k))) session.currentPhase = 2;
    }
    return;
  }

  if (session.currentPhase === 2) {
    if (role === "counsellor") {
      c.phase2CounsellorMsgs++;
      if (c.phase2CounsellorMsgs >= 3) session.currentPhase = 3;
    }
    return;
  }

  if (session.currentPhase === 3) {
    if (role === "student") {
      c.phase3StudentMsgs++;
    } else if (role === "counsellor") {
      c.phase3CounsellorMsgs++;
      if (c.phase3StudentMsgs >= 2 && c.phase3CounsellorMsgs >= 2) session.currentPhase = 4;
    }
    return;
  }
}
