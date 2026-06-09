// Tiny JSON file store. Each collection is a JSON array in server/data/<name>.json.
// Synchronous reads/writes keep the code simple and are fine for this single-process MVP.
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

// users.json + personas.json ship seeded; the rest are created empty on first run.
const RUNTIME_FILES = ["assignments.json", "sessions.json", "reports.json"];

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
  } catch {
    return [];
  }
}

function write(name, data) {
  fs.writeFileSync(join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
}

export const newId = (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`;

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

// Domain-specific lookups ---------------------------------------------------
export const findUserByEmail = (email) =>
  read("users").find((u) => u.email?.toLowerCase() === String(email).toLowerCase()) || null;

export const getCounsellors = () => read("users").filter((u) => u.role === "counsellor");
