import { rubricColor, TOKEN_HEX } from "../../lib/format";

// One rubric criterion row: label + weight, level + score, a colored progress bar,
// and the justification beneath. Purely presentational; data comes from `item`.
export default function RubricBar({ item }) {
  if (!item) return null;

  const { label, weight, score, level, justification } = item;
  const color = rubricColor(score);
  const hex = TOKEN_HEX[color];
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-ink">{label}</span>
          {weight != null && (
            <span className="text-xs text-muted">weight {weight}%</span>
          )}
        </div>
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          {level && (
            <span className="text-xs font-medium" style={{ color: hex }}>
              {level}
            </span>
          )}
          <span className="text-sm font-semibold tabular-nums" style={{ color: hex }}>
            {score}/5
          </span>
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: hex }}
        />
      </div>

      {justification && (
        <p className="text-sm text-muted">{justification}</p>
      )}
    </div>
  );
}
