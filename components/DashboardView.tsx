'use client';
import type { DashboardSpecWithIds } from '@/lib/types';
import type { PanelState } from '@/hooks/useDashboard';
import { PanelCard } from './PanelCard';

export function DashboardView({
  spec, question, panels, debug, onAskSomethingElse,
}: { spec: DashboardSpecWithIds; question: string; panels: Record<string, PanelState>; debug: boolean; onAskSomethingElse: () => void }) {
  return (
    <div>
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-[#52514e]">Your question: "{question}"</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#0b0b0b]">{spec.title}</h1>
          <p className="mt-1 text-base text-[#52514e]">{spec.summary}</p>
        </div>
        <button type="button" onClick={onAskSomethingElse} className="whitespace-nowrap text-sm font-medium text-[#2a78d6] hover:underline">
          Ask something else
        </button>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {spec.panels.map((panel) => {
          const spanClass =
            panel.chartType === 'table' ? 'md:col-span-4' : panel.chartType === 'stat' ? 'md:col-span-1' : 'md:col-span-2';
          return (
            <div key={panel.id} className={spanClass}>
              <PanelCard panel={panel} state={panels[panel.id]} debug={debug} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
