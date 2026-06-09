import { TOKEN_HEX } from "../../lib/format";

// Pure inline-SVG line chart of satisfaction score over conversation turns.
// data = [{ turn, score }] where score is 0..100.
export default function ScoreArcChart({ data = [] }) {
  const points = Array.isArray(data) ? data.filter((d) => d && typeof d.score === "number") : [];

  // Geometry — viewBox space.
  const W = 320;
  const H = 120;
  const PAD_X = 14;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 18;
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_TOP - PAD_BOTTOM;

  // Map a 0..100 score to an inverted y coordinate.
  const yOf = (score) => PAD_TOP + (1 - Math.max(0, Math.min(100, score)) / 100) * plotH;
  // Map a series index to an x coordinate spread across the plot width.
  const xOf = (i) => PAD_X + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);

  const thresholdY = yOf(70);

  if (points.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line bg-canvas/60">
        <span className="text-sm text-muted">Not enough data</span>
      </div>
    );
  }

  const coords = points.map((d, i) => ({ x: xOf(i), y: yOf(d.score), score: d.score, turn: d.turn }));
  const linePath = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPath =
    `M ${coords[0].x.toFixed(1)} ${(H - PAD_BOTTOM).toFixed(1)} ` +
    coords.map((c) => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ") +
    ` L ${coords[coords.length - 1].x.toFixed(1)} ${(H - PAD_BOTTOM).toFixed(1)} Z`;

  const brand = TOKEN_HEX.brand;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Score over time">
        <defs>
          <linearGradient id="scorearc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={brand} stopOpacity="0.16" />
            <stop offset="100%" stopColor={brand} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Baseline gridline at score 0 */}
        <line
          x1={PAD_X}
          y1={(H - PAD_BOTTOM).toFixed(1)}
          x2={W - PAD_X}
          y2={(H - PAD_BOTTOM).toFixed(1)}
          stroke="#E8EAED"
          strokeWidth="1"
        />

        {/* Mid gridline at score 50 */}
        <line
          x1={PAD_X}
          y1={yOf(50).toFixed(1)}
          x2={W - PAD_X}
          y2={yOf(50).toFixed(1)}
          stroke="#E8EAED"
          strokeWidth="1"
        />

        {/* Dashed threshold line at score 70 */}
        <line
          x1={PAD_X}
          y1={thresholdY.toFixed(1)}
          x2={W - PAD_X}
          y2={thresholdY.toFixed(1)}
          stroke={TOKEN_HEX.success}
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.7"
        />
        <text
          x={W - PAD_X}
          y={(thresholdY - 4).toFixed(1)}
          textAnchor="end"
          fontSize="9"
          fill={TOKEN_HEX.success}
          fontWeight="600"
        >
          70
        </text>

        {/* Soft area fill under the line */}
        <path d={areaPath} fill="url(#scorearc-fill)" />

        {/* Score polyline */}
        <polyline
          points={linePath}
          fill="none"
          stroke={brand}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Point markers */}
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x.toFixed(1)}
            cy={c.y.toFixed(1)}
            r="2.6"
            fill="#FFFFFF"
            stroke={brand}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
