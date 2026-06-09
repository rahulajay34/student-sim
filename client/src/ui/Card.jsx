// Card — the foundational surface for the app.
// Monexa-inspired: white surface, rounded-2xl, thin border-line, soft shadow.
// NO built-in padding: callers always pass it via className (e.g. "p-5" / "p-6").

export default function Card({ className = "", children, ...rest }) {
  return (
    <div
      className={`bg-white rounded-2xl border border-line shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

// CardHeader — consistent header row for a card section.
// Left block: title (semibold, ink) + optional subtitle (muted). `action` floats right.
export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
