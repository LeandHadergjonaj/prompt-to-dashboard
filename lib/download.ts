'use client';
import type { ColumnMeta, DashboardSpecWithIds } from './types';
import type { PanelState } from '@/hooks/useDashboard';

// Client-side export helpers for the download feature. Everything here works
// on data the browser already has — no extra server round-trips.

export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'dashboard';
}

// RFC 4180 CSV with a UTF-8 BOM so Excel opens it with correct encoding.
export function toCsv(columns: ColumnMeta[], rows: unknown[][]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => escape(c.name)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((_, i) => escape(row[i])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

// Full dashboard export: the spec plus every panel's data (or its error).
export function dashboardToJson(
  question: string,
  spec: DashboardSpecWithIds,
  panels: Record<string, PanelState>
): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      question,
      title: spec.title,
      summary: spec.summary,
      panels: spec.panels.map((p) => {
        const state = panels[p.id];
        return {
          title: p.title,
          description: p.description,
          chartType: p.chartType,
          unit: p.unit,
          sql: state?.sql ?? p.sql,
          data:
            state?.status === 'ready'
              ? { columns: state.columns, rows: state.rows, truncated: state.truncated ?? false }
              : null,
        };
      }),
    },
    null,
    2
  );
}

export function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(filename, url);
  // Delay revocation so the click has consumed the URL in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  triggerDownload(filename, dataUrl);
}

function triggerDownload(filename: string, href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
