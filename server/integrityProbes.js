// Integrity-probe library — the curated "traps" the AI student naturally raises
// once per session, and which the report detector grades for misselling.
//
// The probe library lives in app_config key "integrityProbes" =
//   { probes: [{id,category,question,groundTruth,active}], guidelines: [] }
// admin-editable; DEFAULT_PROBES below is the one-time seed (also seeded into
// the DB via supabase/migrations/0009_integrity_check.sql).
//
// Selection per session is DETERMINISTIC: an FNV-1a hash of the session id
// modulo the count of ACTIVE probes (no Math.random — banned in edge/workflow
// contexts). The whole chosen probe is snapshotted onto the session at start so
// later admin edits don't change an in-flight grade.
import { newId as storeNewId } from "./store.js";

// ─── DEFAULT_PROBES — the 14 seed entries (grounded in masaischool.com) ───────
// Stable, deterministic ids derived from category. No Math.random.
export const DEFAULT_PROBES = [
  {
    id: "probe-job_guarantee",
    category: "job_guarantee",
    question: "Can you guarantee I'll get a job — like a 20 LPA package — after I finish?",
    groundTruth: "Masai does NOT guarantee a job or any CTC. Programmes give placement assistance/opportunities (some Pay-After-Placement). Promising a guaranteed job or salary = lie.",
    active: true,
  },
  {
    id: "probe-placement_eligibility",
    category: "placement_eligibility",
    question: "Everyone in the batch gets placement support, no conditions?",
    groundTruth: "Placement assistance is conditional (e.g. IIT Patna ~70% attendance + ~7 CGPA). \"Everyone, unconditionally\" = lie.",
    active: true,
  },
  {
    id: "probe-refund",
    category: "refund",
    question: "If I don't like it after a few classes, I get a full refund, right?",
    groundTruth: "Per T&Cs, withdrawal before OR after start = no refund. Promising refund/cooling-off/money-back = lie.",
    active: true,
  },
  {
    id: "probe-booking_refund",
    category: "booking_refund",
    question: "The ₹4,000 booking just blocks my seat and I get it back?",
    groundTruth: "Booking/registration amount is non-refundable (adjusted into fee, not returned). \"Fully refundable\" = lie.",
    active: true,
  },
  {
    id: "probe-content_access",
    category: "content_access",
    question: "Will I always have access to the content and recordings, forever?",
    groundTruth: "No lifetime/forever access is promised. Claiming permanent access = lie.",
    active: true,
  },
  {
    id: "probe-recordings_attendance",
    category: "recordings_attendance",
    question: "I work full-time — can I just watch recordings later and still get attendance?",
    groundTruth: "Live attendance required (~75–90%); recordings only with prior permission and \"won't be as effective\"; they don't substitute attendance. \"Watch anytime + get attendance\" = lie.",
    active: true,
  },
  {
    id: "probe-certificate_auto",
    category: "certificate_auto",
    question: "Once I pay and finish, the IIT/IIM certificate is guaranteed?",
    groundTruth: "Certificate needs min attendance + min marks (e.g. 75% + 35%, varies) and is forfeited on EMI default. \"Automatic/guaranteed\" = lie.",
    active: true,
  },
  {
    id: "probe-degree_vs_cert",
    category: "degree_vs_cert",
    question: "So this is basically an IIT/IIM degree?",
    groundTruth: "It is a certificate / certification programme, not a degree. Calling it a degree = lie.",
    active: true,
  },
  {
    id: "probe-alumni_access",
    category: "alumni_access",
    question: "Do I become an alumnus / get alumni access of the IIT/IIM?",
    groundTruth: "A short certificate programme does NOT confer IIT/IIM alumni status or alumni-network access. Promising it = lie.",
    active: true,
  },
  {
    id: "probe-campus_immersion",
    category: "campus_immersion",
    question: "The campus visit at the IIT is included free and guaranteed for everyone?",
    groundTruth: "Campus immersion is often optional and/or at extra cost (travel/stay), sometimes conditional. \"Free + guaranteed for all\" when untrue = lie.",
    active: true,
  },
  {
    id: "probe-emi_nocost",
    category: "emi_nocost",
    question: "The EMI is zero-interest / no-cost with no extra charges?",
    groundTruth: "NBFC / PAP financing carries interest; \"no-cost EMI\" is not assured. Guaranteeing 0%/no-cost = lie.",
    active: true,
  },
  {
    id: "probe-scholarship_urgency",
    category: "scholarship_urgency",
    question: "Is this scholarship only valid today — does the fee really go up tomorrow?",
    groundTruth: "Scholarships/schemes are at Masai's sole discretion; fabricated \"today-only\" deadlines/price hikes are misselling. Inventing fake urgency = lie.",
    active: true,
  },
  {
    id: "probe-faculty",
    category: "faculty",
    question: "Are all classes taught directly by the IIT/IIM professors?",
    groundTruth: "Teaching is a mix (institute faculty for some modules + Masai instructors/industry mentors). \"All by IIT/IIM profs\" when untrue = lie.",
    active: true,
  },
  {
    id: "probe-mentorship",
    category: "mentorship",
    question: "Do I get unlimited personal 1:1 mentorship whenever I want?",
    groundTruth: "Mentorship is structured/limited, not unlimited on-demand. Overstating = lie.",
    active: true,
  },
];

// ─── loadProbes — merge stored config over defaults, fail-soft ────────────────
// configValue is the raw app_config "integrityProbes" jsonb value:
//   { probes: [...], guidelines: [...] }
// Anything malformed / missing → DEFAULT_PROBES + empty guidelines.
export function loadProbes(configValue) {
  const fallback = { probes: DEFAULT_PROBES.map((p) => ({ ...p })), guidelines: [] };
  if (!configValue || typeof configValue !== "object") return fallback;

  const storedProbes = Array.isArray(configValue.probes) ? configValue.probes : null;
  if (!storedProbes) {
    return {
      probes: fallback.probes,
      guidelines: Array.isArray(configValue.guidelines) ? configValue.guidelines : [],
    };
  }

  // Sanitize each stored probe; merge over the default with the same id so a
  // partial stored entry still gets sensible defaults.
  const byId = new Map(DEFAULT_PROBES.map((p) => [p.id, p]));
  const probes = storedProbes
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const base = (typeof p.id === "string" && byId.get(p.id)) || {};
      return {
        id: typeof p.id === "string" && p.id ? p.id : base.id ?? null,
        category: typeof p.category === "string" ? p.category : base.category ?? "other",
        question: typeof p.question === "string" ? p.question : base.question ?? "",
        groundTruth: typeof p.groundTruth === "string" ? p.groundTruth : base.groundTruth ?? "",
        active: typeof p.active === "boolean" ? p.active : base.active ?? true,
      };
    })
    .filter((p) => p.id && p.question);

  if (!probes.length) return fallback;

  return {
    probes,
    guidelines: Array.isArray(configValue.guidelines) ? configValue.guidelines : [],
  };
}

// ─── pickProbe — deterministic FNV-1a selection over ACTIVE probes ────────────
// Returns the chosen probe object, or null if there are no active probes.
function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned 32-bit
}

export function pickProbe(probes, sessionId) {
  const active = (Array.isArray(probes) ? probes : []).filter((p) => p && p.active);
  if (active.length === 0) return null;
  const idx = fnv1a(sessionId) % active.length;
  return active[idx];
}

// ─── newProbeId — reuse store.newId() so ids stay collision-resistant ─────────
export function newProbeId() {
  return storeNewId("probe");
}
