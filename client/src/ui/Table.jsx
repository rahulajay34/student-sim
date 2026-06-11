import { useMemo, useState } from "react";

// Presentational data table. Receives columns + rows; renders a clean, airy
// table. Each column: { key, header, render?(row), className?, sortable?, sortValue?(row) }.
// If onRowClick is provided, rows become interactive (hover + pointer).
//
// Opt-in extras (fully backwards-compatible — omit them for the plain table):
//   - Mark a column `sortable: true` to enable click-to-sort with aria-sort +
//     chevron indicators. Provide `sortValue(row)` when the raw cell value isn't
//     directly comparable (e.g. a rendered node); otherwise `row[key]` is used.
//   - Pass a `toolbar` node (e.g. a search box) to render an aligned header slot.

function SortIcon({ dir }) {
  // dir: "asc" | "desc" | null
  return (
    <span className="ml-1 inline-flex flex-col leading-none align-middle" aria-hidden="true">
      <svg
        viewBox="0 0 12 8"
        className={`h-1.5 w-2.5 ${dir === "asc" ? "text-brand-600" : "text-line"}`}
        fill="currentColor"
      >
        <path d="M6 0l6 8H0z" />
      </svg>
      <svg
        viewBox="0 0 12 8"
        className={`h-1.5 w-2.5 ${dir === "desc" ? "text-brand-600" : "text-line"}`}
        fill="currentColor"
      >
        <path d="M6 8L0 0h12z" />
      </svg>
    </span>
  );
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export default function Table({ columns = [], rows = [], onRowClick, toolbar }) {
  const clickable = typeof onRowClick === "function";
  const [sort, setSort] = useState(null); // { key, dir }

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const valueOf = col.sortValue || ((row) => row[col.key]);
    const factor = sort.dir === "desc" ? -1 : 1;
    return [...rows].sort((ra, rb) => compareValues(valueOf(ra), valueOf(rb)) * factor);
  }, [rows, sort, columns]);

  function toggleSort(key) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears the sort
    });
  }

  return (
    <div className="w-full">
      {toolbar && <div className="px-4 pt-3 pb-1">{toolbar}</div>}
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map((col) => {
                const isSorted = sort?.key === col.key;
                const ariaSort = !col.sortable
                  ? undefined
                  : isSorted
                  ? sort.dir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none";
                return (
                  <th
                    key={col.key}
                    aria-sort={ariaSort}
                    className={`text-left text-xs font-medium uppercase tracking-wide text-muted px-4 py-3 ${col.className || ""}`}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className="-mx-1 inline-flex items-center rounded px-1 py-0.5 uppercase tracking-wide transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                      >
                        {col.header}
                        <SortIcon dir={isSorted ? sort.dir : null} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr
                key={row.id ?? i}
                onClick={clickable ? () => onRowClick(row) : undefined}
                className={`border-t border-line ${
                  clickable ? "cursor-pointer transition-colors hover:bg-canvas" : ""
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-sm text-ink align-middle ${col.className || ""}`}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
