// Small pill label used across the app for statuses, categories, and tags.
// Color tokens map to the soft-accent palette defined in the design system.

const COLORS = {
  brand: "bg-brand-50 text-brand-700",
  success: "bg-success-soft text-success",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  slate: "bg-canvas text-muted",
};

export default function Badge({ color = "brand", children, className = "" }) {
  const tone = COLORS[color] || COLORS.brand;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone} ${className}`}
    >
      {children}
    </span>
  );
}
