import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { bandColor, formatDate, TOKEN_HEX, reportScore, bandForScore } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import Card, { CardHeader } from "../../ui/Card";
import Badge from "../../ui/Badge";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import Modal from "../../ui/Modal";
import Button from "../../ui/Button";
import ScoreMeter from "../../ui/ScoreMeter";
import RubricBar from "./RubricBar";
import ScoreArcChart from "./ScoreArcChart";
import TranscriptView from "./TranscriptView";
import PhaseStepper from "./PhaseStepper";

// Poll the report every 2s while it's still generating; give up at 3 minutes.
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

// Visibility flag: the legacy "Rubric breakdown" card is hidden from the report
// page (the New Report Section supersedes it). The card's code is intentionally
// retained below — flip this to `true` to bring it back.
const SHOW_OLD_RUBRIC_BREAKDOWN = false;

// Missing status (old reports) is treated as a finished, ready report.
const statusOf = (report) => report?.status || "ready";

// ─── Skeleton placeholders (shown while LLM sections are generating) ──────────
function SkeletonLine({ className = "" }) {
  return <div className={`animate-pulse rounded bg-line/60 ${className}`} />;
}

function SkeletonBlock({ rows = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-canvas/60 p-4">
          <SkeletonLine className="h-3.5 w-1/3" />
          <SkeletonLine className="mt-2.5 h-3 w-full" />
          <SkeletonLine className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

// Count-up animation (~600ms, requestAnimationFrame) for the hero percent.
// Runs once when `active` is true; otherwise renders `target` directly. The
// rAF loop drives every value update asynchronously (no synchronous setState in
// the effect body), so the count-up never blocks the first paint.
function useCountUp(target, active, duration = 600) {
  const end = Number(target) || 0;
  // When inactive (e.g. fallback report) just show the final number outright.
  const [value, setValue] = useState(active ? 0 : end);

  // No one-shot ref here: the deps keep this from re-running while `end` is
  // stable, and a ref would leave the value frozen at 0 under StrictMode's
  // setup/cleanup/setup cycle (the first run's frame gets cancelled, the
  // second run would early-return).
  useEffect(() => {
    if (!active || end <= 0) return undefined;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(t < 1 ? Math.round(end * eased) : end);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, end, duration]);

  return active ? value : end;
}

// Monospace code block with copy button — used in the prompts panel.
function CodeBlock({ label, value }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value || "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-canvas p-3 font-mono text-xs leading-relaxed text-ink/80">
        {value || "—"}
      </pre>
    </div>
  );
}

// Admin-only modal showing the three composed prompts for the session.
function PromptsModal({ open, onClose, sessionId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !sessionId) return;
    let active = true;
    setLoading(true);
    setError("");
    api
      .getSessionPrompts(sessionId)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message || "Could not load prompts.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, sessionId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Session prompts"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {loading && (
        <div className="flex items-center justify-center py-10">
          <Spinner size={24} />
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      {!loading && !error && data && (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            The three prompts the LLM saw for this session. Read-only.
          </p>
          <CodeBlock label="Student system prompt" value={data.studentSystemPrompt} />
          <CodeBlock label="Scoring prompt (template)" value={data.scoringPrompt} />
          <CodeBlock label="Report prompt" value={data.reportPrompt} />
        </div>
      )}
    </Modal>
  );
}

function BackLink({ to }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink"
    >
      <span aria-hidden="true">←</span> Back to reports
    </Link>
  );
}

// Small dot used to lead the "did well" / "to improve" lines.
function Dot({ color }) {
  return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />;
}

// Hero percent with a one-shot count-up on the first render of the ready state.
// While generating it shows a dash so it doesn't animate to a stale 0.
function HeroPercent({ percent, animate }) {
  const value = useCountUp(percent ?? 0, animate);
  return (
    <span className="text-4xl font-bold tabular-nums text-ink">
      {value}
      <span className="text-2xl font-semibold text-muted">%</span>
    </span>
  );
}

// ─── Mini bar for 1-5 trait values ────────────────────────────────────────────
function TraitBar({ label, value }) {
  const v = typeof value === "number" && value >= 1 && value <= 5 ? value : null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-muted capitalize">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        {v != null && (
          <div
            className="h-full rounded-full bg-brand-600 transition-all duration-500"
            style={{ width: `${(v / 5) * 100}%` }}
          />
        )}
      </div>
      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-ink">
        {v != null ? v : "—"}
      </span>
    </div>
  );
}

// ─── New param bar (0-5 scale; admin-only "New Report Section") ───────────────
// Color mapping (scores are human-calibrated decimals, e.g. 3.6): >=4 → success/green,
// >=2.5 → warn/amber, <2.5 → danger/red.
function newParamColor(score) {
  if (score >= 4) return "success";
  if (score >= 2.5) return "warn";
  return "danger";
}

function NewParamBar({ item }) {
  if (!item) return null;
  const { label, score, summary } = item;
  const color = newParamColor(score);
  const hex = TOKEN_HEX[color];
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-sm font-semibold tabular-nums whitespace-nowrap" style={{ color: hex }}>
          {score}/5
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: hex }}
        />
      </div>
      {summary && (
        <p className="text-sm text-muted">{summary}</p>
      )}
    </div>
  );
}

// ─── Persona card (issue 9) ────────────────────────────────────────────────────
// Shown near the top of the report; snapshotted at session start so it's
// available even before LLM grading finishes.
function PersonaCardSection({ card }) {
  if (!card) return null;
  const { name, label, category, coreAnxiety, traits = {}, scenario = {} } = card;
  const { talkativeness, humour, skepticism, formality, quirks = [] } = traits;
  const { title: scenTitle, difficulty, pushiness, hesitancy } = scenario;

  // Colour a 1-5 slider: 1-2 green, 3 amber, 4-5 red
  function sliderColor(val) {
    if (val == null) return "text-muted";
    if (val <= 2) return "text-success";
    if (val === 3) return "text-warn";
    return "text-danger";
  }

  return (
    <Card className="p-6">
      <CardHeader title="Student persona" subtitle="Who you were speaking to in this session" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
        {/* Left: identity */}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-base font-semibold text-ink">{name || "—"}</p>
          <div className="flex flex-wrap gap-1.5">
            {label && <Badge color="brand">{label}</Badge>}
            {category && <Badge color="slate">{category}</Badge>}
            {difficulty && (
              <Badge color={difficulty === "hard" ? "danger" : difficulty === "easy" ? "success" : "warn"}>
                {difficulty}
              </Badge>
            )}
          </div>
          {coreAnxiety && (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">Core anxiety: </span>
              {coreAnxiety}
            </p>
          )}
          {scenTitle && (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">Scenario: </span>
              {scenTitle}
            </p>
          )}
          {quirks.length > 0 && (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">Quirks: </span>
              {quirks.join(", ")}
            </p>
          )}
        </div>

        {/* Center: trait bars */}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Personality (1–5)</p>
          <TraitBar label="Talkativeness" value={talkativeness} />
          <TraitBar label="Humour" value={humour} />
          <TraitBar label="Skepticism" value={skepticism} />
          <TraitBar label="Formality" value={formality} />
        </div>

        {/* Right: scenario difficulty sliders (prominent) */}
        <div className="shrink-0 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Session difficulty</p>
          <div className="flex gap-6">
            <div className="text-center">
              <div className={`text-3xl font-extrabold tabular-nums ${sliderColor(pushiness)}`}>
                {pushiness != null ? pushiness : "—"}
                {pushiness != null && <span className="text-base font-semibold text-muted">/5</span>}
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">Pushiness</div>
            </div>
            <div className="text-center">
              <div className={`text-3xl font-extrabold tabular-nums ${sliderColor(hesitancy)}`}>
                {hesitancy != null ? hesitancy : "—"}
                {hesitancy != null && <span className="text-base font-semibold text-muted">/5</span>}
              </div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">Hesitancy</div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Persona concerns addressed (issue 2) ─────────────────────────────────────
function PersonaAddressedSection({ data, generating }) {
  if (!data && !generating) return null;

  function addressedColor(status) {
    if (status === "fully") return "success";
    if (status === "partially") return "warn";
    return "danger";
  }
  function addressedLabel(status) {
    if (status === "fully") return "Fully addressed";
    if (status === "partially") return "Partially addressed";
    return "Not addressed";
  }

  return (
    <Card className="p-6">
      <CardHeader
        title="Persona concerns addressed"
        subtitle="Did you relate this student's specific concerns back to the course?"
        action={
          !generating && data?.score != null ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted">Score</span>
              <ScoreMeter score={(data.score / 10) * 100} className="w-24" />
              <span className="text-sm font-semibold tabular-nums text-ink">{data.score}/10</span>
            </div>
          ) : null
        }
      />
      {generating ? (
        <SkeletonBlock rows={3} />
      ) : (
        <div className="animate-fadeup space-y-4">
          {data?.summary && (
            <p className="text-sm text-muted">{data.summary}</p>
          )}
          {Array.isArray(data?.concerns) && data.concerns.length > 0 ? (
            <ul className="space-y-4">
              {data.concerns.map((item, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-line bg-canvas/60 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{item.concern}</p>
                    <Badge color={addressedColor(item.addressed)}>
                      {addressedLabel(item.addressed)}
                    </Badge>
                  </div>
                  {item.howRelatedToCourse && (
                    <p className="mt-2 text-sm text-ink/80">
                      <span className="font-medium text-ink">Course link: </span>
                      {item.howRelatedToCourse}
                    </p>
                  )}
                  {item.evidence && (
                    <p className="mt-1.5 text-sm italic text-muted">"{item.evidence}"</p>
                  )}
                  {item.comment && (
                    <p className="mt-2 flex items-start gap-1.5 text-sm">
                      <span className="shrink-0 text-warn">•</span>
                      <span className="text-ink/80">{item.comment}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No concerns tracked"
              hint="The LLM found no persona-specific concerns to evaluate."
            />
          )}
        </div>
      )}
    </Card>
  );
}

// Verdict → Badge color + label
function verdictColor(verdict) {
  if (verdict === "lied" || verdict === "overpromised") return "danger";
  if (verdict === "evasive") return "warn";
  if (verdict === "honest") return "success";
  return "slate"; // not_raised / absent / unknown
}

function verdictLabel(verdict) {
  const map = {
    lied: "Lied",
    overpromised: "Overpromised",
    evasive: "Evasive",
    honest: "Honest",
    not_raised: "Not raised",
    absent: "Absent",
  };
  return map[verdict] || verdict || "Unknown";
}

// Admin-only card — integrity trap result for this report.
// Rendered only when isAdmin && report.integrityCheck is present.
function IntegrityCheckCard({ check }) {
  const {
    question,
    verdict,
    severity,
    evidenceQuote,
    explanation,
    category,
  } = check;

  return (
    <Card className="p-6 border-danger/20">
      <CardHeader
        title="Integrity check"
        subtitle="Admin-only — fact-checking an integrity trap embedded in this session"
        action={
          <Badge color="slate" className="text-xs">
            Admin only
          </Badge>
        }
      />
      <div className="mt-4 space-y-4">
        {/* Probe question */}
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Probe question
          </span>
          {category && (
            <Badge color="slate" className="ml-2 text-xs">
              {category}
            </Badge>
          )}
          <p className="mt-1 text-sm font-medium text-ink">{question || "—"}</p>
        </div>

        {/* Verdict + severity */}
        <div className="flex items-center gap-3">
          <Badge color={verdictColor(verdict)}>
            {verdictLabel(verdict)}
          </Badge>
          {typeof severity === "number" && (
            <span className="text-xs text-muted">
              Severity&nbsp;
              <span className="font-semibold tabular-nums text-ink">{severity}</span>
              /3
            </span>
          )}
        </div>

        {/* Evidence quote */}
        {evidenceQuote && (
          <div className="rounded-xl border border-line bg-canvas/60 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Evidence
            </span>
            <p className="mt-1.5 text-sm italic text-muted">"{evidenceQuote}"</p>
          </div>
        )}

        {/* Explanation */}
        {explanation && (
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Explanation
            </span>
            <p className="mt-1 text-sm text-ink/80">{explanation}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function ReportDetail({ backTo = "/app/reports" }) {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = ["admin", "superadmin"].includes(user?.role);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Initial load.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPollTimedOut(false);
    api
      .getReport(id)
      .then((data) => {
        if (active) setReport(data);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load this report.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  // Poll every 2s while the report is still generating; give up at 3 minutes.
  const isGenerating = report && statusOf(report) === "generating";
  // Hold the poll-window start in a ref so it survives the effect re-running each
  // time setReport swaps in a new object — otherwise `startedAt` reset every tick
  // and the 3-minute give-up timeout could never fire.
  const pollStartRef = useRef(null);
  // Bumped by handleRegenerate so the poll effect restarts even when the report
  // was already "generating" before the retry (isGenerating true → true never
  // re-runs the effect on its own, which left the timed-out page polling-dead).
  const [retryNonce, setRetryNonce] = useState(0);
  // Consecutive poll failure tracking: after 3 failures, show the server-unavailable alert.
  const pollFailCountRef = useRef(0);
  const [pollFailed, setPollFailed] = useState(false);
  useEffect(() => {
    if (!isGenerating) {
      pollStartRef.current = null;
      pollFailCountRef.current = 0;
      return undefined;
    }
    if (!pollStartRef.current) pollStartRef.current = Date.now();
    let active = true;
    const timer = setInterval(() => {
      if (!active) return;
      if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
        setPollTimedOut(true);
        clearInterval(timer);
        return;
      }
      api
        .getReport(id)
        .then((data) => {
          if (!active) return;
          // Reset failure count on success.
          pollFailCountRef.current = 0;
          setPollFailed(false);
          setReport(data);
        })
        .catch(() => {
          if (!active) return;
          pollFailCountRef.current += 1;
          if (pollFailCountRef.current >= 3) {
            setPollFailed(true);
          }
        });
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, isGenerating, retryNonce]);

  // Regenerate a fallback (or timed-out) report by re-calling /end for the session.
  async function handleRegenerate() {
    if (!report?.sessionId || regenerating) return;
    setRegenerating(true);
    setPollTimedOut(false);
    setPollFailed(false);
    pollFailCountRef.current = 0;
    // Fresh 3-minute window + force the poll effect to restart.
    pollStartRef.current = null;
    setRetryNonce((n) => n + 1);
    try {
      await api.regenerateReport(report.sessionId);
      const fresh = await api.getReport(id);
      setReport(fresh);
    } catch (err) {
      setError(err.message || "Could not regenerate this report.");
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-center py-24">
          <Spinner size={28} />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <BackLink to={backTo} />
        <Card className="p-6">
          <EmptyState
            title={error ? "Couldn't load report" : "Report not found"}
            hint={
              error ||
              "This report may have been removed, or the link is no longer valid."
            }
            action={
              <Link
                to={backTo}
                className="inline-flex items-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                Back to reports
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const status = statusOf(report);
  const generating = status === "generating";
  const isFallback = status === "fallback" || report.fallback === true;

  const {
    overall = {},
    rubric = [],
    phaseBreakdown = [],
    strengths = [],
    improvements = [],
    keyMoments,
    benchmarks,
    drills,
    scoreArc = [],
    transcript = [],
    counsellorName,
    personaName,
    scenarioTitle,
    generatedAt,
    personaCard: pc,
    personaAddressed: pa,
  } = report;

  const converted = overall.outcome === "Converted";
  // The headline score: New Report Section total, falling back to legacy percent.
  const heroScore = reportScore(report);
  const heroBand = bandForScore(heroScore);
  // Prefer the stub's persisted finalScore; fall back to the last arc point.
  const finalScore =
    typeof report.finalScore === "number"
      ? report.finalScore
      : scoreArc.length
        ? scoreArc[scoreArc.length - 1].score
        : null;
  const reachedPhase = Math.max(1, ...(report.transcript || []).map((t) => t.phase || 1));

  const meta = [counsellorName, personaName, scenarioTitle, formatDate(generatedAt)].filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* GENERATING banner */}
      {generating && !pollTimedOut && !pollFailed && (
        <div
          className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700"
          aria-live="polite"
        >
          <Spinner size={18} />
          <span>Generating your coaching report… the score and transcript are ready below; coaching detail will fill in shortly.</span>
        </div>
      )}

      {/* POLL-FAILED banner — shown after 3 consecutive poll failures */}
      {generating && pollFailed && !pollTimedOut && (
        <Card
          role="alert"
          className="border-warn/40 bg-warn-soft/40 p-4"
          aria-live="polite"
        >
          <p className="text-sm font-medium text-ink/80">
            Report generation is taking longer than expected — the server may be unavailable.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPollFailed(false);
                pollFailCountRef.current = 0;
              }}
            >
              Keep waiting
            </Button>
            <Button variant="secondary" size="sm" onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? "Retrying…" : "Retry"}
            </Button>
          </div>
        </Card>
      )}

      {/* TIMED-OUT banner (poll gave up after 3 minutes) */}
      {generating && pollTimedOut && (
        <div
          className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 px-4 py-3 text-sm text-warn sm:flex-row sm:items-center sm:justify-between"
          aria-live="polite"
        >
          <span className="text-ink/80">
            This report is taking longer than usual. You can keep waiting, or retry generation.
          </span>
          <Button variant="secondary" size="sm" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}

      {/* DELAYED-RESPONSE warning — shown when turns were not scored due to >15s latency */}
      {!!report.delayedTurns && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className="mt-0.5 h-4 w-4 shrink-0 text-danger">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="text-ink/80">
            <strong className="text-danger">{report.delayedTurns} turn{report.delayedTurns > 1 ? "s were" : " was"} not scored</strong>
            {" "}— the counsellor took more than 15 seconds to start speaking after the student finished.
            Delayed answers are excluded from the satisfaction score to prevent use of external references during the call.
          </span>
        </div>
      )}

      {/* FALLBACK banner — visible amber notice with a working regenerate action */}
      {isFallback && !generating && (
        <div
          className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          aria-live="polite"
        >
          <span className="text-ink/80">
            We couldn't fully generate this report, so it shows neutral placeholder scores. Try generating it again.
          </span>
          <Button variant="secondary" size="sm" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? "Regenerating…" : "Regenerate report"}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <BackLink to={backTo} />
        {isAdmin && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPromptsOpen(true)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            View prompts
          </Button>
        )}
      </div>

      {/* Admin: session prompts modal */}
      {isAdmin && (
        <PromptsModal
          open={promptsOpen}
          onClose={() => setPromptsOpen(false)}
          sessionId={report?.sessionId}
        />
      )}

      {/* HERO */}
      <Card className="p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              {generating ? (
                <span className="text-4xl font-bold tabular-nums text-muted/50">
                  —<span className="text-2xl font-semibold text-muted/40">%</span>
                </span>
              ) : (
                <HeroPercent percent={heroScore == null ? null : Math.round(heroScore)} animate={!isFallback} />
              )}
              {heroBand && <Badge color={bandColor(heroBand)}>{heroBand}</Badge>}
              {overall.outcome && (
                <Badge color={converted ? "success" : "slate"}>{overall.outcome}</Badge>
              )}
            </div>
            {overall.headline && !generating && (
              <p className="mt-3 text-base font-semibold text-ink">{overall.headline}</p>
            )}
            {overall.outcomeDetail && (
              <p className="mt-2 text-sm text-muted">{overall.outcomeDetail}</p>
            )}
            {meta.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                {meta.map((part, i) => (
                  <span key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-line" aria-hidden="true">·</span>}
                    <span className={i === 0 ? "font-medium text-ink" : ""}>{part}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {finalScore != null && (
            <div className="w-full shrink-0 sm:w-48">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Final satisfaction
              </div>
              <ScoreMeter score={finalScore} />
            </div>
          )}
        </div>
      </Card>

      {/* PERSONA CARD (issue 9) */}
      <PersonaCardSection card={pc} />

      {/* NEW REPORT SECTION — present only when report.newReport is set */}
      {report.newReport && (
        <Card className="p-6 border-brand-200">
          <CardHeader
            title="New Report Section"
            subtitle="8-parameter evaluation"
          />
          {/* Overall score */}
          <div className="mt-4 flex items-center gap-4">
            <div className="shrink-0">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Overall score
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold tabular-nums text-ink">
                  {report.newReport.total}
                </span>
                <span className="text-2xl font-semibold text-muted">%</span>
              </div>
            </div>
            <div className="flex-1">
              <ScoreMeter score={report.newReport.total} />
            </div>
          </div>
          {/* 8-parameter bars */}
          {Array.isArray(report.newReport.parameters) && report.newReport.parameters.length > 0 && (
            <div className="mt-6 space-y-5">
              {report.newReport.parameters.map((param) => (
                <NewParamBar key={param.key} item={param} />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* OLD REPORT SECTION label — divider before legacy rubric/scoring cards */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted">
          Old Report Section
        </span>
        <div className="flex-1 border-t border-line" />
      </div>

      {/* RUBRIC — hidden from the page (code retained; see SHOW_OLD_RUBRIC_BREAKDOWN) */}
      {SHOW_OLD_RUBRIC_BREAKDOWN && (
      <Card className="p-6">
        <CardHeader title="Rubric breakdown" subtitle="Weighted criteria across the call" />
        {generating ? (
          <div className="space-y-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <div className="mb-2 flex items-center justify-between">
                  <SkeletonLine className="h-3.5 w-2/5" />
                  <SkeletonLine className="h-3.5 w-10" />
                </div>
                <SkeletonLine className="h-2.5 w-full" />
              </div>
            ))}
          </div>
        ) : rubric.length ? (
          <div className="animate-fadeup space-y-5">
            {rubric.map((r) => (
              <RubricBar key={r.key} item={r} />
            ))}
          </div>
        ) : (
          <EmptyState title="No rubric data" hint="This report has no scored criteria." />
        )}
      </Card>
      )}

      {/* PHASE BREAKDOWN */}
      <Card className="p-6">
        <CardHeader title="Phase-by-phase" subtitle="How the conversation progressed" />
        {generating ? (
          <SkeletonBlock rows={5} />
        ) : phaseBreakdown.length ? (
          <div className="animate-fadeup">
            <div className="mb-5">
              <PhaseStepper current={reachedPhase} />
            </div>
            <div className="space-y-5">
              {phaseBreakdown.map((p) => (
                <div
                  key={p.phase}
                  className="rounded-xl border border-line bg-canvas/60 p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-xs font-semibold text-brand-700">
                      {p.phase}
                    </span>
                    <h4 className="text-sm font-semibold text-ink">{p.name}</h4>
                  </div>
                  {p.summary && <p className="mt-2 text-sm text-muted">{p.summary}</p>}
                  <div className="mt-3 space-y-1.5">
                    {p.didWell && (
                      <p className="flex items-start gap-2 text-sm">
                        <Dot color="#10b981" />
                        <span className="text-ink/80">
                          <span className="font-medium text-success">Did well — </span>
                          {p.didWell}
                        </span>
                      </p>
                    )}
                    {p.toImprove && (
                      <p className="flex items-start gap-2 text-sm">
                        <Dot color="#f59e0b" />
                        <span className="text-ink/80">
                          <span className="font-medium text-warn">To improve — </span>
                          {p.toImprove}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="No phase data" hint="Phase-by-phase analysis isn't available." />
        )}
      </Card>

      {/* STRENGTHS / IMPROVEMENTS */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <CardHeader title="Strengths" subtitle="What worked in this call" />
          {generating ? (
            <SkeletonBlock rows={3} />
          ) : strengths.length ? (
            <ul className="animate-fadeup space-y-4">
              {strengths.map((s, i) => (
                <li
                  key={i}
                  className="rounded-xl border-l-2 border-success bg-success-soft/40 px-4 py-3"
                >
                  <p className="text-sm font-medium text-ink">{s.point}</p>
                  {s.quote && (
                    <p className="mt-1.5 text-sm italic text-muted">“{s.quote}”</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No strengths logged" hint="Nothing flagged as a standout here." />
          )}
        </Card>

        <Card className="p-6">
          <CardHeader title="Areas to improve" subtitle="Where to focus next time" />
          {generating ? (
            <SkeletonBlock rows={3} />
          ) : improvements.length ? (
            <ul className="animate-fadeup space-y-4">
              {improvements.map((m, i) => (
                <li
                  key={i}
                  className="rounded-xl border-l-2 border-warn bg-warn-soft/40 px-4 py-3"
                >
                  <p className="text-sm font-medium text-ink">{m.point}</p>
                  {m.quote && (
                    <p className="mt-1.5 text-sm italic text-muted">“{m.quote}”</p>
                  )}
                  {m.suggestion && (
                    <p className="mt-2 text-sm text-ink/80">
                      <span className="font-medium text-warn">Try: </span>
                      {m.suggestion}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing to improve" hint="No improvement notes for this call." />
          )}
        </Card>
      </div>

      {/* KEY MOMENTS */}
      {generating ? (
        <Card className="p-6">
          <CardHeader
            title="Key moments"
            subtitle="Highlight and missed opportunity turns from this call"
          />
          <SkeletonBlock rows={3} />
        </Card>
      ) : Array.isArray(keyMoments) && keyMoments.length > 0 ? (
        <Card className="p-6">
          <CardHeader
            title="Key moments"
            subtitle="Highlight and missed opportunity turns from this call"
          />
          <ul className="animate-fadeup space-y-3">
            {keyMoments.map((km, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl border border-line bg-canvas/60 px-4 py-3"
              >
                <Badge color="slate" className="shrink-0 mt-0.5">
                  Turn {km.turn}
                </Badge>
                <Badge
                  color={km.type === "best" ? "success" : "danger"}
                  className="shrink-0 mt-0.5"
                >
                  {km.type === "best" ? "Highlight" : "Missed"}
                </Badge>
                <p className="text-sm text-ink/80">{km.note}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* BENCHMARKS VS REAL CALLS */}
      {benchmarks && (
        <Card className="p-6">
          <CardHeader
            title="Vs. real calls"
            subtitle="How this session compares to converting counselling calls"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Call length */}
            <div className="rounded-xl border border-line bg-canvas/60 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Call length
              </div>
              <div className="mt-1 text-2xl font-bold text-ink">
                {benchmarks.sessionMinutes != null ? `${benchmarks.sessionMinutes} min` : "—"}
              </div>
              {benchmarks.medianPaidMinutes != null && (
                <div className="mt-1 text-xs text-muted">
                  Converting calls median: {benchmarks.medianPaidMinutes} min
                </div>
              )}
            </div>

            {/* Payment ask */}
            <div className="rounded-xl border border-line bg-canvas/60 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Payment ask
              </div>
              <div className={`mt-1 text-2xl font-bold ${benchmarks.paymentAskSeen ? "text-success" : "text-danger"}`}>
                {benchmarks.paymentAskSeen ? "Made" : "Not made"}
              </div>
              {benchmarks.paymentAskNormPct != null && (
                <div className="mt-1 text-xs text-muted">
                  Present in {benchmarks.paymentAskNormPct}% of converting calls
                </div>
              )}
            </div>

            {/* Outcome */}
            <div className="rounded-xl border border-line bg-canvas/60 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Outcome
              </div>
              <div className={`mt-1 text-2xl font-bold ${overall.outcome === "Converted" ? "text-success" : "text-ink"}`}>
                {overall.outcome || "—"}
              </div>
              {overall.outcomeDetail && (
                <div className="mt-1 text-xs text-muted line-clamp-2">
                  {overall.outcomeDetail}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* PRACTICE DRILLS */}
      {generating ? (
        <Card className="p-6">
          <CardHeader
            title="Practice drills"
            subtitle="Targeted exercises to improve weak areas from this call"
          />
          <SkeletonBlock rows={3} />
        </Card>
      ) : Array.isArray(drills) && drills.length > 0 ? (
        <Card className="p-6">
          <CardHeader
            title="Practice drills"
            subtitle="Targeted exercises to improve weak areas from this call"
          />
          <div className="animate-fadeup space-y-4">
            {drills.map((drill, i) => (
              <div
                key={i}
                className="rounded-xl border border-line bg-canvas/60 p-4"
              >
                <p className="font-semibold text-ink">{drill.title}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {drill.focusCriterion && (
                    <Badge color="brand">{drill.focusCriterion}</Badge>
                  )}
                  {drill.objectionCategory && (
                    <Badge color="slate">{drill.objectionCategory}</Badge>
                  )}
                </div>
                {drill.instruction && (
                  <p className="mt-3 text-sm text-ink/80">{drill.instruction}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* PERSONA CONCERNS ADDRESSED (issue 2) */}
      <PersonaAddressedSection data={pa} generating={generating} />

      {/* INTEGRITY CHECK — admin/superadmin only */}
      {isAdmin && report.integrityCheck && (
        <IntegrityCheckCard check={report.integrityCheck} />
      )}

      {/* SCORE ARC */}
      <Card className="p-6">
        <CardHeader
          title="Satisfaction over the call"
          subtitle="How the student's satisfaction shifted turn by turn"
        />
        {scoreArc.length ? (
          <ScoreArcChart data={scoreArc} />
        ) : (
          <EmptyState title="No score history" hint="The satisfaction arc isn't available." />
        )}
      </Card>

      {/* TRANSCRIPT */}
      <Card className="p-6">
        <CardHeader
          title="Transcript"
          subtitle={
            isAdmin
              ? "Full conversation with phase markers, turn types, and score notes"
              : "Full conversation with phase markers"
          }
        />
        {transcript.length ? (
          <TranscriptView transcript={transcript} showScoreReason={isAdmin} />
        ) : (
          <EmptyState title="No transcript" hint="This session has no recorded turns." />
        )}
      </Card>
    </div>
  );
}
