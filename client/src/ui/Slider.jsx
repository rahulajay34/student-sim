// A compact labelled 1–5 range slider used for the per-mock student-tuning
// controls (how pushy / how hesitant the student is). Controlled component:
// `value` is a number, `onChange` receives the new number.
export default function Slider({
  label,
  value,
  onChange,
  min = 1,
  max = 5,
  lowLabel,
  highLabel,
  hint,
  id,
}) {
  const sliderId = id || `slider-${(label || "").replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={sliderId} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {value}/{max}
        </span>
      </div>
      <input
        id={sliderId}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand-600"
      />
      {(lowLabel || highLabel) && (
        <div className="flex justify-between text-[0.7rem] text-muted">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
