'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app/AppHeader';

interface DashboardListItem {
  id: string;
  title: string;
  summary: string;
  connectionId: string | null;
  panelCount: number;
  updatedAt: string;
}

interface ConnectionListItem {
  id: string;
  name: string;
}

interface AdviceSuggestion {
  title: string;
  ddl: string | null;
  rationale: string;
}

interface AdvisorReport {
  totalRuns: number;
  timeouts: number;
  avgDurationMs: number;
  suggestions: AdviceSuggestion[];
  source: 'llm' | 'fallback' | 'none';
}

// Per-connection performance card: read-only suggestions computed from local
// query telemetry. The DDL shown is for the USER to run as an admin — the
// app never executes it.
function PerformanceCard({ connection }: { connection: ConnectionListItem }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [report, setReport] = useState<AdvisorReport | null>(null);

  const load = async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/connections/${connection.id}/advice`);
      const body = await res.json();
      if (!res.ok || !body?.advice) throw new Error();
      setReport(body.advice as AdvisorReport);
      setState('idle');
    } catch {
      setState('error');
    }
  };

  return (
    <li className="rounded-xl border border-line bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{connection.name}</div>
          {report && report.source !== 'none' && (
            <div className="mt-0.5 font-mono text-[11px] text-faint">
              {report.totalRuns} recent queries · {report.timeouts} timed out · avg{' '}
              {Math.round(report.avgDurationMs)} ms
            </div>
          )}
        </div>
        {!report && (
          <button
            type="button"
            onClick={load}
            disabled={state === 'loading'}
            className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
          >
            {state === 'loading' ? 'Analyzing…' : 'Performance advice'}
          </button>
        )}
      </div>
      {state === 'error' && (
        <p className="mt-2 text-xs text-warm">Couldn’t build advice right now — try again in a moment.</p>
      )}
      {report && report.source === 'none' && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Not enough query history yet. Build a few dashboards against this connection first.
        </p>
      )}
      {report && report.suggestions.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {report.suggestions.map((s, i) => (
            <li key={i} className="rounded-lg border border-line bg-panel-2 p-3">
              <div className="text-xs font-semibold text-ink">{s.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{s.rationale}</p>
              {s.ddl && (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-white p-2 font-mono text-[11px] text-muted-2">
                  {s.ddl}
                </pre>
              )}
            </li>
          ))}
          <li className="text-[11px] leading-snug text-faint">
            Run these yourself as a database admin — this app never modifies your database.
          </li>
        </ul>
      )}
      {report && report.source !== 'none' && report.suggestions.length === 0 && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Nothing to suggest — recent queries against this connection are running fine.
        </p>
      )}
    </li>
  );
}

export default function SavedDashboardsPage() {
  const [dashboards, setDashboards] = useState<DashboardListItem[] | null>(null);
  const [connections, setConnections] = useState<ConnectionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/dashboards').then((r) => r.json()),
      fetch('/api/connections').then((r) => r.json()),
    ])
      .then(([d, c]) => {
        setDashboards(d.dashboards ?? []);
        setConnections(c.connections ?? []);
      })
      .catch(() => setError('Could not load your saved dashboards. Please try again.'));
  }, []);

  const remove = async (id: string) => {
    setDashboards((list) => (list ?? []).filter((d) => d.id !== id));
    await fetch(`/api/dashboards/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const connectionName = (id: string | null) =>
    id === null ? 'Built-in connection' : connections.find((c) => c.id === id)?.name ?? 'Deleted connection';

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-3xl px-4 pt-14 pb-20">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="font-mono text-xs font-semibold uppercase tracking-[.16em] text-brand">
              Saved dashboards
            </div>
            <h1 className="mt-3 font-serif text-3xl font-medium tracking-[-.015em] text-ink">
              Pick up where you left off.
            </h1>
          </div>
          <Link
            href="/app"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            New dashboard
          </Link>
        </div>

        {error && (
          <div className="mt-8 rounded-xl border border-warm/30 bg-warm-tint px-4 py-3 text-sm text-ink">
            {error}
          </div>
        )}

        {dashboards === null && !error && (
          <div className="mt-10 flex items-center gap-2.5 font-mono text-sm text-faint">
            <span
              className="inline-block h-3.5 w-3.5 rounded-full"
              style={{ border: '2px solid #d8d0c2', borderTopColor: '#1D5C4A', animation: 'spin .7s linear infinite' }}
            />
            Loading…
          </div>
        )}

        {dashboards !== null && dashboards.length === 0 && (
          <p className="mt-10 max-w-md text-base leading-relaxed text-muted">
            Nothing saved yet. Build a dashboard, then use the Save button to keep it here for next
            time.
          </p>
        )}

        {dashboards !== null && dashboards.length > 0 && (
          <ul className="mt-8 flex flex-col gap-3">
            {dashboards.map((d) => (
              <li
                key={d.id}
                className="group flex items-center justify-between gap-4 rounded-xl border border-line bg-white px-5 py-4 transition-colors hover:border-brand"
              >
                <Link href={`/app?d=${d.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-serif text-lg font-medium text-ink group-hover:text-brand">
                    {d.title}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
                    <span>{connectionName(d.connectionId)}</span>
                    <span>·</span>
                    <span>{d.panelCount} {d.panelCount === 1 ? 'panel' : 'panels'}</span>
                    <span>·</span>
                    <span>updated {new Date(d.updatedAt).toLocaleDateString()}</span>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  aria-label={`Delete ${d.title}`}
                  className="shrink-0 rounded-lg border border-transparent px-3 py-1.5 text-xs font-semibold text-faint transition-colors hover:border-warm/40 hover:text-warm"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        {connections.length > 0 && (
          <div className="mt-12">
            <div className="font-mono text-xs font-semibold uppercase tracking-[.16em] text-brand">
              Connection performance
            </div>
            <ul className="mt-4 flex flex-col gap-3">
              {connections.map((c) => (
                <PerformanceCard key={c.id} connection={c} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
