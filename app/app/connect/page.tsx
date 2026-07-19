'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/app/AppHeader';

interface ConnectionResult {
  id: string;
  name: string;
  databaseName: string;
  summary: string;
  stats: {
    tableCount: number;
    totalApproxRows: number;
    tables: { name: string; approxRows: number }[];
    dateRanges: { column: string; from: string; to: string }[];
  };
}

type Phase = 'form' | 'working' | 'done';

// One request does the whole onboarding server-side; these labels rotate to
// describe the stages honestly without pretending to track real progress.
const WORKING_LABELS = [
  'Connecting to your database…',
  'Creating a read-only role (we never get write access)…',
  'Reading your tables and columns…',
  'Double-checking the connection is read-only…',
  'Writing up what we found…',
];

export default function ConnectPage() {
  const [phase, setPhase] = useState<Phase>('form');
  const [name, setName] = useState('');
  const [adminUrl, setAdminUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [labelIndex, setLabelIndex] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !adminUrl.trim()) return;
    setPhase('working');
    setError(null);
    setLabelIndex(0);
    const ticker = setInterval(() => {
      setLabelIndex((i) => Math.min(i + 1, WORKING_LABELS.length - 1));
    }, 4000);
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), adminUrl: adminUrl.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.connection) {
        throw new Error(body?.error?.friendlyMessage ?? 'Something went wrong while connecting.');
      }
      setResult(body.connection as ConnectionResult);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong while connecting.');
      setPhase('form');
    } finally {
      clearInterval(ticker);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-2xl px-4 pt-16 pb-20">
        {phase !== 'done' && (
          <>
            <div className="font-mono text-xs font-semibold uppercase tracking-[.16em] text-brand">
              Connect a database
            </div>
            <h1 className="mt-4 font-serif text-4xl font-medium leading-[1.06] tracking-[-.015em] text-ink">
              Point it at your data, <em className="text-brand">once.</em>
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-muted">
              Paste the connection details your database provider gave you. We use them a single
              time to set up a <strong className="font-semibold text-ink">read-only</strong> view of
              your data — they are never stored, and nothing in your database is changed except
              adding that read-only access.
            </p>

            <form onSubmit={submit} className="mt-9 flex flex-col gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-ink">What should we call it?</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Shop data, Production, Acme Postgres"
                  maxLength={60}
                  disabled={phase === 'working'}
                  className="rounded-xl border border-line-strong bg-white px-4 py-3 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-ink">Connection string</span>
                <input
                  type="password"
                  value={adminUrl}
                  onChange={(e) => setAdminUrl(e.target.value)}
                  placeholder="postgresql://user:password@host:5432/database"
                  disabled={phase === 'working'}
                  className="rounded-xl border border-line-strong bg-white px-4 py-3 font-mono text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
                />
                <span className="text-xs leading-relaxed text-faint">
                  Use an admin/owner user — it&apos;s needed once, to create the read-only role.
                  Your dashboards then only ever use that read-only role.
                </span>
              </label>

              {error && (
                <div className="rounded-xl border border-warm/30 bg-warm-tint px-4 py-3 text-sm text-ink">
                  {error}
                </div>
              )}

              {phase === 'working' ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2.5 font-mono text-sm text-faint"
                >
                  <span
                    className="inline-block h-3.5 w-3.5 rounded-full"
                    style={{ border: '2px solid #d8d0c2', borderTopColor: '#1D5C4A', animation: 'spin .7s linear infinite' }}
                  />
                  {WORKING_LABELS[labelIndex]}
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={!name.trim() || !adminUrl.trim()}
                  className="inline-flex w-fit items-center gap-2 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Connect my database
                </button>
              )}
            </form>
          </>
        )}

        {phase === 'done' && result && (
          <div>
            <div className="flex items-center gap-2.5 font-mono text-xs font-semibold uppercase tracking-[.16em] text-brand">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-brand">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M4.5 12.5l5 5 10-11" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Connected
            </div>
            <h1 className="mt-4 font-serif text-4xl font-medium leading-[1.06] tracking-[-.015em] text-ink">
              {result.name} is ready.
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">{result.summary}</p>

            <div className="mt-7 flex flex-wrap gap-2.5">
              <span className="rounded-lg border border-line bg-white px-3.5 py-2 font-mono text-xs text-muted">
                {result.stats.tableCount} tables
              </span>
              <span className="rounded-lg border border-line bg-white px-3.5 py-2 font-mono text-xs text-muted">
                ~{result.stats.totalApproxRows.toLocaleString()} rows
              </span>
              {result.stats.dateRanges[0] && (
                <span className="rounded-lg border border-line bg-white px-3.5 py-2 font-mono text-xs text-muted">
                  {result.stats.dateRanges[0].from.slice(0, 10)} → {result.stats.dateRanges[0].to.slice(0, 10)}
                </span>
              )}
              <span className="rounded-lg border border-line bg-white px-3.5 py-2 font-mono text-xs text-brand">
                read-only ✓
              </span>
            </div>

            <div className="mt-9 flex items-center gap-4">
              <Link
                href={`/app?c=${result.id}`}
                className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
              >
                Ask your first question
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14m-6-6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setPhase('form');
                  setName('');
                  setAdminUrl('');
                  setResult(null);
                }}
                className="text-sm font-semibold text-muted transition-colors hover:text-brand"
              >
                Connect another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
