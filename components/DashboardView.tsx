'use client';
import { useRef } from 'react';
import type { DashboardSpecWithIds } from '@/lib/types';
import type { PanelState } from '@/hooks/useDashboard';
import { PanelCard } from './PanelCard';
import { DownloadMenu } from './DownloadMenu';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function DashboardView({
  spec, question, panels, debug, onStartOver, onSave, saveStatus = 'idle',
  panelSourceLabels, onNarrowPanel,
}: {
  spec: DashboardSpecWithIds;
  question: string;
  panels: Record<string, PanelState>;
  debug: boolean;
  onStartOver: () => void;
  onSave?: () => void;
  saveStatus?: SaveStatus;
  /** Panel id -> connection name; provided only when the dashboard mixes sources. */
  panelSourceLabels?: Record<string, string>;
  onNarrowPanel?: (panel: DashboardSpecWithIds['panels'][number]) => void;
}) {
  // PNG capture target: header + grid, minus anything marked data-no-export.
  const captureRef = useRef<HTMLDivElement>(null);
  const allSettled = spec.panels.every((p) => {
    const s = panels[p.id];
    return s && (s.status === 'ready' || s.status === 'failed');
  });

  return (
    <div ref={captureRef}>
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[.12em] text-faint">
            Your question · “{question}”
          </p>
          <h1 className="mt-2 font-serif text-3xl font-medium tracking-[-.015em] text-ink">{spec.title}</h1>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted">{spec.summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5" data-no-export>
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={!allSettled || saveStatus === 'saving' || saveStatus === 'saved'}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Retry save' : 'Save'}
            </button>
          )}
          <DownloadMenu
            spec={spec}
            question={question}
            panels={panels}
            captureRef={captureRef}
            disabled={!allSettled}
          />
          <button
            type="button"
            onClick={onStartOver}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
          >
            Start over
          </button>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {spec.panels.map((panel) => {
          const spanClass =
            panel.chartType === 'table' ? 'md:col-span-4' : panel.chartType === 'stat' ? 'md:col-span-1' : 'md:col-span-2';
          return (
            <div key={panel.id} className={spanClass}>
              <PanelCard
                panel={panel}
                state={panels[panel.id]}
                debug={debug}
                sourceLabel={panelSourceLabels?.[panel.id]}
                onNarrow={onNarrowPanel ? () => onNarrowPanel(panel) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
