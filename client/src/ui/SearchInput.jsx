// Compact search field with a leading magnifier icon and a clear button.
// Controlled: pass `value` + `onChange(nextString)`.
export default function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className = "",
  "aria-label": ariaLabel,
}) {
  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        className="w-full rounded-xl border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </div>
  );
}
