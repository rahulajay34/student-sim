// Presentational data table. Receives columns + rows; renders a clean, airy
// Monexa-style table. Each column: { key, header, render?(row), className? }.
// If onRowClick is provided, rows become interactive (hover + pointer).

export default function Table({ columns = [], rows = [], onRowClick }) {
  const clickable = typeof onRowClick === "function";

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`text-left text-xs font-medium uppercase tracking-wide text-muted px-4 py-3 ${col.className || ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
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
  );
}
