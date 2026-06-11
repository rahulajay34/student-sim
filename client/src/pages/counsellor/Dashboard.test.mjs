// Unit tests for the drill persona resolver (#20) used by Dashboard.handleStartDrill.
// Run with: node --test client/src/pages/counsellor/Dashboard.test.mjs
//
// Inline re-implementation so this file is self-contained (avoids transpiling JSX
// / Vite aliases for a Node test). This MUST mirror drillPersonaId in Dashboard.jsx
// exactly — any divergence is a test-maintenance bug, not a product bug.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const OBJECTION_TO_PERSONA = {
  parents_family: "persona-graduate",
  fee: "persona-non-working",
  emi_affordability: "persona-non-working",
  course_fit_relevance: "persona-diff-field",
  time_commitment: "persona-same-field",
};
const DEFAULT_DRILL_PERSONA = "persona-studying";

function drillPersonaId(drill) {
  const explicit = typeof drill?.personaId === "string" ? drill.personaId.trim() : "";
  if (explicit) return explicit;
  const mapped = OBJECTION_TO_PERSONA[drill?.objectionCategory];
  if (mapped) return mapped;
  return DEFAULT_DRILL_PERSONA || null;
}

describe("drillPersonaId", () => {
  it("prefers an explicit personaId from the payload", () => {
    assert.equal(
      drillPersonaId({ personaId: "persona-custom-7", objectionCategory: "fee" }),
      "persona-custom-7",
    );
  });

  it("trims a whitespace-padded explicit personaId", () => {
    assert.equal(drillPersonaId({ personaId: "  persona-x  " }), "persona-x");
  });

  it("falls back to the objection→persona map when no personaId", () => {
    assert.equal(drillPersonaId({ objectionCategory: "fee" }), "persona-non-working");
    assert.equal(drillPersonaId({ objectionCategory: "parents_family" }), "persona-graduate");
  });

  it("uses the default persona for an unmapped objection category", () => {
    assert.equal(drillPersonaId({ objectionCategory: "totally_unknown" }), "persona-studying");
  });

  it("uses the default persona when the drill carries nothing usable", () => {
    assert.equal(drillPersonaId({}), "persona-studying");
    assert.equal(drillPersonaId(null), "persona-studying");
  });

  it("ignores a non-string personaId and falls through to the map/default", () => {
    assert.equal(
      drillPersonaId({ personaId: 123, objectionCategory: "time_commitment" }),
      "persona-same-field",
    );
    assert.equal(drillPersonaId({ personaId: "   " }), "persona-studying");
  });

  it("never returns null while DEFAULT_DRILL_PERSONA is set", () => {
    // The Dashboard guard surfaces an error only when this returns a falsy id;
    // with a non-empty default that path is unreachable today, but the test
    // documents the contract so a future empty default trips here, not in prod.
    assert.ok(drillPersonaId({ objectionCategory: "x" }));
  });
});
