// Styled <select> with an optional label, mirroring the Input field look.
// Options: [{ value, label }]. Optional placeholder renders as a disabled first option.
import { useId } from "react";

export default function Select({ label, options = [], placeholder, className = "", id, error, ...props }) {
  // useId, not label-derived: two same-labelled Selects on one page produced
  // duplicate DOM ids.
  const autoId = useId();
  const selectId = id || (label ? autoId : undefined);

  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      )}

      <div className="relative">
        <select
          id={selectId}
          className={`w-full cursor-pointer appearance-none rounded-xl border bg-white px-3.5 py-2.5 pr-9 text-sm text-ink shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600/30 disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted ${
            error
              ? "border-danger focus:border-danger"
              : "border-line focus:border-brand-600"
          } ${className}`}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Chevron */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {error && <span className="mt-1.5 block text-xs text-danger">{error}</span>}
    </label>
  );
}
