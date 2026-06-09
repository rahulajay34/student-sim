export default function Textarea({ label, error, rows = 4, className = "", ...props }) {
  const base =
    "w-full resize-y min-h-[6rem] rounded-xl border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted shadow-sm transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted";
  const state = error
    ? "border-danger focus:border-danger focus:ring-danger/20"
    : "border-line focus:border-brand-600 focus:ring-brand-600/20";

  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      )}
      <textarea
        rows={rows}
        className={`${base} ${state} ${className}`}
        {...props}
      />
      {error && <span className="mt-1.5 block text-xs text-danger">{error}</span>}
    </label>
  );
}
