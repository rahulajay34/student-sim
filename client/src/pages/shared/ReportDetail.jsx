import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { bandColor, formatDate } from "../../lib/format";
import Card, { CardHeader } from "../../ui/Card";
import Badge from "../../ui/Badge";
import Spinner from "../../ui/Spinner";
import EmptyState from "../../ui/EmptyState";
import ScoreMeter from "../../ui/ScoreMeter";
import RubricBar from "./RubricBar";
import ScoreArcChart from "./ScoreArcChart";
import TranscriptView from "./TranscriptView";
import PhaseStepper from "./PhaseStepper";

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

export default function ReportDetail({ backTo = "/app/reports" }) {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
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

  const {
    overall = {},
    rubric = [],
    phaseBreakdown = [],
    strengths = [],
    improvements = [],
    scoreArc = [],
    transcript = [],
    counsellorName,
    personaName,
    scenarioTitle,
    generatedAt,
  } = report;

  const converted = overall.outcome === "Converted";
  const finalScore = scoreArc.length ? scoreArc[scoreArc.length - 1].score : null;
  const reachedPhase = phaseBreakdown.length ? phaseBreakdown[phaseBreakdown.length - 1].phase : 0;

  const meta = [counsellorName, personaName, scenarioTitle, formatDate(generatedAt)].filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink to={backTo} />

      {/* HERO */}
      <Card className="p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-4xl font-bold tabular-nums text-ink">
                {overall.percent ?? 0}
                <span className="text-2xl font-semibold text-muted">%</span>
              </span>
              {overall.band && <Badge color={bandColor(overall.band)}>{overall.band}</Badge>}
              {overall.outcome && (
                <Badge color={converted ? "success" : "slate"}>{overall.outcome}</Badge>
              )}
            </div>
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

      {/* RUBRIC */}
      <Card className="p-6">
        <CardHeader title="Rubric breakdown" subtitle="Weighted criteria across the call" />
        {rubric.length ? (
          <div className="space-y-5">
            {rubric.map((r) => (
              <RubricBar key={r.key} item={r} />
            ))}
          </div>
        ) : (
          <EmptyState title="No rubric data" hint="This report has no scored criteria." />
        )}
      </Card>

      {/* PHASE BREAKDOWN */}
      <Card className="p-6">
        <CardHeader title="Phase-by-phase" subtitle="How the conversation progressed" />
        {phaseBreakdown.length ? (
          <>
            <div className="mb-5">
              <PhaseStepper current={reachedPhase} phases={phaseBreakdown} />
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
          </>
        ) : (
          <EmptyState title="No phase data" hint="Phase-by-phase analysis isn't available." />
        )}
      </Card>

      {/* STRENGTHS / IMPROVEMENTS */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <CardHeader title="Strengths" subtitle="What worked in this call" />
          {strengths.length ? (
            <ul className="space-y-4">
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
          {improvements.length ? (
            <ul className="space-y-4">
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
        <CardHeader title="Transcript" subtitle="Full conversation with phase markers" />
        {transcript.length ? (
          <TranscriptView transcript={transcript} />
        ) : (
          <EmptyState title="No transcript" hint="This session has no recorded turns." />
        )}
      </Card>
    </div>
  );
}
