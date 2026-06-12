// Searchable combobox that mirrors the Select prop surface.
// Options: [{ value, label, group? }]. Typing filters by label (case-insensitive).
// Groups: if any option has a `group` field, options are visually grouped.
import { useId, useRef, useState, useEffect, useCallback } from "react";

export default function SearchableSelect({
  label,
  options = [],
  placeholder = "Search…",
  value,
  onChange,
  error,
  className = "",
  id,
}) {
  const autoId = useId();
  const inputId = id || (label ? autoId : undefined);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const containerRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Derive display label for the current value.
  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  // When the dropdown opens, seed the query with the current selection so the
  // user can see what's selected and start refining from there.
  const handleOpen = () => {
    setQuery("");
    setOpen(true);
    setHighlighted(-1);
  };

  const filtered = query.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.trim().toLowerCase())
      )
    : options;

  // Build grouped structure: { [group]: Option[] }
  const hasGroups = filtered.some((o) => o.group);
  const groups = hasGroups
    ? filtered.reduce((acc, o) => {
        const g = o.group || "Other";
        (acc[g] = acc[g] || []).push(o);
        return acc;
      }, {})
    : null;
  const flatFiltered = filtered; // still used for keyboard nav index

  const select = useCallback(
    (opt) => {
      // Emit a synthetic-ish event matching the native <select> onChange shape.
      onChange?.({ target: { value: opt.value } });
      setOpen(false);
      setQuery("");
    },
    [onChange]
  );

  // Close on outside click.
  useEffect(() => {
    function handlePointerDown(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // Scroll highlighted item into view.
  useEffect(() => {
    if (!open || highlighted < 0) return;
    const item = listRef.current?.querySelector(`[data-idx="${highlighted}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleOpen();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0 && flatFiltered[highlighted]) {
        select(flatFiltered[highlighted]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Base input classes mirror Select's input styling.
  const inputCls = [
    "w-full rounded-xl border bg-white px-3.5 py-2.5 pr-9 text-sm text-ink shadow-sm",
    "transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600/30",
    open
      ? "border-brand-600"
      : error
      ? "border-danger focus:border-danger"
      : "border-line focus:border-brand-600",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={containerRef} className="block" style={{ position: "relative" }}>
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      )}

      {/* Input — shows query while open, selected label when closed */}
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          autoComplete="off"
          placeholder={open ? "Type to search…" : placeholder}
          value={open ? query : selectedLabel}
          onFocus={handleOpen}
          onClick={handleOpen}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlighted(-1);
          }}
          onKeyDown={handleKeyDown}
          className={inputCls}
          style={{ cursor: "pointer" }}
        />

        {/* Chevron */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: `translateY(-50%) rotate(${open ? "180deg" : "0deg"})`,
            transition: "transform 150ms",
            width: 16,
            height: 16,
            color: "#8b90a8",
            pointerEvents: "none",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {/* Dropdown list */}
      {open && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            zIndex: 50,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 300,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          {flatFiltered.length === 0 ? (
            <p
              style={{
                padding: "10px 14px",
                fontSize: "0.875rem",
                color: "#6b7280",
                textAlign: "center",
              }}
            >
              No courses found
            </p>
          ) : hasGroups ? (
            Object.entries(groups).map(([groupName, opts]) => (
              <div key={groupName}>
                <p
                  style={{
                    padding: "6px 12px 2px",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    background: "#f9fafb",
                    borderBottom: "1px solid #f3f4f6",
                    position: "sticky",
                    top: 0,
                  }}
                >
                  {groupName}
                </p>
                {opts.map((opt) => {
                  const idx = flatFiltered.indexOf(opt);
                  return (
                    <OptionRow
                      key={opt.value}
                      opt={opt}
                      idx={idx}
                      highlighted={highlighted === idx}
                      selected={opt.value === value}
                      onMouseEnter={() => setHighlighted(idx)}
                      onSelect={select}
                    />
                  );
                })}
              </div>
            ))
          ) : (
            flatFiltered.map((opt, idx) => (
              <OptionRow
                key={opt.value}
                opt={opt}
                idx={idx}
                highlighted={highlighted === idx}
                selected={opt.value === value}
                onMouseEnter={() => setHighlighted(idx)}
                onSelect={select}
              />
            ))
          )}
        </div>
      )}

      {error && (
        <span className="mt-1.5 block text-xs text-danger">{error}</span>
      )}
    </div>
  );
}

function OptionRow({ opt, idx, highlighted, selected, onMouseEnter, onSelect }) {
  return (
    <button
      type="button"
      data-idx={idx}
      onMouseEnter={onMouseEnter}
      onPointerDown={(e) => {
        e.preventDefault(); // prevent input blur before click fires
        onSelect(opt);
      }}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 14px",
        fontSize: "0.875rem",
        cursor: "pointer",
        background: selected
          ? "#eff6ff"
          : highlighted
          ? "#f3f4f6"
          : "transparent",
        color: selected ? "#1d4ed8" : "#111827",
        fontWeight: selected ? 600 : 400,
        border: "none",
        outline: "none",
      }}
    >
      {opt.label}
    </button>
  );
}
