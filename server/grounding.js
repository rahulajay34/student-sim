// Loads the mined seed artifacts once and exposes grounding helpers for the
// student simulation and report engine. All files ship in server/data/seed/.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED = join(dirname(fileURLToPath(import.meta.url)), "data", "seed");
const load = (f) => JSON.parse(readFileSync(join(SEED, f), "utf8"));

export const ARCHETYPES = load("archetypes.json").archetypes;
export const OBJECTIONS = load("objections.json").categories;
export const BENCHMARKS = load("benchmarks.json");
export const STRUCTURE = load("conversation-structure.json");

// Persona categories (see server/data/personas.json) -> closest mined archetype.
// Actual category keys in personas.json: studying, graduate, same-field, diff-field, non-working
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

// Compact objection repertoire for the student prompt: the categories this
// archetype plausibly raises, with real phrasings to imitate.
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
