'use client';

// Generic failure card, with a distinct treatment for query timeouts: the
// query was valid but too slow, so the honest recovery is a narrower
// re-plan (wired to a synthetic follow-up turn by the parent), not a retry.
export function PanelError({ code, onNarrow }: { code?: string; onNarrow?: () => void }) {
  const isTimeout = code === 'query_timeout';
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: '#F3E4D6' }}>
        {isTimeout ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="13" r="8" stroke="#C9622F" strokeWidth="1.5" />
            <path d="M12 9v4l2.5 2.5M9 3h6" stroke="#C9622F" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v5" stroke="#C9622F" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="1.1" fill="#C9622F" />
            <circle cx="12" cy="12" r="9" stroke="#C9622F" strokeWidth="1.5" />
          </svg>
        )}
      </div>
      {isTimeout ? (
        <>
          <p className="text-sm font-semibold text-ink">This one needs too much data at once</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted">
            The query was fine but ran past the time budget. A shorter time window usually fixes it.
          </p>
          {onNarrow && (
            <button
              type="button"
              onClick={onNarrow}
              className="mt-1 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
            >
              Retry with last 90 days
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-ink">This chart didn’t come together</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted">
            We tried a couple of ways to build this one, but it’s not working right now. The rest of your dashboard is fine.
          </p>
        </>
      )}
    </div>
  );
}
