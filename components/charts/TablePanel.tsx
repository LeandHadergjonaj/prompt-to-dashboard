'use client';
import { formatCountFull } from '@/lib/format';
import type { ColumnMeta } from '@/lib/types';

export function TablePanel({ columns, rows, truncated }: { columns: ColumnMeta[]; rows: unknown[][]; truncated: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-panel-2 text-left font-mono text-[11px] font-medium uppercase tracking-[.06em] text-faint">
          <tr>
            {columns.map((c) => (
              <th key={c.name} className="whitespace-nowrap px-4 py-2.5">{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((row, i) => (
            <tr key={i} className="transition-colors hover:bg-panel-2/60">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`whitespace-nowrap px-4 py-2.5 text-ink ${typeof cell === 'number' ? 'text-right tabular-nums' : 'text-left'}`}
                >
                  {cell === null || cell === undefined ? '—' : typeof cell === 'number' ? formatCountFull(cell) : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <div className="border-t border-line px-4 py-2 font-mono text-[11px]" style={{ background: '#F3E4D6', color: '#a23e17' }}>
          Showing a partial result — there’s more data than fits here.
        </div>
      )}
    </div>
  );
}
