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

