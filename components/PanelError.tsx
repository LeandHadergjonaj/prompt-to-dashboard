'use client';
export function PanelError() {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: '#F3E4D6' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 8v5" stroke="#C9622F" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1.1" fill="#C9622F" />
          <circle cx="12" cy="12" r="9" stroke="#C9622F" strokeWidth="1.5" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-ink">This chart didn’t come together</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted">
        We tried a couple of ways to build this one, but it’s not working right now. The rest of your dashboard is fine.
      </p>
    </div>
  );
}
