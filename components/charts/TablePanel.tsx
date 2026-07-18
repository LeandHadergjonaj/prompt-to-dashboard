'use client';
import { formatCountFull } from '@/lib/format';
import type { ColumnMeta } from '@/lib/types';

export function TablePanel({ columns, rows, truncated }: { columns: ColumnMeta[]; rows: unknown[][]; truncated: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={c.name} className="px-4 py-2 whitespace-nowrap">{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {row.map((cell, j) => (
                <td key={j} className={`px-4 py-2 whitespace-nowrap ${typeof cell === 'number' ? 'tabular-nums text-right' : 'text-left'}`}>
                  {cell === null || cell === undefined ? '—' : typeof cell === 'number' ? formatCountFull(cell) : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <div className="border-t border-gray-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Showing a partial result — there's more data than fits here.
        </div>
      )}
    </div>
  );
}
