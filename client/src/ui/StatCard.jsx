import Card from "./Card";

// Compact metric card: optional icon tile + value/label/hint column.
// icon is a React node (e.g. inline svg) provided by the caller.
export default function StatCard({ label, value, hint, icon }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        {icon != null && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-tight text-ink">{value}</div>
          <div className="mt-0.5 text-sm text-muted">{label}</div>
          {hint != null && <div className="mt-1 text-xs text-muted/70">{hint}</div>}
        </div>
      </div>
    </Card>
  );
}
