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
      </div>
    </div>
  );
}
