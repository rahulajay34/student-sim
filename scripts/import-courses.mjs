// One-time script: parse all markdown files in course-info-extracted/ and
// write them into server/data/courses.json (merging with any existing entries).
// Run: node scripts/import-courses.mjs

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTED = join(__dirname, "..", "course-info-extracted");
const OUT = join(__dirname, "..", "server", "data", "courses.json");

// ── helpers ───────────────────────────────────────────────────────────────────

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).slice(0, 8);
}

function parseINR(str) {
  // "₹4,000" → 4000, "₹1,23,456" → 123456
  if (!str) return null;
  const n = parseInt(str.replace(/[₹,\s]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Extract the value that follows a label line (skipping blank lines).
function nextNonBlank(lines, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t) return { line: t, idx: i };
  }
  return null;
}

// ── category normaliser ───────────────────────────────────────────────────────
function normaliseCategory(raw) {
  const r = (raw || "").toLowerCase();
  if (r.includes("cybersec")) return "cybersecurity";
  if (r.includes("fintech") || r.includes("finance")) return "fintech";
  if (r.includes("analytics") || r.includes("ai") || r.includes("data")) return "analytics-ai";
  if (r.includes("business") || r.includes("management") || r.includes("mba")) return "business-management";
  if (r.includes("marketing")) return "digital-marketing";
  if (r.includes("product")) return "product-management";
  if (r.includes("software") || r.includes("engineering") || r.includes("fullstack")) return "software-engineering";
  if (r.includes("entrepreneurship")) return "entrepreneurship";
  return "other";
}

// ── institute normaliser ──────────────────────────────────────────────────────
const INSTITUTE_MAP = {
  // Proper names
  "iim ranchi": "IIM Ranchi",
  "iim mumbai": "IIM Mumbai",
  "iim rohtak": "IIM Rohtak",
  "iim trichy": "IIM Trichy",
  "iim sirmaur": "IIM Sirmaur",
  "iit patna": "IIT Patna",
  "iit roorkee": "IIT Roorkee",
  "iit mandi": "IIT Mandi",
  "iit guwahati": "IIT Guwahati",
  "bitsom": "BITS School of Management",
  "bits school of management": "BITS School of Management",
  "imt gaziabad": "IMT Ghaziabad",
  "imt ghaziabad": "IMT Ghaziabad",
  "pwc academy": "PwC Academy",
  "pwc": "PwC Academy",
  "masai": "Masai School",
  "nmims": "NMIMS",
  "nmims-cdoe": "NMIMS CDOE",
  "rotman": "Rotman School of Management",
  "fitt": "FITT IIT Delhi",
  "fitt iit delhi": "FITT IIT Delhi",
  "xlri": "XLRI",
  "tihan": "TiHAN IIT Hyderabad",
  "vishlesan i-hub": "IIT Patna",
  "vishlesan i-hub, iit patna": "IIT Patna",
  "ihub divyasampark": "IIT Roorkee",
  "ihub divyasampark, iit roorkee": "IIT Roorkee",
  "iit roorkee-eict": "IIT Roorkee EICT",
  // Slug-style keys (some files store institute as slug)
  "iim-ranchi": "IIM Ranchi",
  "iim-mumbai": "IIM Mumbai",
  "iim-rohtak": "IIM Rohtak",
  "iim-trichy": "IIM Trichy",
  "iim-sirmaur": "IIM Sirmaur",
  "iit-patna": "IIT Patna",
  "iit-roorkee": "IIT Roorkee",
  "iit-mandi": "IIT Mandi",
  "iit-guwahati": "IIT Guwahati",
  "iit-roorkee-eict": "IIT Roorkee EICT",
  "masai school": "Masai School",
};

function normaliseInstitute(raw) {
  if (!raw) return raw;
  const key = raw.toLowerCase().trim();
  for (const [k, v] of Object.entries(INSTITUTE_MAP)) {
    if (key === k || key.includes(k)) return v;
  }
  return raw.trim();
}

// ── slug from filename ────────────────────────────────────────────────────────
function slugFromFilename(filename) {
  // "iim-ranchi--business-analytics-ai.md" → "iim-ranchi/business-analytics-ai"
  return basename(filename, ".md").replace(/--/, "/");
}

// ── main parser ───────────────────────────────────────────────────────────────
function parseCourse(filepath) {
  const raw = readFileSync(filepath, "utf-8");
  const lines = raw.split("\n");
  const slug = slugFromFilename(filepath);

  // ── Key Facts block ──────────────────────────────────────────────────────
  const kf = {};
  for (const line of lines) {
    // Handles both "**Key:** value" and "**Key**: value"
    const m = line.match(/^\s*-\s+\*\*(.+?):?\*\*:?\s*(.+)/);
    if (m) kf[m[1].replace(/:$/, "").trim().toLowerCase()] = m[2].trim();
  }

  const name = kf["course"] || lines.find(l => l.startsWith("# "))?.slice(2).trim() || slug;
  const instituteRaw = kf["institute"] || "";
  const institute = normaliseInstitute(instituteRaw);
  const category = normaliseCategory(kf["category"] || "");
  const duration = kf["duration"] || "";
  const format = kf["mode"] || "Online";
  const sourceUrl = kf["course page"] || "";
  const batchInfo = kf["status"] || kf["batch"] || "";
  const eligibility = "";  // extracted below

  // ── Eligibility ──────────────────────────────────────────────────────────
  let eligibilityText = "";
  for (let i = 0; i < lines.length; i++) {
    if (/eligibility/i.test(lines[i]) && lines[i].startsWith("###")) {
      const next = nextNonBlank(lines, i);
      if (next) eligibilityText = next.line.replace(/^[-*•]\s*/, "").trim();
      break;
    }
  }
  // Also try inline in Key Facts style: "### Eligibility\n12th Pass..."
  if (!eligibilityText) {
    const eligLine = lines.find(l => /\*\*Eligibility\*\*/.test(l));
    if (eligLine) {
      const m = eligLine.match(/\*\*Eligibility\*\*[:\s]+(.+)/);
      if (m) eligibilityText = m[1].trim();
    }
    // From page content headings
    if (!eligibilityText) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "### Eligibility") {
          const next = nextNonBlank(lines, i);
          if (next) { eligibilityText = next.line.trim(); break; }
        }
      }
    }
  }

  // ── Fee Structure ────────────────────────────────────────────────────────
  let feeBooking = 4000;
  let feeTotal = null;
  let feeNote = "";
  let emiNote = "";

  // Find the fee section
  const feeStart = lines.findIndex(l => /^#{1,3}\s+(fee structure|fee structure$)/i.test(l.trim()));
  if (feeStart >= 0) {
    // Gather lines in the fee section (up to 80 lines or next major H2 section)
    const feeLines = [];
    for (let i = feeStart; i < Math.min(feeStart + 100, lines.length); i++) {
      // Stop at next top-level section that isn't fee-related
      if (i > feeStart && /^## [^F]/i.test(lines[i])) break;
      feeLines.push(lines[i]);
    }
    const feeBlock = feeLines.join("\n");

    // Extract all ₹ amounts from fee block
    const amounts = [...feeBlock.matchAll(/₹\s*([\d,]+)/g)]
      .map(m => parseINR("₹" + m[1]))
      .filter(Boolean)
      .filter(n => n > 99); // exclude ₹99 qualifier test fee

    // Registration fee (seat block) - first amount ≤ 5000 after ₹99
    const regAmounts = amounts.filter(n => n >= 1000 && n <= 10000);
    if (regAmounts.length) feeBooking = regAmounts[0];

    // Total fee: look for "Total Fees" label then next amount, or the largest
    // amount in the fee block that isn't GST-inflated
    const totalMatch = feeBlock.match(/(?:total fees?|total fee)[^\n]*\n+(?:[^\n]*\n+)*?₹\s*([\d,]+)/i);
    if (totalMatch) {
      feeTotal = parseINR("₹" + totalMatch[1]);
    }
    // Fallback: look for upfront amount (usually base+gst, we want one before it)
    if (!feeTotal && amounts.length >= 2) {
      // Filter out the booking fee and pick the next substantial one
      const bigAmounts = amounts.filter(n => n > 10000).sort((a, b) => a - b);
      if (bigAmounts.length) feeTotal = bigAmounts[0]; // the base total (pre-GST or upfront)
    }

    // EMI note
    const emiMatch = feeBlock.match(/₹\s*([\d,]+)\s*[×x]\s*(\d+)\s*months?/i);
    if (emiMatch) {
      emiNote = `EMI available: ₹${emiMatch[1]} × ${emiMatch[2]} months via NBFC partners.`;
    }
  }

  // ── Curriculum ───────────────────────────────────────────────────────────
  const curriculum = [];
  let inCurriculum = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#+\s+(what will you learn|curriculum|course details|course content|what you.ll learn|modules?)/i.test(l)) {
      inCurriculum = true;
      continue;
    }
    if (inCurriculum) {
      // Stop at next major H2 that isn't part of curriculum
      if (/^## /.test(lines[i]) && !/module|curriculum|learn|session|week/i.test(lines[i])) break;
      // Capture module/session/week headings
      const modMatch = l.match(/^#{3,4}\s+((?:module|session|week|unit|phase|part)\s+\d+[:\s].+)/i)
        || l.match(/^((?:module|session|week|unit|phase|part)\s+\d+[:\s].+)/i);
      if (modMatch) {
        const text = modMatch[1].replace(/^#{3,4}\s+/, "").trim();
        if (text.length > 3 && text.length < 120) curriculum.push(text);
      }
    }
  }

  // ── USPs / Why Choose ────────────────────────────────────────────────────
  const usps = [];
  let inUsps = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#+\s+(why choose|key highlights|programme highlights|what makes|features)/i.test(l)) {
      inUsps = true; continue;
    }
    if (inUsps) {
      if (/^## /.test(lines[i])) break;
      // Bold headings or bullet items
      const boldMatch = l.match(/^\*{1,3}(.+?)\*{1,3}[:\s]*(.*)$/);
      const bulletMatch = l.match(/^[-•*]\s+(.+)/);
      const hMatch = l.match(/^#{3,4}\s+(.+)/);
      const candidate = boldMatch ? boldMatch[1].trim()
        : hMatch ? hMatch[1].trim()
        : bulletMatch ? bulletMatch[1].trim()
        : null;
      if (candidate && candidate.length > 5 && candidate.length < 150 && !/^#{1,2}\s/.test(candidate)) {
        if (!usps.includes(candidate)) usps.push(candidate);
      }
      if (usps.length >= 6) break;
    }
  }

  // ── FAQ questions ────────────────────────────────────────────────────────
  const faqQuestions = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const qMatch = l.match(/^\*{0,2}Q:\s*(.+?)\*{0,2}$/);
    const h3q = l.match(/^###\s+(.+\?)$/);
    if (qMatch) faqQuestions.push(qMatch[1].trim());
    else if (h3q) faqQuestions.push(h3q[1].trim());
  }

  // ── outcomes ─────────────────────────────────────────────────────────────
  const outcomes = [];
  let inOutcomes = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^#+\s+(outcomes?|you.ll (get|achieve|earn)|certificate|placement|career)/i.test(l)) {
      inOutcomes = true; continue;
    }
    if (inOutcomes) {
      if (/^## /.test(lines[i])) break;
      const bullet = l.match(/^[-•*]\s+(.+)/);
      if (bullet && bullet[1].length > 10 && bullet[1].length < 200) {
        outcomes.push(bullet[1].trim());
        if (outcomes.length >= 5) break;
      }
    }
  }

  return {
    id: `course-${fnv1a(slug)}`,
    slug,
    name: name.replace(/\s*\|.*$/, "").trim(), // strip " | INSTITUTE" suffix
    category,
    institute,
    partner: "Masai School",
    duration: duration.replace(/^0/, "").trim(),
    format: /offline|campus|hybrid/i.test(format) ? "Hybrid" : "Online",
    feeTotal,
    feeBooking,
    feeNote,
    emiNote,
    curriculum,
    outcomes,
    eligibility: eligibilityText || "12th Pass and Above",
    usps: usps.slice(0, 6),
    batchInfo,
    sourceUrl,
    scrapedAt: new Date().toISOString(),
    active: true,
    faqQuestions: faqQuestions.slice(0, 15),
  };
}

// ── main ──────────────────────────────────────────────────────────────────────
const files = readdirSync(EXTRACTED).filter(f => f.endsWith(".md"));
console.log(`Parsing ${files.length} course files…`);

const newCourses = [];
const errors = [];

for (const f of files) {
  try {
    const course = parseCourse(join(EXTRACTED, f));
    newCourses.push(course);
    console.log(`  ✓ ${course.slug} — ${course.institute} — ${course.name.slice(0, 50)}`);
  } catch (e) {
    errors.push({ file: f, error: e.message });
    console.error(`  ✗ ${f}: ${e.message}`);
  }
}

// Load existing courses.json; keep any entries whose slug doesn't appear in the
// new batch (hand-crafted courses), replace everything else with fresh parses.
let existing = [];
try {
  existing = JSON.parse(readFileSync(OUT, "utf-8"));
} catch { /* first run */ }

const newSlugs = new Set(newCourses.map(c => c.slug));
const kept = existing.filter(c => !newSlugs.has(c.slug));
const merged = [...kept, ...newCourses].sort((a, b) => a.institute.localeCompare(b.institute) || a.name.localeCompare(b.name));

writeFileSync(OUT, JSON.stringify(merged, null, 2) + "\n");
console.log(`\nWrote ${merged.length} courses to server/data/courses.json`);
console.log(`  (${kept.length} kept from existing, ${newCourses.length} from markdown files)`);
if (errors.length) console.warn(`  ${errors.length} parse errors — check above`);
