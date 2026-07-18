'use client';
import type { PanelWithId } from '@/lib/types';
import type { PanelState } from '@/hooks/useDashboard';
import { ChartRenderer } from './charts/ChartRenderer';
import { PanelError } from './PanelError';
import { downloadText, slugify, toCsv } from '@/lib/download';

export function PanelCard({ panel, state, debug }: { panel: PanelWithId; state: PanelState; debug: boolean }) {
  const downloadCsv = () => {
    if (state.status !== 'ready' || !state.columns || !state.rows) return;
    downloadText(`${slugify(panel.title)}.csv`, 'text/csv;charset=utf-8', toCsv(state.columns, state.rows));
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(22,19,14,0.04)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{panel.title}</h2>
          {panel.description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{panel.description}</p>}
        </div>
        {state.status === 'ready' && (
          <button
            type="button"
            onClick={downloadCsv}
            title="Download this panel's data (.csv)"
            aria-label={`Download data for ${panel.title} as CSV`}
            data-no-export
            className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-panel-2 hover:text-brand"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {state.status === 'loading' && (
        <div aria-busy="true" aria-label={`Loading chart: ${panel.title}`} className="space-y-3">
          <div className="h-4 w-1/3 rounded bg-skeleton" style={{ animation: 'pulse-soft 1.2s ease-in-out infinite' }} />
          <div className="h-[220px] w-full rounded-lg bg-skeleton" style={{ animation: 'pulse-soft 1.2s ease-in-out .15s infinite' }} />
        </div>
      )}

      {state.status === 'repairing' && (
        <div aria-busy="true" className="flex h-[220px] flex-col items-center justify-center gap-2.5 font-mono text-sm text-faint">
          <span
            className="inline-block h-4 w-4 rounded-full"
            style={{ border: '2px solid #ead9c9', borderTopColor: '#C9622F', animation: 'spin .7s linear infinite' }}
          />
          <span>Fixing this chart…</span>
        </div>
      )}

      {state.status === 'ready' && (
        <ChartRenderer panel={panel} columns={state.columns!} rows={state.rows!} truncated={!!state.truncated} />
      )}

      {state.status === 'failed' && <PanelError />}

      {debug && (
        <details className="mt-3 rounded-lg border border-line bg-panel-2 p-2 text-xs">
          <summary className="cursor-pointer select-none font-mono font-medium text-muted-2">View SQL</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-muted-2">{state.sql}</pre>
          {state.status === 'failed' && state.error?.debug != null && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[#a23e17]">{String(state.error.debug)}</pre>
          )}
        </details>
      )}
    </div>
  );
}
