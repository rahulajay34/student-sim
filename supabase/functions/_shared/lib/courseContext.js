// _shared/lib/courseContext.js — ported from server/courseContext.js.
// CHANGES: no fs/path/process.env deps — byte-identical logic.

export const LEGACY_COURSE_CONTEXT = `
PROGRAMME: Executive Certification Programme in Business Analytics and AI for Aspiring Managers
INSTITUTION: IIM Ranchi, in partnership with Masai School
IIM RANCHI RANKING: 18th nationally in NIRF 2025

FEE STRUCTURE:
- Qualifier test fee: ₹99 (already paid by the student — non-refundable)
- Seat blocking fee (what the counsellor is asking for on this call): ₹4,000
- Total programme fee: ₹62,000 upfront OR ₹68,962 via EMI of ₹10,827/month for 6 months through NBFC lending partners

PROGRAMME DETAILS:
- Duration: 6 months
- Weekly time commitment: 8-10 hours per week
- Mode: Online, with a campus immersion module at IIM Ranchi

CURRICULUM (8 modules):
1. Data Management and SQL
2. Python for Analytics
3. Data Understanding, Preparation and Governance
4. Data Visualisation and Storytelling for Managers
5. Business Analytics and AI for Managers
6. Machine Learning for Business — Foundations
7. Advanced Analytics, AI Applications and Leadership
8. Campus Immersion at IIM Ranchi

FACULTY:
- Prof. Amit Sachan: Professor of Operations Management and Dean of Executive Education at IIM Ranchi
- Dr. Sobhan Sarkar: Assistant Professor in Information Systems and Business Analytics at IIM Ranchi

COUNSELLOR'S OBJECTIVE ON THIS CALL:
The counsellor is trying to get you to pay ₹4,000 to block your seat. You have already paid ₹99 and cleared the qualifier test, which means you have some baseline interest in the programme — but you have not made any financial commitment beyond that initial ₹99.
`;

export const fmtINR = (n) => (typeof n === "number" && Number.isFinite(n) ? `₹${n.toLocaleString("en-IN")}` : null);

export function buildCourseContext(course) {
  if (!course) return LEGACY_COURSE_CONTEXT;
  const fee = fmtINR(course.feeTotal);
  const booking = fmtINR(course.feeBooking) || "₹4,000";
  return `
PROGRAMME: ${course.name}
INSTITUTION: ${course.institute}, in partnership with ${course.partner || "Masai School"}
DURATION: ${course.duration || "n/a"} | MODE: ${course.format || "Online"}
${course.batchInfo ? `BATCH: ${course.batchInfo}` : ""}

FEE STRUCTURE:
- Seat blocking fee (what the counsellor is asking for on this call): ${booking}
${fee ? `- Total programme fee: ${fee}${course.feeNote ? ` (${course.feeNote})` : ""}` : `- Total programme fee: ${course.feeNote || "shared on the call by the counsellor"}`}
${course.emiNote ? `- EMI: ${course.emiNote}` : ""}

CURRICULUM (${(course.curriculum || []).length} modules):
${(course.curriculum || []).map((m, i) => `${i + 1}. ${m}`).join("\n")}
${course.eligibility ? `\nELIGIBILITY: ${course.eligibility}` : ""}
${course.usps?.length ? `\nPROGRAMME HIGHLIGHTS:\n${course.usps.map((u) => `- ${u}`).join("\n")}` : ""}

COUNSELLOR'S OBJECTIVE ON THIS CALL:
The counsellor is trying to get you to pay ${booking} to block your seat in this programme. You have shown
baseline interest (you booked this counselling call yourself) but have made no financial commitment yet.
`;
}
