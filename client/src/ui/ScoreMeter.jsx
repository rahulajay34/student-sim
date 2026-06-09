import { scoreColor, TOKEN_HEX } from "../lib/format";

// Horizontal 0-100 satisfaction meter. Fill width + color track the score via
// scoreColor() and TOKEN_HEX (inline because the hue is data-driven).
export default function ScoreMeter({ score = 0, showValue = true, className = "" }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const hex = TOKEN_HEX[scoreColor(pct)];

  return (
    <div className={`w-full ${className}`}>
      {showValue && (
        <div className="mb-1.5 flex items-center justify-end">
          <span className="text-sm font-semibold tabular-nums" style={{ color: hex }}>
            {pct}
          </span>
        </div>
      )}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, background: hex }}
        />
      </div>
    </div>
  );
}
