// Backfill: re-run every READY report through the deployed report-worker so each
// gains the new report sections (e.g. new_report / integrity_check). Service-role
// + WORKER_SHARED_SECRET only — no user JWT needed. Throttled.
//
// Run: node scripts/backfill-reports-edge.mjs [concurrency]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, "..", ".env"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)", "m")) || [])[1]?.trim().replace(/^['"]|['"]$/g, "");
const URL = get("SUPABASE_URL");
const SR = get("SUPABASE_SERVICE_ROLE_KEY");
const WS = get("WORKER_SHARED_SECRET");
const CONCURRENCY = Number(process.argv[2]) || 4;

const sb = (path, opts = {}) =>
  fetch(`${URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(opts.headers || {}) } });

const reports = await sb("reports?status=eq.ready&select=id").then((r) => r.json());
console.log(`Found ${reports.length} ready reports. Concurrency=${CONCURRENCY}.`);

let i = 0, done = 0, ok = 0, withNew = 0, fail = 0;
async function worker() {
  while (i < reports.length) {
    const { id } = reports[i++];
    try {
      await sb(`reports?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "generating", worker_lease_until: null, worker_lease_token: null }) });
      const r = await fetch(`${URL}/functions/v1/report-worker`, { method: "POST", headers: { Authorization: `Bearer ${WS}`, "Content-Type": "application/json" }, body: JSON.stringify({ report_id: id }) });
      const j = await r.json().catch(() => ({}));
      const good = r.ok && (j.status === "ready" || j.status === "fallback");
      if (good) ok++; else fail++;
      // verify new_report landed
      const [row] = await sb(`reports?id=eq.${id}&select=new_report`).then((x) => x.json());
      if (row?.new_report) withNew++;
      console.log(`[${++done}/${reports.length}] ${id} http=${r.status} status=${j.status || "?"} new_report=${row?.new_report ? "yes" : "no"}`);
    } catch (e) {
      fail++; done++;
      console.log(`[${done}/${reports.length}] ${id} ERROR ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\nDONE ok=${ok} fail=${fail} with_new_report=${withNew}/${reports.length}`);
