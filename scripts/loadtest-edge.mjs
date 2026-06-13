import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync("/Users/masai/Desktop/student-sim/.env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")), l.slice(l.indexOf("=")+1).trim()]));
const FN = env.SUPABASE_URL + "/functions/v1";
const N = Number(process.argv[2] || 10), TURNS = 3;

const auth = await fetch(env.SUPABASE_URL + "/auth/v1/token?grant_type=password", { method:"POST", headers:{apikey:env.SUPABASE_ANON_KEY,"Content-Type":"application/json"}, body: JSON.stringify({email:"test.counsellor@masaischool.com",password:"SmokeTest-1234"})});
const { access_token } = await auth.json();
const H = { Authorization: "Bearer " + access_token, "Content-Type": "application/json" };
const personas = await (await fetch(`${FN}/api/api/personas`, { headers: H })).json();
const personaId = personas[0].id;

const lat = [], codes = {};
const turnLines = ["Hi, I'm calling about the analytics program you enquired about. Tell me a bit about yourself?",
  "Got it. The program is 52,000 plus GST — but before that, what does your week look like time-wise?",
  "That works. What's the one thing that would make this an easy yes for you?"];
const t0 = Date.now();

async function runSession(i) {
  let s0 = Date.now();
  const start = await fetch(`${FN}/api/api/sessions/start`, { method:"POST", headers:H, body: JSON.stringify({ mode:"practice", sessionMode:"text", personaId }) });
  lat.push({ kind:"start", ms: Date.now()-s0, code: start.status });
  codes[start.status] = (codes[start.status]||0)+1;
  const sid = (await start.json()).sessionId;
  if (!sid) return { i, ok:false, reason:"no session id" };
  for (let t = 0; t < TURNS; t++) {
    const m0 = Date.now();
    const r = await fetch(`${FN}/session/api/sessions/${sid}/message`, { method:"POST", headers:H, body: JSON.stringify({ message: turnLines[t] }) });
    lat.push({ kind:"turn", ms: Date.now()-m0, code: r.status });
    codes[r.status] = (codes[r.status]||0)+1;
    if (r.status !== 200) { const b = await r.text(); return { i, ok:false, reason:`turn ${t} -> ${r.status} ${b.slice(0,100)}` }; }
  }
  return { i, ok:true };
}

const results = await Promise.all(Array.from({length:N}, (_,i) => runSession(i).catch(e => ({i, ok:false, reason:String(e).slice(0,100)}))));
const wall = Date.now()-t0;
const turns = lat.filter(l=>l.kind==="turn").map(l=>l.ms).sort((a,b)=>a-b);
const starts = lat.filter(l=>l.kind==="start").map(l=>l.ms).sort((a,b)=>a-b);
const pct = (arr,p)=> arr.length ? arr[Math.min(arr.length-1, Math.floor(p/100*arr.length))] : 0;
console.log(`=== ${N} CONCURRENT TEXT SESSIONS x ${TURNS} turns (heaviest path; 2 Claude calls/turn) ===`);
console.log("wall clock:", (wall/1000).toFixed(1)+"s");
console.log("sessions ok:", results.filter(r=>r.ok).length + "/" + N);
for (const r of results.filter(r=>!r.ok)) console.log("  FAIL session", r.i, "-", r.reason);
console.log("status codes:", JSON.stringify(codes));
console.log("start latency ms  p50:", pct(starts,50), " p95:", pct(starts,95), " max:", starts[starts.length-1]);
console.log("turn  latency ms  p50:", pct(turns,50), " p95:", pct(turns,95), " max:", turns[turns.length-1], `( ${turns.length} calls )`);
