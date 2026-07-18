'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { DashboardSpecWithIds } from '@/lib/types';
import type { PanelState } from '@/hooks/useDashboard';
import { dashboardToJson, downloadDataUrl, downloadText, slugify } from '@/lib/download';

// Dashboard-level "Download" dropdown: PNG snapshot of the rendered dashboard
// and a JSON export of the spec + every panel's data. Per-panel CSVs live on
// the panel cards themselves.
export function DownloadMenu({
  spec, question, panels, captureRef, disabled,
}: {
  spec: DashboardSpecWithIds;
  question: string;
  panels: Record<string, PanelState>;
  captureRef: RefObject<HTMLDivElement | null>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const downloadPng = async () => {
    const node = captureRef.current;
    if (!node || exporting) return;
    setExporting(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(node, {
        backgroundColor: '#f4f1ea', // page cream, so the capture isn't transparent
        pixelRatio: 2,
        // Buttons and menus are marked data-no-export — keep them out of the image.
        filter: (el) => !(el instanceof HTMLElement && el.dataset.noExport !== undefined),
      });
      downloadDataUrl(`${slugify(spec.title)}.png`, dataUrl);
    } catch {
      // Font/CSS embedding can fail in exotic setups; fall back silently —
      // the menu simply closes and the user still has CSV/JSON.
    } finally {
      setExporting(false);
      setOpen(false);
    }
  };

  const downloadJson = () => {
    downloadText(`${slugify(spec.title)}.json`, 'application/json', dashboardToJson(question, spec, panels));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative" data-no-export>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Download
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-[0_16px_40px_-16px_rgba(22,19,14,0.35)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={downloadPng}
            disabled={exporting}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink transition-colors hover:bg-panel-2 disabled:opacity-60"
          >
            {exporting ? (
              <span
                className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ border: '2px solid #d8d0c2', borderTopColor: '#1D5C4A', animation: 'spin .7s linear infinite' }}
              />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-muted-2">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M3 15l4.5-4.5 3.5 3.5 4-5L21 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span>
              {exporting ? 'Preparing image…' : 'Image (.png)'}
              {!exporting && <span className="block text-xs text-faint">The whole dashboard as a picture</span>}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={downloadJson}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink transition-colors hover:bg-panel-2"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-muted-2">
              <path d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h2M16 4h2a2 2 0 012 2v12a2 2 0 01-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>
              Data (.json)
              <span className="block text-xs text-faint">Spec, queries, and results</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
