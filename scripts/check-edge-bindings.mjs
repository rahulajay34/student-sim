// Verifies every named ESM import across the edge functions + _shared actually
// exists as an export in the target module. Catches boot-time binding errors.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
const ROOT = "/Users/masai/Desktop/student-sim/supabase/functions";
const files = [];
(function walk(d){ for (const f of readdirSync(d)) { const p = join(d,f);
  if (f === "node_modules" || f === "seed") continue;
  if (statSync(p).isDirectory()) walk(p); else if (/\.(js|ts|mjs)$/.test(f)) files.push(p); } })(ROOT);
const exportsOf = (p) => {
  const src = readFileSync(p, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g))
    for (const part of m[1].split(",")) {
      const t = part.trim(); if (!t) continue;
      const as = t.match(/(?:[\w$]+)\s+as\s+([\w$]+)/); names.add(as ? as[1] : t.split(/\s+/)[0]);
    }
  if (/export\s+default/.test(src)) names.add("default");
  return names;
};
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/import\s*(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const [, defName, names, spec] = m;
    if (!spec.startsWith(".")) continue;
    const target = resolve(dirname(f), spec);
    let ex; try { ex = exportsOf(target); } catch { console.log(`MISSING FILE  ${f} -> ${spec}`); bad++; continue; }
    for (const part of names.split(",")) {
      const t = part.trim(); if (!t) continue;
      const name = (t.match(/^([\w$]+)/) || [])[1];
      if (name && !ex.has(name)) { console.log(`BAD BINDING   ${f.replace(ROOT,"")}: '${name}' not exported by ${spec}`); bad++; }
    }
    if (defName && !ex.has("default")) { console.log(`BAD DEFAULT   ${f.replace(ROOT,"")}: no default export in ${spec}`); bad++; }
  }
  // bare default imports: import X from "./mod.js"
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*["'](\.[^"']+)["']/g)) {
    const [, , spec] = m;
    if (spec.endsWith(".json")) continue;
    const target = resolve(dirname(f), spec);
    let ex; try { ex = exportsOf(target); } catch { console.log(`MISSING FILE  ${f} -> ${spec}`); bad++; continue; }
    if (!ex.has("default")) { console.log(`BAD DEFAULT   ${f.replace(ROOT,"")}: no default export in ${spec}`); bad++; }
  }
}
console.log(bad === 0 ? "ALL BINDINGS OK" : `${bad} BINDING PROBLEM(S)`);
