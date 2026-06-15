// Tiny JSON file store. Each collection is a JSON array in server/data/<name>.json.
// Synchronous reads/writes keep the code simple and are fine for this single-process MVP.
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

// users.json + personas.json ship seeded. courses.json and rubric-templates.json also ship seeded
// but are included here so that an empty bootstrap file is created if somehow missing at startup.
// assignments.json, sessions.json, reports.json, and assignmentTemplates.json start empty on first run.
const RUNTIME_FILES = ["assignments.json", "sessions.json", "reports.json", "courses.json", "rubric-templates.json", "assignmentTemplates.json"];

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const f of RUNTIME_FILES) {
    const p = join(DATA_DIR, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, "[]\n");
  }
}
ensureData();

function read(name) {
  const p = join(DATA_DIR, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (err) {
    // A missing file is normal pre-bootstrap; anything else means the collection
    // is corrupt and we're about to serve (and on next write, persist) an empty
    // one — that must not happen silently.
    if (err?.code !== "ENOENT") {
      console.error(`[store] ${name}.json unreadable (${err.message}) — treating as empty`);
    }
    return [];
  }
}

function write(name, data) {
  // Atomic write: writeFileSync alone truncates first, so a crash mid-write
  // leaves partial JSON and read() would silently wipe the collection. Writing
  // to a tmp file then rename(2)-ing is atomic on the same filesystem.
  const p = join(DATA_DIR, `${name}.json`);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

// 12 hex chars = 48 bits. The old 8-char slice was 32 bits — ~1.2% birthday
// collision odds by 10k records, and getById would silently serve the older
// record forever on a collision.
export const newId = (prefix) => `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;

// Generic collection helpers ------------------------------------------------
export function getAll(name) {
  return read(name);
}

export function getById(name, id) {
  return read(name).find((r) => r.id === id) || null;
}

export function insert(name, record) {
  const all = read(name);
  all.push(record);
  write(name, all);
  return record;
}

export function update(name, id, patch) {
  const all = read(name);
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch };
  write(name, all);
  return all[idx];
}

export function remove(name, id) {
  const all = read(name);
  const next = all.filter((r) => r.id !== id);
  write(name, next);
  return all.length !== next.length;
}

// Counsellor code -----------------------------------------------------------
// Deterministic, stable, human-readable short code derived purely from the user
// id — no DB column. FNV-1a over the id, folded to 16 bits, rendered as 4 upper
// hex chars: "MAS-C-1A2B". Same id always yields the same code; distinct ids
// collide only at the ~16-bit birthday rate. Returns null for an id-less user.
export function counsellorCode(user) {
  const id = user?.id;
  if (!id) return null;
  // FNV-1a 32-bit hash.
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Fold 32 bits down to 16 (XOR the halves) so the printed code stays 4 hex chars.
  const folded = ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
  const hex = folded.toString(16).toUpperCase().padStart(4, "0");
  return `MAS-C-${hex}`;
}

// Domain-specific lookups ---------------------------------------------------
export const findUserByEmail = (email) =>
  read("users").find((u) => u.email?.toLowerCase() === String(email).toLowerCase()) || null;

export const getCounsellors = () => read("users").filter((u) => u.role === "counsellor");
