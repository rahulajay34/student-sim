// _shared/lib/grounding.js — ported from server/grounding.js.
// CHANGES:
//   - Replaced readFileSync seed loading with JSON import attributes.
//     import x from "../seed/foo.json" with { type: "json" } — works in Deno AND Node 25.
//   - No process.env usage — no change needed there.

import archetypesRaw from "../seed/archetypes.json" with { type: "json" };
import objectionsRaw from "../seed/objections.json" with { type: "json" };
import benchmarksRaw from "../seed/benchmarks.json" with { type: "json" };
import structureRaw from "../seed/conversation-structure.json" with { type: "json" };

export const ARCHETYPES = archetypesRaw.archetypes;
export const OBJECTIONS = objectionsRaw.categories;
export const BENCHMARKS = benchmarksRaw;
export const STRUCTURE = structureRaw;

const CATEGORY_TO_ARCHETYPE = {
  studying: "reel_struck_parent_gated_fresher",
  graduate: "credential_stacking_campus_achiever",
  "same-field": "in_role_ai_upskiller",
  "diff-field": "automation_scared_switcher",
  "non-working": "career_break_returner",
};

export function archetypeForPersona(personaSnapshot) {
  const key = CATEGORY_TO_ARCHETYPE[personaSnapshot?.category];
  return ARCHETYPES.find((a) => a.key === key) || null;
}

export function objectionRepertoire(archetype, difficulty = "medium") {
  const count = difficulty === "hard" ? 4 : difficulty === "easy" ? 2 : 3;
  const preferred = {
    credential_stacking_campus_achiever: ["fee", "parents_family", "time_commitment", "course_fit_relevance"],
    reel_struck_parent_gated_fresher: ["parents_family", "fee", "trust_legitimacy", "job_guarantee_placement"],
    in_role_ai_upskiller: ["course_fit_relevance", "time_commitment", "fee", "emi_affordability"],
    automation_scared_switcher: ["course_fit_relevance", "job_guarantee_placement", "fee", "trust_legitimacy"],
    career_break_returner: ["fee", "competing_priorities", "course_fit_relevance", "trust_legitimacy"],
  };
  const keys = (archetype && preferred[archetype.key]) || ["fee", "parents_family", "course_fit_relevance", "trust_legitimacy"];
  return keys.slice(0, count)
    .map((k) => OBJECTIONS.find((o) => o.key === k))
    .filter(Boolean)
    .map((o) => ({ key: o.key, label: o.label, phrasings: o.phrasings.slice(0, 2) }));
}
