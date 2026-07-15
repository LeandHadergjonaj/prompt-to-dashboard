'use client';
import type { PanelWithId } from '@/lib/types';
import type { PanelState } from '@/hooks/useDashboard';
import { ChartRenderer } from './charts/ChartRenderer';
import { PanelError } from './PanelError';

export function PanelCard({ panel, state, debug }: { panel: PanelWithId; state: PanelState; debug: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[#0b0b0b]">{panel.title}</h2>
        {panel.description && <p className="mt-0.5 text-xs text-[#52514e]">{panel.description}</p>}
      </div>

      {state.status === 'loading' && (
        <div aria-busy="true" aria-label={`Loading chart: ${panel.title}`} className="animate-pulse space-y-3">
          <div className="h-4 w-1/3 rounded bg-gray-200" />
          <div className="h-[220px] w-full rounded-lg bg-gray-100" />
        </div>
      )}

      {state.status === 'repairing' && (
        <div aria-busy="true" className="flex h-[220px] flex-col items-center justify-center gap-2 text-sm text-[#52514e]">
          <svg className="h-5 w-5 animate-spin text-[#eda100]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span>Fixing this chart…</span>
        </div>
      )}

      {state.status === 'ready' && (
        <ChartRenderer panel={panel} columns={state.columns!} rows={state.rows!} truncated={!!state.truncated} />
      )}

      {state.status === 'failed' && <PanelError />}

      {debug && (
        <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
          <summary className="cursor-pointer select-none font-medium text-gray-600">View SQL</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-gray-700">{state.sql}</pre>
          {state.status === 'failed' && state.error?.debug != null && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-red-700">{String(state.error.debug)}</pre>
          )}
        </details>
      )}
    </div>
  );
}
