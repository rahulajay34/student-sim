import { useCountUp } from "../lib/format";

// Renders a number that counts up from 0 to `value` on mount. Pass a `format`
// fn to wrap the rounded number (e.g. n => `${n}%`). Non-numeric values render
// as-is (e.g. an em dash) without animating.
export default function CountUp({ value, duration = 500, decimals = 0, format, className }) {
  const animated = useCountUp(value, duration);
  if (typeof animated !== "number" || !Number.isFinite(animated)) {
    return <span className={className}>{value}</span>;
  }
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(animated * factor) / factor;
  const display = format ? format(rounded) : rounded;
  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {display}
    </span>
  );
}
