'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useDashboard } from '@/hooks/useDashboard';
import { AppHeader } from '@/components/app/AppHeader';
import { PromptBar } from '@/components/PromptBar';
import { ExampleChips } from '@/components/ExampleChips';
import { DashboardView, type SaveStatus } from '@/components/DashboardView';

const EXAMPLES = [
  'Give me an overview dashboard of this database',
  'What are the biggest categories by total value?',
  'Show me activity over the last 12 months',
  'Which records were added most recently?',
];

interface ConnectionListItem {
  id: string;
  name: string;
}

// 'env' = the app's built-in env-configured connection (connectionId null on
// the wire); anything else is a user-onboarded connection id.
type SelectedConnection = string | null;

export default function AppPage() {
  const {
    phase, question, spec, panels, dashboardError,
    submit, reset, retry, setConnectionId, save, loadSaved,
  } = useDashboard();
  const [debug, setDebug] = useState(false);
  const [connections, setConnections] = useState<ConnectionListItem[] | null>(null);
  const [envConnection, setEnvConnection] = useState(false);
  const [selected, setSelected] = useState<SelectedConnection>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const bootRef = useRef(false);

  // Boot: read URL params, load the connection list, optionally open a saved
  // dashboard (?d=) or preselect a connection (?c=).
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const params = new URLSearchParams(window.location.search);
    setDebug(params.get('debug') === '1');
    const savedId = params.get('d');
    const connParam = params.get('c');

    (async () => {
      let list: ConnectionListItem[] = [];
      let hasEnv = false;
      try {
        const res = await fetch('/api/connections');
        const body = await res.json();
        list = body.connections ?? [];
        hasEnv = Boolean(body.envConnection);
        setConnections(list);
        setEnvConnection(hasEnv);
      } catch {
        setConnections([]);
      }

      if (savedId) {
        try {
          const res = await fetch(`/api/dashboards/${savedId}`);
          const body = await res.json();
          if (!res.ok || !body?.dashboard) {
            throw new Error(body?.error?.friendlyMessage ?? 'That saved dashboard could not be opened.');
          }
          const d = body.dashboard;
          setSelected(d.connectionId ?? 'env');
          loadSaved({
            question: d.question,
            connectionId: d.connectionId,
            spec: d.spec,
            history: d.history,
          });
          return;
        } catch (err) {
          setLoadError(err instanceof Error ? err.message : 'That saved dashboard could not be opened.');
        }
      }

      if (connParam && (connParam === 'env' || list.some((c) => c.id === connParam))) {
        setSelected(connParam);
      } else if (hasEnv) {
        setSelected('env');
      } else if (list.length > 0) {
        setSelected(list[0].id);
      }
    })();
  }, [loadSaved]);

  // Keep the hook and the URL in sync with the picker. setConnectionId is a
  // no-op when the value is unchanged (so reopening a saved dashboard doesn't
  // reset it), and resets the conversation when it actually changes.
  useEffect(() => {
    if (selected === null) return;
    setConnectionId(selected === 'env' ? null : selected);
    const url = new URL(window.location.href);
    if (url.searchParams.get('c') !== selected) {
      url.searchParams.set('c', selected);
      url.searchParams.delete('d');
      window.history.replaceState(null, '', url.toString());
    }
  }, [selected, setConnectionId]);

  // A new or updated dashboard is unsaved again.
  useEffect(() => {
    setSaveStatus('idle');
  }, [spec]);

  const onSave = useCallback(async () => {
    if (!spec) return;
    setSaveStatus('saving');
    try {
      await save(spec.title);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [spec, save]);

  const noConnectionAvailable =
    connections !== null && connections.length === 0 && !envConnection;

  const picker =
    connections !== null && (connections.length > 0 || envConnection) ? (
      <select
        value={selected ?? ''}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="Choose a database connection"
        className="max-w-44 truncate rounded-lg border border-line-strong bg-white px-2.5 py-1.5 font-mono text-xs text-ink outline-none transition-colors focus:border-brand"
      >
        {envConnection && <option value="env">Built-in data</option>}
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    ) : undefined;

  return (
    <div className="min-h-screen">
      <AppHeader slot={picker} />

      {noConnectionAvailable && (
        <div className="mx-auto flex max-w-2xl flex-col items-center px-4 pt-20 pb-16 text-center sm:pt-28">
          <div className="font-mono text-xs font-semibold uppercase tracking-[.16em] text-brand">Get started</div>
          <h1 className="mt-4 font-serif text-4xl font-medium leading-[1.04] tracking-[-.015em] text-ink sm:text-5xl">
            First, connect <em className="text-brand">your database.</em>
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-muted">
            One connection string, once. We set up read-only access, look at what&apos;s in there,
            and then you can ask questions in plain English.
          </p>
          <Link
            href="/app/connect"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            Connect a database
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14m-6-6l6 6-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      )}

      {!noConnectionAvailable && (phase === 'idle' || (phase === 'planning' && !spec)) && (
        <div className="mx-auto flex max-w-2xl flex-col items-center px-4 pt-20 pb-16 text-center sm:pt-28">
          <div className="font-mono text-xs font-semibold uppercase tracking-[.16em] text-brand">New dashboard</div>
          <h1 className="mt-4 font-serif text-4xl font-medium leading-[1.04] tracking-[-.015em] text-ink sm:text-5xl">
            Ask for a dashboard <em className="text-brand">in plain English.</em>
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-muted">
            No SQL, no setup — just ask a question about the data this app is connected to, and watch the charts assemble.
          </p>

          {loadError && (
            <div className="mt-6 w-full rounded-xl border border-warm/30 bg-warm-tint px-4 py-3 text-left text-sm text-ink">
              {loadError}
            </div>
          )}

          <div className="mt-9 w-full">
            <PromptBar onSubmit={submit} disabled={phase === 'planning' || selected === null} defaultValue={question} />
          </div>

          {phase === 'idle' && (
            <div className="mt-6 w-full">
              <ExampleChips examples={EXAMPLES} onSelect={submit} />
            </div>
          )}

          {phase === 'planning' && (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              className="mt-10 flex items-center justify-center gap-2.5 font-mono text-sm text-faint"
            >
              <span
                className="inline-block h-3.5 w-3.5 rounded-full"
                style={{ border: '2px solid #d8d0c2', borderTopColor: '#1D5C4A', animation: 'spin .7s linear infinite' }}
              />
              Designing your dashboard…
            </div>
          )}
        </div>
      )}

      {phase === 'error' && (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <PromptBar onSubmit={submit} />
          <div className="mx-auto mt-16 max-w-md text-center">
            <div
              className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl"
              style={{ background: '#F3E4D6' }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M12 8v5" stroke="#C9622F" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="16.5" r="1.2" fill="#C9622F" />
                <circle cx="12" cy="12" r="9" stroke="#C9622F" strokeWidth="1.6" />
              </svg>
            </div>
            <h1 className="font-serif text-2xl font-medium text-ink">We couldn’t build that dashboard</h1>
            <p className="mt-2 text-sm text-muted">{dashboardError}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
            >
              Try again
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M4 12a8 8 0 0113.5-5.8L20 8M20 4v4h-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {spec && (phase === 'rendering' || phase === 'done' || phase === 'planning') && (
        <div className="mx-auto max-w-6xl px-4 py-8" aria-busy={phase === 'rendering' || phase === 'planning'}>
          <div className="mb-4">
            <PromptBar
              onSubmit={submit}
              disabled={phase === 'planning'}
              placeholder="Ask a follow-up — refine this dashboard or ask for something new"
              clearOnSubmit
            />
          </div>

          {phase === 'planning' && (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 flex items-center gap-2.5 font-mono text-sm text-faint"
            >
              <span
                className="inline-block h-3.5 w-3.5 rounded-full"
                style={{ border: '2px solid #d8d0c2', borderTopColor: '#1D5C4A', animation: 'spin .7s linear infinite' }}
              />
              Updating your dashboard…
            </div>
          )}

          {dashboardError && phase === 'done' && (
            <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-warm/30 bg-warm-tint px-4 py-3 text-sm text-ink">
              <span>{dashboardError}</span>
              <button
                type="button"
                onClick={retry}
                className="shrink-0 font-semibold text-warm transition-colors hover:text-ink"
              >
                Try again
              </button>
            </div>
          )}

          <div className={phase === 'planning' ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
            <DashboardView
              spec={spec}
              question={question}
              panels={panels}
              debug={debug}
              onStartOver={reset}
              onSave={onSave}
              saveStatus={saveStatus}
            />
          </div>
        </div>
      )}
    </div>
  );
}
