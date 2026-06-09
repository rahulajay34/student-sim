// Centered placeholder shown when a list/section has no data yet.
// Purely presentational — callers pass title, hint, an optional action node, and an optional icon.
export default function EmptyState({ title, hint, action, icon }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas text-muted">
          {icon}
        </div>
      )}
      {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
