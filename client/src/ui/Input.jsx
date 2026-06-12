import { useId } from "react";

export default function Input({ label, error, className = "", id, ...inputProps }) {
  // A label without an id rendered <label for="undefined"> — unlinked for both
  // click-to-focus and screen readers. Generate a stable one when needed.
  const autoId = useId();
  const inputId = id || (label ? autoId : undefined);
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink mb-1.5">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${
          error ? "border-danger" : "border-line"
        }`}
        {...inputProps}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
