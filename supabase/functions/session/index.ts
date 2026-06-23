// supabase/functions/session/index.ts
//
// HOT-PATH Edge Function (Hono). Ports the per-session live routes from
// server/index.js — the source of truth — onto Supabase Edge Functions:
//
//   POST /sessions/:id/message                  text chat per-turn pipeline (+ SSE)
//   POST /sessions/:id/observe                  voice (S2S) turn observation
//   POST /sessions/:id/cue                       on-demand richer coaching cue
//   POST /sessions/:id/realtime/openai-token    OpenAI Realtime ephemeral token mint
//
// CONTRACT.md defines the wire shapes; they MUST NOT change (the React client is
// unchanged). Differences vs the legacy Express server, all forced by the platform:
//   - store.* is async (Supabase service-role client) — every call is awaited.
//   - The in-memory per-session promise lock is replaced by the DB lease RPCs
//     claim_session_turn / commit_session_turn (0004_rpcs.sql). ALL LLM work runs
//     OUTSIDE any transaction; commit is a compare-and-set on the lease token.
//   - Auth: Bearer JWT via authenticate(req) + assertOwnerOrAdmin(session.counsellorId)
//     (replaces the X-User-Id dummy header guard). session.counsellorId === owner_id.
//   - SSE uses Hono streaming (streamSSE) instead of res.write.
//
// Authored as plain JavaScript syntax (no TS-only syntax) per project convention;
// validated via `node --check` on a temp .mjs copy.

import { Hono } from "npm:hono@4.10.1";
import { streamSSE } from "npm:hono@4.10.1/streaming";

import { getEnv } from "../_shared/env.js";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.js";
import * as store from "../_shared/store.js";
import { corsHeaders, handlePreflight } from "../_shared/cors.js";
import { normalizePath } from "../_shared/path.js";
import { authenticate, assertOwnerOrAdmin, errorResponse, httpError } from "../_shared/auth.js";

import { advancePhase, PHASE_NAMES } from "../_shared/lib/phases.js";
import {
  raiseObjection, resolveObjection, detectObjectionCategory, openObjections, steeringSummary,
  initObjectionState,
} from "../_shared/lib/objections.js";
import { instantCue, llmCue } from "../_shared/lib/cues.js";
import { getStudentReply, getStudentReplyStream } from "../_shared/lib/engine.js";
import { scoreMessage, isBackchannel, loadScoringConfig } from "../_shared/lib/scoring.js";
import { setUsageSink } from "../_shared/lib/llm.js";
import { bufferLlmUsage, bufferUsage, flushUsage } from "../_shared/usageStore.js";
import { setActivePromptConfig } from "../_shared/lib/promptConfig.js";
import { classifyCounsellorTurn } from "../_shared/lib/classify.js";
import {
  mintOpenAIClientSecret, buildRealtimeInstructions, openAIVoiceForSession,
} from "../_shared/lib/realtime.js";
import { computeDisposition } from "../_shared/lib/disposition.js";
import { exemplarsFor, renderAddress } from "../_shared/lib/styleExemplars.js";
import { stubReportSections } from "../_shared/lib/report.js";

// initMilestones / initObjectionState are also exported from phases/objections but
// for /message + /observe we only need initObjectionState (fail-soft seeding).

// ─────────────────────────────────────────────────────────────────────────────
// app_config cache — load the 'prompts' / 'scoring' rows once per request set with
// a tiny in-instance TTL (30s). The seed-merged config loaders (loadScoringConfig,
// loadPromptConfig) are pure; the engine/realtime libs internally use the
// seed-merged config (getPromptConfig() === loadPromptConfig(null)). The ONE place
// the hot path needs the live row is the scoring config's recentTurnsWindow.
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG_TTL_MS = 30_000;
const _configCache = new Map(); // key -> { value, ts }

async function getAppConfigValue(key) {
  const hit = _configCache.get(key);
  const now = Date.now();
  if (hit && now - hit.ts < CONFIG_TTL_MS) return hit.value;
  let value = null;
  try {
    value = await store.getConfigValue(key); // raw jsonb value (or null)
  } catch (err) {
    console.warn(`[session] app_config '${key}' load failed (using defaults):`, err?.message);
    value = null;
  }
  _configCache.set(key, { value, ts: now });
  return value;
}

// Returns the merged scoring config (seed defaults <- live DB row). Used only for
// recentTurnsWindow on the hot path.
async function scoringConfig() {
  const row = await getAppConfigValue("scoring");
  return loadScoringConfig(row);
}

// Fetch and activate the live prompt config (seed defaults <- live DB row).
// Called before any prompt composition path to ensure getPromptConfig() returns
// the admin-edited version rather than the hardcoded seed.
async function activatePromptConfig() {
  const row = await getAppConfigValue("prompts");
  setActivePromptConfig(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-turn verbosity roll — byte-identical to server/index.js rollTurnVerbosity.
// Phase 3 stays terse unless invited; talkativeness scales p(open); never two
// 'open' in a row.
// ─────────────────────────────────────────────────────────────────────────────
function rollTurnVerbosity({ talkativeness, currentPhase, turnType, lastTurnVerbosity }) {
  if (currentPhase === 3 && turnType !== "invite") return "short";
  const talk = typeof talkativeness === "number" ? Math.min(5, Math.max(1, talkativeness)) : 3;
  const pOpen = 0.30 + (talk - 1) * ((0.65 - 0.30) / 4);
  if (lastTurnVerbosity === "open") return "short";
  return Math.random() < pOpen ? "open" : "short";
}

// ─────────────────────────────────────────────────────────────────────────────
// deliveryMetrics sanitizers — verbatim from server/index.js.
//   sanitizeDeliveryMetrics: the richer /message prosody shape.
//   sanitizeRealtimeDeliveryMetrics: the lean { wpm, pauses, energyVar, durationMs }
//     shape from /observe.
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeDeliveryMetrics(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out = {};
  for (const key of ["tone", "energy"]) {
    if (typeof raw[key] === "string") out[key] = raw[key].slice(0, 32);
  }
  for (const key of ["wpm", "pitchVarSemitones", "pauseRatio", "energyCv"]) {
    if (key in raw && Number.isFinite(raw[key])) out[key] = raw[key];
  }
  if (raw.verdicts !== null && typeof raw.verdicts === "object" && !Array.isArray(raw.verdicts)) {
    const VERDICT_KEYS = new Set(["pace", "energy", "pitchVariation"]);
    const v = {};
    for (const k of VERDICT_KEYS) {
      if (typeof raw.verdicts[k] === "string") v[k] = raw.verdicts[k].slice(0, 16);
    }
    if (Object.keys(v).length > 0) out.verdicts = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeRealtimeDeliveryMetrics(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const key of ["wpm", "pauses", "energyVar", "durationMs"]) {
    const n = Number(raw[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Steering helpers — verbatim from server/index.js (PHASE_NEXT, stripEmotionArtifacts,
// buildSteering).
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_NEXT = {
  1: "you are just getting to know each other; expect the counsellor to ask about your background next.",
  2: "the counsellor is learning your situation; they will start explaining the programme soon.",
  3: "the counsellor is presenting the programme; your real concerns will start surfacing.",
  4: "your objections are on the table; the counsellor is trying to resolve them and move toward asking you to commit.",
  5: "you are near a decision; the counsellor may ask you to block your seat or pay.",
};

const TRAILING_EMOTION_RE = /[\s,.;:!?—-]*\b(neutral|happy|excited|hesitant|worried|frustrated)\b[\s.!?]*$/i;
function stripEmotionArtifacts(text) {
  if (typeof text !== "string") return "";
  let t = text.replace(/\[emotion:[^\]]*\]/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(TRAILING_EMOTION_RE, "").trim();
  return t;
}

function buildSteering(session) {
  const parts = [];
  const disp = computeDisposition(session);
  if (disp?.narrative) parts.push(`How you feel now: ${disp.narrative}`);
  const obj = steeringSummary(session.objectionState);
  if (obj) parts.push(obj);
  const phase = session.currentPhase || 1;
  const phaseName = PHASE_NAMES[phase] || PHASE_NAMES[1];
  parts.push(`Stage: ${phaseName} — ${PHASE_NEXT[phase] || PHASE_NEXT[1]}`);
  parts.push("Keep your replies conversational — about 10 to 30 spoken words.");

  const addressTerm = (session.counsellorAddress === "sir" || session.counsellorAddress === "ma'am")
    ? session.counsellorAddress : null;
  const turns = Array.isArray(session.transcript) ? session.transcript.length : 0;
  const anchorSeed = `${session.id || ""}|turn${turns}`;
  const anchor = exemplarsFor(phase, 1, anchorSeed)[0];
  if (anchor) parts.push(`Sound like: "${renderAddress(anchor, addressTerm)}"`);

  return parts.join("\n");
}

// Score a counsellor turn for /observe with a hard 14s chat budget + 15s race so the
// live call never blocks. Verbatim semantics from server/index.js scoreObserveTurn.
async function scoreObserveTurn(message, opts, cfg) {
  if (isBackchannel(message)) {
    return { adjustment: 0, reason: "Backchannel acknowledgement", addressedObjection: null };
  }
  try {
    const scored = await Promise.race([
      scoreMessage(message, opts, undefined, { timeoutMs: 14000, usage: { feature: "scoring", sessionId: opts.session?.id || null, counsellorId: opts.session?.counsellorId || null, personaLabel: opts.session?.personaSnapshot?.label || null } }, cfg),
      new Promise((resolve) => setTimeout(
        () => resolve({ adjustment: 0, reason: "score timeout", addressedObjection: null }),
        15000,
      )),
    ]);
    return scored || { adjustment: 0, reason: "score timeout", addressedObjection: null };
  } catch (err) {
    console.warn("[observe] scoring failed (non-fatal):", err?.message);
    return { adjustment: 0, reason: "scoring unavailable", addressedObjection: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn serialization via the DB lease RPCs.
//   claimTurn  -> token (90s TTL) or null (lease held = 409 "turn in progress").
//   commitTurn -> true (CAS ok) or false (lease raced; caller DISCARDS the write).
// The patch is the whole-column snake_case contract from commit_session_turn.
// ─────────────────────────────────────────────────────────────────────────────
async function claimTurn(sessionId) {
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("claim_session_turn", {
    p_session: sessionId,
    p_ttl: "90 seconds",
  });
  if (error) throw new Error(`claim_session_turn failed: ${error.message}`);
  return data; // uuid token or null
}

async function commitTurn(sessionId, token, patch) {
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("commit_session_turn", {
    p_session: sessionId,
    p_token: token,
    p_patch: patch,
  });
  if (error) throw new Error(`commit_session_turn failed: ${error.message}`);
  return data === true; // boolean
}

// Build the commit patch (whole-column snake_case) from a mutated session object.
// Only the columns the turn pipeline touches are sent; absent keys are untouched
// by the RPC. jsonb columns REPLACE wholesale (matches the JSON store's whole-doc
// write semantics).
function turnPatch(session, extra) {
  const patch = {
    current_phase: session.currentPhase,
    satisfaction_score: session.satisfactionScore,
    milestones: session.milestones,
    objection_state: session.objectionState,
    score_history: session.scoreHistory,
    transcript: session.transcript,
    pay_ask_count: session.payAskCount ?? 0,
  };
  // last_turn_verbosity is rolled per /message turn (always 'open'|'short' there).
  // Include the key on /message so the RPC writes it; omit on /observe so the column
  // is left untouched. The RPC uses `p_patch ? 'last_turn_verbosity'` to distinguish
  // a present (even null) value from an absent key.
  if (extra?.includeVerbosity) {
    patch.last_turn_verbosity = session.lastTurnVerbosity ?? null;
  }
  if (extra?.status) patch.status = extra.status;
  if (extra?.endedAt) patch.ended_at = extra.endedAt;
  return patch;
}

// Invoke the report-worker over HTTP to kick async report generation (used by the
// /message studentHungUp auto-end path — the edge-native equivalent of the legacy
// inline generateReport()). Fail-soft: if edge_base_url / service key are absent,
// the pg_cron sweeper recovers the 'generating' stub after the grace window.
async function kickReportWorker(reportId) {
  try {
    const base = await getAppConfigValue("edge_base_url");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!base || typeof base !== "string" || !serviceKey) {
      console.warn("[session] edge_base_url / service key unset — report-worker not kicked; sweeper will recover");
      return;
    }
    const url = base.replace(/\/+$/, "") + "/functions/v1/report-worker";
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
      body: JSON.stringify({ report_id: reportId }),
    });
  } catch (err) {
    console.warn("[session] kickReportWorker failed (sweeper will recover):", err?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hono app
// ─────────────────────────────────────────────────────────────────────────────
const app = new Hono();

// Record token usage for every per-turn LLM call (scoring, student reply, cue).
setUsageSink(bufferLlmUsage);
// Flush buffered usage events (a single batched insert, awaited) after each
// request so the edge runtime doesn't kill the write before it lands.
app.use("*", async (c, next) => {
  await next();
  await flushUsage();
});

// Resolve + authenticate + ownership-guard a session. Throws httpError on any
// failure; returns the fresh session object on success.
async function loadAuthorizedSession(c, sessionId) {
  const user = await authenticate(c.req.raw);
  const session = await store.getById("sessions", sessionId);
  if (!session) throw httpError(404, "Session not found. Please start a new session.");
  assertOwnerOrAdmin(user, session.counsellorId); // counsellorId === owner_id
  return session;
}

// ── POST /sessions/:id/message ───────────────────────────────────────────────
// The full per-chat-turn pipeline from server/index.js, text sessions only.
// JSON-mode response is byte-shape-identical; SSE mode (Accept: text/event-stream)
// emits the exact protocol (ping heartbeat -> token events -> done payload -> error).
app.post("/sessions/:id/message", async (c) => {
  const sessionId = c.req.param("id");
  const cors = corsHeaders(c.req.header("origin"));

  // Auth + load BEFORE claiming the lease (a 401/403/404 must not consume a turn).
  let session;
  try {
    session = await loadAuthorizedSession(c, sessionId);
  } catch (err) {
    return errorResponse(err, cors);
  }

  // 409 ended-session guard FIRST — before any SSE headers / lease.
  if (session.status === "ended") {
    return c.json({ error: "This session has ended." }, 409, cors);
  }

  const body = await c.req.json().catch(() => ({}));
  const { message, deliveryMetrics: rawDeliveryMetrics } = body || {};
  if (!message) return c.json({ error: "message is required" }, 400, cors);
  if (String(message).length > 4000) {
    return c.json({ error: "message too long (max 4000 characters)" }, 400, cors);
  }

  const wantsSSE = (c.req.header("accept") || "").includes("text/event-stream");

  // ── Turn serialization: claim the lease (replaces the in-memory lock). ──
  let token;
  try {
    token = await claimTurn(sessionId);
  } catch (err) {
    return errorResponse(err, cors);
  }
  if (!token) return c.json({ error: "turn in progress" }, 409, cors);

  // RE-READ the session fresh after acquiring the lease so we see the latest
  // persisted state (prevents the prior-turn clobber the JSON store's #7 lock
  // prevented). Anything from here releases the lease on every exit path.
  try {
    session = await store.getById("sessions", sessionId);
    if (!session) {
      await commitTurn(sessionId, token, {}).catch(() => {}); // release lease (no-op patch)
      return c.json({ error: "Session not found. Please start a new session." }, 404, cors);
    }
    // Re-check ended after the re-read (another turn may have ended it).
    if (session.status === "ended") {
      await commitTurn(sessionId, token, {}).catch(() => {});
      return c.json({ error: "This session has ended." }, 409, cors);
    }
  } catch (err) {
    return errorResponse(err, cors);
  }

  // Per-turn thinking toggle (body.thinking 'on'|'off') applied before reply gen.
  if (body?.thinking === "on" || body?.thinking === "off") {
    session.thinkingMode = body.thinking;
  }
  // Fail-soft seed objectionState for pre-tracking sessions.
  if (!Array.isArray(session.objectionState)) session.objectionState = initObjectionState();

  // ── Compute the turn (ALL LLM work outside any txn; the lease is held). ──
  // We build the result object then either stream it (SSE) or return JSON. In SSE
  // mode the heavy work runs inside the streaming callback (which owns timers).
  const [cfg] = await Promise.all([scoringConfig(), activatePromptConfig()]);
  const windowSize = cfg.recentTurnsWindow;

  // Compute everything that does NOT depend on the streamed reply up-front so both
  // SSE and JSON paths share identical logic.
  async function runTurn(emitToken) {
    // Classify -> advance phase on counsellor msg -> push counsellor entry (preScore).
    const turnType = classifyCounsellorTurn(message);
    advancePhase(session, "counsellor", message);
    const preScore = session.satisfactionScore;
    const now = new Date().toISOString();
    const counsellorEntry = {
      role: "counsellor", text: message, phase: session.currentPhase,
      turnType, scoreAfter: preScore, ts: now,
    };
    const sanitized = sanitizeDeliveryMetrics(rawDeliveryMetrics);
    if (sanitized) counsellorEntry.deliveryMetrics = sanitized;
    session.transcript.push(counsellorEntry);

    // Roll verbosity BEFORE the reply path (prepareReply reads session.lastTurnVerbosity).
    session.lastTurnVerbosity = rollTurnVerbosity({
      talkativeness: session.personalityFlavour?.talkativeness,
      currentPhase: session.currentPhase,
      turnType,
      lastTurnVerbosity: session.lastTurnVerbosity ?? null,
    });

    // Momentum context for the cue (one-turn lag — scoring for THIS turn runs
    // concurrently with the reply, so scoreHistory's last entry is the prior turn).
    const lastHistEntry = session.scoreHistory[session.scoreHistory.length - 1] || null;
    const lastCounsellorAdjustment = (lastHistEntry && typeof lastHistEntry.adjustment === "number")
      ? lastHistEntry.adjustment : null;
    const lastCounsellorScoreReason = lastHistEntry?.reason ?? null;

    const recentTurns = session.transcript.slice(-(windowSize + 1), -1).map(({ role, text }) => ({ role, text }));
    const openObjForScore = openObjections(session.objectionState).map(({ category }) => ({ key: category }));

    // Scoring (skips LLM for backchannels) and the reply run CONCURRENTLY. The reply
    // sees the PRE-message score (prepareReply reads session.satisfactionScore, which
    // we have not yet mutated).
    const scorePromise = isBackchannel(message)
      ? Promise.resolve({ adjustment: 0, reason: "Backchannel acknowledgement", addressedObjection: null })
      : scoreMessage(message, {
          recentTurns, phase: session.currentPhase, turnType, courseName: session.courseSnapshot?.name,
          openObjections: openObjForScore, session,
        }, undefined, { usage: { feature: "scoring", sessionId: session.id || null, counsellorId: session.counsellorId || null, personaLabel: session.personaSnapshot?.label || null } }, cfg);

    const replyPromise = (async () => {
      if (emitToken) {
        const gen = getStudentReplyStream(session);
        let step = await gen.next();
        while (!step.done) {
          await emitToken(step.value);
          step = await gen.next();
        }
        return step.value; // { text, emotion, raw }
      }
      return getStudentReply(session); // { text, emotion }
    })();

    const [{ adjustment, reason, addressedObjection, breakdown }, reply] = await Promise.all([scorePromise, replyPromise]);

    // Apply score; backfill counsellor entry.
    session.satisfactionScore = Math.max(0, Math.min(100, preScore + adjustment));
    counsellorEntry.scoreAfter = session.satisfactionScore;
    counsellorEntry.scoreReason = reason;
    session.scoreHistory.push({ turn: session.scoreHistory.length, score: session.satisfactionScore, adjustment, reason });

    // Objection lifecycle — resolve (counsellor's just-scored turn) then raise (reply).
    if (addressedObjection) {
      const counsellorTurnIdx = session.transcript.indexOf(counsellorEntry);
      resolveObjection(session.objectionState, addressedObjection, counsellorTurnIdx);
    }

    const { text: replyText, emotion } = reply;
    const gateCategory = advancePhase(session, "student", replyText);
    const studentTurnIdx = session.transcript.length;
    const raisedCategory = gateCategory || detectObjectionCategory(replyText);
    if (raisedCategory) raiseObjection(session.objectionState, raisedCategory, studentTurnIdx, replyText);

    session.transcript.push({
      role: "student", text: replyText, emotion, phase: session.currentPhase,
      scoreAfter: session.satisfactionScore, ts: new Date().toISOString(),
    });

    // Instant cue (zero-LLM).
    const cue = instantCue({
      session, lastStudentText: replyText, objectionCategory: raisedCategory,
      lastCounsellorAdjustment, lastCounsellorScoreReason, objectionState: session.objectionState,
    });

    // Auto-end when preScore was already below 35 (the student said goodbye).
    const studentHungUp = preScore < 35;
    let endPatchExtra = { includeVerbosity: true };
    if (studentHungUp) {
      session.status = "ended";
      session.endedAt = new Date().toISOString();
      endPatchExtra = { includeVerbosity: true, status: "ended", endedAt: session.endedAt };
    }

    // ── COMMIT under the lease (CAS). If it returns false the lease raced; DISCARD
    // the write (do not retry) and surface a 409. ──
    const committed = await commitTurn(sessionId, token, turnPatch(session, endPatchExtra));
    if (!committed) {
      return { raced: true };
    }

    // Post-commit: kick async report generation for the auto-end (outside the lease,
    // already released by commit). Insert the stub then invoke the worker.
    if (studentHungUp) {
      try {
        const counsellor = await store.getById("users", session.counsellorId);
        const stub = {
          sessionId: session.id,
          assignmentId: session.assignmentId,
          counsellorId: session.counsellorId,
          counsellorName: counsellor?.name || "",
          personaName: session.personaSnapshot?.name || "",
          scenarioTitle: session.scenarioSnapshot?.title || "",
          status: "generating",
          ...stubReportSections(session),
          generatedAt: new Date().toISOString(),
        };
        const inserted = await store.insert("reports", stub);
        if (session.assignmentId) {
          await store.update("assignments", session.assignmentId, { status: "completed", reportId: inserted.id }).catch(() => {});
        }
        await kickReportWorker(inserted.id);
      } catch (e) {
        console.error("[auto-end] report stub/kick failed:", e?.message);
      }
    }

    const payload = {
      reply: replyText, emotion,
      currentPhase: session.currentPhase, satisfactionScore: session.satisfactionScore,
      scoreReason: reason, turnType, milestones: session.milestones,
      cue,
      ...(studentHungUp ? { studentHungUp: true } : {}),
      ...(breakdown ? { scoreBreakdown: breakdown } : {}),
    };
    return { payload };
  }

  // ── SSE path ──
  if (wantsSSE) {
    // streamSSE sets text/event-stream + cache-control itself, but NOT CORS — apply
    // the CORS headers on the context so the browser accepts the streamed response.
    for (const [k, v] of Object.entries(cors)) c.header(k, v);
    // NOTE: the callback NEVER rethrows — it catches everything and emits its own
    // `error` event. This deliberately bypasses Hono's run() onError auto-handler,
    // which would otherwise append a SECOND error frame with a bare-string body.
    return streamSSE(c, async (stream) => {
      // Comment-frame heartbeat until the first real event (prevents idle-proxy
      // cutoffs during long thinking-mode waits). Cleared on first token/done/error.
      let heartbeat = setInterval(() => {
        stream.write(": ping\n\n").catch(() => {});
      }, 15000);
      const clearHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } };
      let committed = false;
      try {
        const result = await runTurn(async (tok) => {
          clearHeartbeat();
          await stream.writeSSE({ event: "token", data: JSON.stringify({ text: tok }) });
        });
        committed = true; // commitTurn ran inside runTurn (success or raced)
        clearHeartbeat();
        if (result.raced) {
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "turn in progress" }) });
        } else {
          await stream.writeSSE({ event: "done", data: JSON.stringify(result.payload) });
        }
      } catch (err) {
        console.error("Error in /sessions/message (SSE):", err?.stack || err?.message);
        // Release the lease if the throw happened before commit ran (idempotent no-op
        // CAS otherwise). Done in finally-style here so the lease never dangles 90s.
        if (!committed) await commitTurn(sessionId, token, {}).catch(() => {});
        clearHeartbeat();
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: err?.message || "internal error" }) }).catch(() => {});
      }
    });
  }

  // ── JSON path ──
  try {
    const result = await runTurn(null);
    if (result.raced) return c.json({ error: "turn in progress" }, 409, cors);
    return c.json(result.payload, 200, cors);
  } catch (err) {
    console.error("Error in /sessions/message:", err?.stack || err?.message);
    // Release the lease if we threw before commit.
    await commitTurn(sessionId, token, {}).catch(() => {});
    return c.json({ error: err?.message || "internal error" }, 500, cors);
  }
});

// ── POST /sessions/:id/observe ───────────────────────────────────────────────
// Voice (S2S) turn flow: classify + phase + scoring (14s budget) on counsellor text;
// objection + phase on student text; transcript appends; deliveryMetrics passthrough;
// steering string; instant cue. Same claim/commit serialization. 409 if ended.
app.post("/sessions/:id/observe", async (c) => {
  const sessionId = c.req.param("id");
  const cors = corsHeaders(c.req.header("origin"));

  let session;
  try {
    session = await loadAuthorizedSession(c, sessionId);
  } catch (err) {
    return errorResponse(err, cors);
  }
  if (session.status === "ended") {
    return c.json({ error: "This session has ended." }, 409, cors);
  }

  const body = await c.req.json().catch(() => ({}));
  const cText = stripEmotionArtifacts(typeof body?.counsellorText === "string" ? body.counsellorText.slice(0, 4000) : "");
  const sText = stripEmotionArtifacts(typeof body?.studentText === "string" ? body.studentText.slice(0, 4000) : "");
  const deliveryMetrics = cText ? sanitizeRealtimeDeliveryMetrics(body?.deliveryMetrics) : null;
  const responseDelayed = !!body?.responseDelayed && !!cText;
  if (!cText && !sText) return c.json({ error: "counsellorText or studentText is required" }, 400, cors);

  // ── Claim the turn lease. ──
  let token;
  try {
    token = await claimTurn(sessionId);
  } catch (err) {
    return errorResponse(err, cors);
  }
  if (!token) return c.json({ error: "turn in progress" }, 409, cors);

  try {
    // RE-READ fresh under the lease.
    session = await store.getById("sessions", sessionId);
    if (!session) {
      await commitTurn(sessionId, token, {}).catch(() => {});
      return c.json({ error: "Session not found. Please start a new session." }, 404, cors);
    }
    if (session.status === "ended") {
      await commitTurn(sessionId, token, {}).catch(() => {});
      return c.json({ error: "This session has ended." }, 409, cors);
    }
    if (!Array.isArray(session.objectionState)) session.objectionState = initObjectionState();

    // ── OpenAI voice cost: record per-turn realtime + transcription usage that the
    // browser forwards from the data channel (response.done / transcription events).
    // Best-effort telemetry; never blocks the turn. Flushed by the app middleware.
    try {
      const usageMeta = {
        sessionId: session.id || null,
        counsellorId: session.counsellorId || null,
        personaLabel: session.personaSnapshot?.label || null,
      };
      if (body?.realtimeUsage && typeof body.realtimeUsage === "object") {
        bufferUsage({ ...usageMeta, provider: "openai", model: getEnv("OPENAI_REALTIME_MODEL") || "gpt-realtime", feature: "voice", usage: body.realtimeUsage });
      }
      if (body?.transcriptionUsage && typeof body.transcriptionUsage === "object") {
        bufferUsage({ ...usageMeta, provider: "openai", model: getEnv("OPENAI_TRANSCRIBE_MODEL") || "gpt-4o-mini-transcribe", feature: "transcription", usage: body.transcriptionUsage });
      }
    } catch (err) {
      console.warn("[usage] voice usage record failed:", err && err.message);
    }

    const [cfg] = await Promise.all([scoringConfig(), activatePromptConfig()]);
    const windowSize = cfg.recentTurnsWindow;

    let turnType = null;
    let reason = null;
    let raisedCategory = null;

    // Counsellor turn: classify -> advance phase -> score -> objection resolve.
    if (cText) {
      turnType = classifyCounsellorTurn(cText);
      advancePhase(session, "counsellor", cText);
      const preScore = session.satisfactionScore;
      const counsellorEntry = {
        role: "counsellor", text: cText, phase: session.currentPhase,
        turnType, scoreAfter: preScore, ts: new Date().toISOString(),
      };
      if (deliveryMetrics) counsellorEntry.deliveryMetrics = deliveryMetrics;
      session.transcript.push(counsellorEntry);

      const recentTurns = session.transcript.slice(-(windowSize + 1), -1).map(({ role, text }) => ({ role, text }));
      const openObjForScore = openObjections(session.objectionState).map(({ category }) => ({ key: category }));

      let scored;
      if (responseDelayed) {
        scored = { adjustment: 0, reason: "Response delayed (>15 s after AI) — turn not scored", addressedObjection: null };
        counsellorEntry.responseDelayed = true;
      } else {
        scored = await scoreObserveTurn(cText, {
          recentTurns, phase: session.currentPhase, turnType,
          courseName: session.courseSnapshot?.name, openObjections: openObjForScore, session,
        }, cfg);
      }
      reason = scored.reason;
      session.satisfactionScore = Math.max(0, Math.min(100, preScore + scored.adjustment));
      counsellorEntry.scoreAfter = session.satisfactionScore;
      counsellorEntry.scoreReason = reason;
      session.scoreHistory.push({
        turn: session.scoreHistory.length, score: session.satisfactionScore, adjustment: scored.adjustment, reason,
        ...(responseDelayed ? { responseDelayed: true } : {}),
      });
      if (scored.addressedObjection) {
        resolveObjection(session.objectionState, scored.addressedObjection, session.transcript.indexOf(counsellorEntry));
      }
    }

    // Student reply (already spoken): advance phase + track objection.
    if (sText) {
      const gateCategory = advancePhase(session, "student", sText);
      const studentTurnIdx = session.transcript.length;
      raisedCategory = gateCategory || detectObjectionCategory(sText);
      if (raisedCategory) raiseObjection(session.objectionState, raisedCategory, studentTurnIdx, sText);
      session.transcript.push({
        role: "student", text: sText, emotion: "neutral", phase: session.currentPhase,
        scoreAfter: session.satisfactionScore, ts: new Date().toISOString(),
      });
    }

    // ── COMMIT under the lease (CAS). On false: lease raced — DISCARD + 409. ──
    const committed = await commitTurn(sessionId, token, turnPatch(session, {}));
    if (!committed) return c.json({ error: "turn in progress" }, 409, cors);

    const lastHist = session.scoreHistory[session.scoreHistory.length - 1] || null;
    const cue = instantCue({
      session, lastStudentText: sText, objectionCategory: raisedCategory,
      lastCounsellorAdjustment: lastHist && typeof lastHist.adjustment === "number" ? lastHist.adjustment : null,
      lastCounsellorScoreReason: lastHist?.reason ?? null, objectionState: session.objectionState,
    });
    const steering = buildSteering(session);

    return c.json({
      currentPhase: session.currentPhase, satisfactionScore: session.satisfactionScore,
      scoreReason: reason, turnType, milestones: session.milestones, cue, steering,
    }, 200, cors);
  } catch (err) {
    console.error("Error in /sessions/observe:", err?.stack || err?.message);
    await commitTurn(sessionId, token, {}).catch(() => {}); // release lease
    return c.json({ error: err?.message || "internal error" }, 500, cors);
  }
});

// ── POST /sessions/:id/cue ───────────────────────────────────────────────────
// On-demand richer cue: one deterministic LLM call (reasoning mode) over recent
// context, falling back to the synchronous corpus instantCue on any failure.
// No turn lease (read-only; no session write). Returns { cue, source }.
app.post("/sessions/:id/cue", async (c) => {
  const sessionId = c.req.param("id");
  const cors = corsHeaders(c.req.header("origin"));

  let session;
  try {
    session = await loadAuthorizedSession(c, sessionId);
  } catch (err) {
    return errorResponse(err, cors);
  }

  await activatePromptConfig();
  const cueHist = Array.isArray(session.scoreHistory) ? session.scoreHistory : [];
  const cueLastEntry = cueHist.length ? cueHist[cueHist.length - 1] : null;
  const cueLastAdjustment = (cueLastEntry && typeof cueLastEntry.adjustment === "number") ? cueLastEntry.adjustment : null;
  const cueLastReason = cueLastEntry?.reason ?? null;
  const fallbackInstantCue = () => {
    const lastStudent = [...(session.transcript || [])].reverse().find((m) => m.role === "student");
    const objectionCategory = lastStudent ? detectObjectionCategory(lastStudent.text) : null;
    return instantCue({
      session, lastStudentText: lastStudent?.text || "", objectionCategory,
      lastCounsellorAdjustment: cueLastAdjustment, lastCounsellorScoreReason: cueLastReason,
      objectionState: session.objectionState,
    });
  };
  try {
    const llm = await llmCue(session);
    if (llm) return c.json({ cue: llm, source: llm.source }, 200, cors);
    const cue = fallbackInstantCue();
    return c.json({ cue, source: cue.source }, 200, cors);
  } catch (err) {
    console.error("Error in /sessions/:id/cue:", err?.message);
    const cue = fallbackInstantCue();
    return c.json({ cue, source: cue.source }, 200, cors);
  }
});

// ── POST /sessions/:id/realtime/openai-token ─────────────────────────────────
// Mint a short-lived OpenAI Realtime ephemeral client secret for the browser WebRTC
// peer connection. OPENAI_API_KEY (via getEnv inside realtime.js) is never exposed.
// Body { voice? } auditions a voice live; default gender-matches the session.
app.post("/sessions/:id/realtime/openai-token", async (c) => {
  const sessionId = c.req.param("id");
  const cors = corsHeaders(c.req.header("origin"));

  let session;
  try {
    session = await loadAuthorizedSession(c, sessionId);
  } catch (err) {
    return errorResponse(err, cors);
  }

  const body = await c.req.json().catch(() => ({}));
  try {
    await activatePromptConfig();
    const voice = openAIVoiceForSession(session, body?.voice);
    const instructions = buildRealtimeInstructions(session);
    const out = await mintOpenAIClientSecret({ instructions, voice });
    return c.json({ value: out.value, model: out.model, voice: out.voice, expiresAt: out.expiresAt }, 200, cors);
  } catch (err) {
    console.error("Error minting OpenAI realtime token:", err?.message);
    return c.json({ error: err?.message || "token mint failed" }, 502, cors);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Entry point. Strip the function/path prefix so Hono matches "/sessions/:id/…",
// handle CORS preflight, and dispatch. Mirrors the report-worker's Deno.serve idiom.
// ─────────────────────────────────────────────────────────────────────────────
// @ts-ignore — Deno namespace exists in the Edge runtime but not in the Node TS lib.
Deno.serve((req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  // Rewrite the request URL to the normalized path so Hono's router (which matches
  // on URL pathname) sees "/sessions/:id/message" regardless of the /functions/v1/
  // or /api prefix the gateway/rewrite delivered.
  const path = normalizePath(req, "session");
  const u = new URL(req.url);
  u.pathname = path;
  const rewritten = new Request(u.toString(), req);
  return app.fetch(rewritten);
});

export { app };
