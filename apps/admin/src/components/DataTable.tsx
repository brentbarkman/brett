import React from "react";

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
  loading?: boolean;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No data",
  loading,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="mb-3 h-8 animate-pulse rounded bg-white/5" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-widest text-white/35 font-semibold ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-white/30">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(item)}
                className={`border-b border-white/[0.04] last:border-0 ${
                  onRowClick ? "cursor-pointer hover:bg-white/[0.03]" : ""
                } transition-colors`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-2.5 text-white/70 ${col.className ?? ""}`}>
                    {col.render ? col.render(item) : String(item[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
