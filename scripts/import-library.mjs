/**
 * import-library.mjs — idempotent library import into Supabase.
 *
 * Reads server/data/{personas,courses,rubric-templates,leadProfiles,prompt-config,scoring-config}.json
 * and upserts them into the Supabase tables defined in supabase/migrations/0001_init.sql.
 *
 * Usage:
 *   node scripts/import-library.mjs [--env-file ../.env] [--dry]
 *
 * Required env vars (from .env or environment):
 *   SUPABASE_URL            — project URL, e.g. https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service-role JWT (bypasses RLS)
 *
 * Optional:
 *   SUPERADMIN_EMAIL        — comma-separated list of super-admin emails;
 *                              upserted as app_config key 'superadmins'
 *
 * Flags:
 *   --dry                   — skip all network calls; just print would-upsert counts
 *   --env-file <path>       — path to .env file (default: ../.env relative to this script)
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const DATA_DIR = join(REPO_ROOT, "server", "data");

/** Tiny .env parser — no dotenv dep. Handles #comments, quoted values, blank lines. */
function loadEnvFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip optional surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/** Chunk an array into batches of at most `size`. */
function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const envFileArgIdx = args.indexOf("--env-file");
const envFilePath =
  envFileArgIdx >= 0 && args[envFileArgIdx + 1]
    ? resolve(args[envFileArgIdx + 1])
    : join(REPO_ROOT, ".env");

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const envFromFile = loadEnvFile(envFilePath);
function env(key) {
  return process.env[key] ?? envFromFile[key] ?? "";
}

const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SUPERADMIN_EMAIL = env("SUPERADMIN_EMAIL");

if (!DRY && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error(
    "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n" +
    "  Set them in your .env file (default: repo root) or pass --env-file <path>.\n" +
    "  Use --dry to run without network calls."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Data loading + transformation
// ---------------------------------------------------------------------------

/**
 * personas: promoted columns = id, name, category, label, core_anxiety,
 * behaviour_prompt, description, personality (jsonb).
 * JSON uses camelCase: coreAnxiety, behaviourPrompt, createdAt, updatedAt.
 */
function loadPersonas() {
  const raw = readJson(join(DATA_DIR, "personas.json"));
  return raw.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    label: p.label ?? null,
    core_anxiety: p.coreAnxiety ?? null,
    behaviour_prompt: p.behaviourPrompt ?? null,
    description: p.description ?? null,
    personality: p.personality ?? {},
    // Timestamps: pass through if present; Supabase will default to now() on insert.
    ...(p.createdAt ? { created_at: p.createdAt } : {}),
    ...(p.updatedAt ? { updated_at: p.updatedAt } : {}),
  }));
}

/**
 * courses: promoted columns per 0001_init.sql =
 *   id, slug, name, category, institute, partner, duration, format,
 *   fee_total, fee_booking, fee_note, emi_note, active.
 * Everything else (curriculum, outcomes, eligibility, usps, batchInfo,
 * sourceUrl, scrapedAt, faqQuestions) goes into the `data` jsonb.
 * JSON uses camelCase: feeTotal, feeBooking, feeNote, emiNote.
 */
function loadCourses() {
  const raw = readJson(join(DATA_DIR, "courses.json"));
  return raw.map((c) => {
    // Promoted fields
    const promoted = {
      id: c.id,
      slug: c.slug ?? null,
      name: c.name,
      category: c.category ?? null,
      institute: c.institute ?? null,
      partner: c.partner ?? null,
      duration: c.duration ?? null,
      format: c.format ?? null,
      fee_total: c.feeTotal ?? null,
      fee_booking: c.feeBooking ?? null,
      fee_note: c.feeNote ?? null,
      emi_note: c.emiNote ?? null,
      active: c.active ?? true,
    };
    // Everything else into data jsonb
    const PROMOTED_KEYS = new Set([
      "id", "slug", "name", "category", "institute", "partner", "duration",
      "format", "feeTotal", "feeBooking", "feeNote", "emiNote", "active",
      "createdAt", "updatedAt",
    ]);
    const data = {};
    for (const [k, v] of Object.entries(c)) {
      if (!PROMOTED_KEYS.has(k)) {
        data[k] = v;
      }
    }
    return { ...promoted, data };
  });
}

/**
 * rubric_templates: promoted columns = id, name, description, criteria (jsonb),
 * is_default. JSON uses isDefault.
 */
function loadRubricTemplates() {
  const raw = readJson(join(DATA_DIR, "rubric-templates.json"));
  return raw.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    criteria: r.criteria ?? [],
    is_default: r.isDefault ?? false,
    ...(r.createdAt ? { created_at: r.createdAt } : {}),
    ...(r.updatedAt ? { updated_at: r.updatedAt } : {}),
  }));
}

/**
 * lead_profiles: promoted columns per 0001_init.sql =
 *   id, category, name, gender, age, occupation, education, city, label.
 * Extra fields (description + anything else) go into the `data` jsonb.
 * The source is leadProfiles.json, which is a { profiles: [...] } object.
 */
function loadLeadProfiles() {
  const raw = readJson(join(DATA_DIR, "leadProfiles.json"));
  const profiles = Array.isArray(raw) ? raw : (raw.profiles ?? []);

  const PROMOTED_KEYS = new Set([
    "id", "category", "name", "gender", "age", "occupation", "education", "city", "label",
  ]);

  return profiles.map((p) => {
    const promoted = {
      id: p.id,
      category: p.category,
      name: p.name ?? null,
      gender: p.gender ?? null,
      age: p.age ?? null,
      occupation: p.occupation ?? null,
      education: p.education ?? null,
      city: p.city ?? null,
      label: p.label ?? null,
    };
    const data = {};
    for (const [k, v] of Object.entries(p)) {
      if (!PROMOTED_KEYS.has(k)) {
        data[k] = v;
      }
    }
    return { ...promoted, data };
  });
}

/**
 * app_config rows:
 *   key 'prompts'      <- prompt-config.json (whole file as jsonb value)
 *   key 'scoring'      <- scoring-config.json (whole file as jsonb value)
 *   key 'superadmins'  <- SUPERADMIN_EMAIL split/trim/lowercase as jsonb array
 *                          (skipped with a warning when env var is missing)
 */
function loadAppConfig() {
  const promptConfig = readJson(join(DATA_DIR, "prompt-config.json"));
  const scoringConfig = readJson(join(DATA_DIR, "scoring-config.json"));

  const rows = [
    { key: "prompts", value: promptConfig },
    { key: "scoring", value: scoringConfig },
  ];

  if (SUPERADMIN_EMAIL) {
    const emails = SUPERADMIN_EMAIL.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (emails.length > 0) {
      rows.push({ key: "superadmins", value: emails });
    } else {
      console.warn("WARN: SUPERADMIN_EMAIL set but contained no valid emails after split/trim — skipping 'superadmins' row.");
    }
  } else {
    console.warn("WARN: SUPERADMIN_EMAIL not set — skipping 'superadmins' app_config row.");
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 500;

/**
 * Upsert a batch of rows into `table`, conflicting on the primary key.
 * In --dry mode, only prints what would be upserted.
 */
async function upsertTable(client, table, rows) {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (nothing to upsert)`);
    return;
  }

  if (DRY) {
    console.log(`  ${table}: would upsert ${rows.length} row(s) [dry-run]`);
    return;
  }

  let totalUpserted = 0;
  for (const batch of chunks(rows, CHUNK_SIZE)) {
    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: "id" });

    if (error) {
      throw new Error(`Supabase upsert into '${table}' failed: ${error.message} (code: ${error.code})`);
    }
    totalUpserted += batch.length;
  }
  console.log(`  ${table}: upserted ${totalUpserted} row(s)`);
}

/**
 * Upsert app_config rows (PK = key, not id).
 */
async function upsertAppConfig(client, rows) {
  if (rows.length === 0) {
    console.log("  app_config: 0 rows (nothing to upsert)");
    return;
  }

  if (DRY) {
    const keys = rows.map((r) => r.key).join(", ");
    console.log(`  app_config: would upsert ${rows.length} row(s) [${keys}] [dry-run]`);
    return;
  }

  let totalUpserted = 0;
  for (const batch of chunks(rows, CHUNK_SIZE)) {
    const { error } = await client
      .from("app_config")
      .upsert(batch, { onConflict: "key" });

    if (error) {
      throw new Error(`Supabase upsert into 'app_config' failed: ${error.message} (code: ${error.code})`);
    }
    totalUpserted += batch.length;
  }
  const keys = rows.map((r) => r.key).join(", ");
  console.log(`  app_config: upserted ${totalUpserted} row(s) [${keys}]`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (DRY) {
    console.log("=== import-library.mjs — DRY RUN (no network calls) ===\n");
  } else {
    console.log("=== import-library.mjs — Supabase library import ===\n");
    console.log(`  Supabase URL : ${SUPABASE_URL}`);
    console.log(`  Env file     : ${envFilePath}\n`);
  }

  // Load all data up-front (fails fast on missing files or bad JSON)
  console.log("Loading source data...");
  const personas = loadPersonas();
  const courses = loadCourses();
  const rubricTemplates = loadRubricTemplates();
  const leadProfiles = loadLeadProfiles();
  const appConfigRows = loadAppConfig();

  console.log(`  personas         : ${personas.length}`);
  console.log(`  courses          : ${courses.length}`);
  console.log(`  rubric_templates : ${rubricTemplates.length}`);
  console.log(`  lead_profiles    : ${leadProfiles.length}`);
  console.log(`  app_config rows  : ${appConfigRows.length}`);
  console.log();

  if (DRY) {
    console.log("Would-upsert counts (--dry mode):");
    console.log(`  personas         : ${personas.length}`);
    console.log(`  courses          : ${courses.length}`);
    console.log(`  rubric_templates : ${rubricTemplates.length}`);
    console.log(`  lead_profiles    : ${leadProfiles.length}`);
    console.log(`  app_config rows  : ${appConfigRows.length}`);
    console.log("\nDry run complete. Pass no --dry flag to run for real.");
    return;
  }

  // Create Supabase client (service-role — bypasses RLS)
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log("Upserting...");
  let failed = false;

  const tables = [
    { name: "personas", rows: personas },
    { name: "courses", rows: courses },
    { name: "rubric_templates", rows: rubricTemplates },
    { name: "lead_profiles", rows: leadProfiles },
  ];

  for (const { name, rows } of tables) {
    try {
      await upsertTable(client, name, rows);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      failed = true;
    }
  }

  try {
    await upsertAppConfig(client, appConfigRows);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    failed = true;
  }

  console.log();
  if (failed) {
    console.error("Import completed with errors. See above. Exiting with code 1.");
    process.exit(1);
  } else {
    console.log("Import complete.");
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
