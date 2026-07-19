import Link from 'next/link';
import type { ReactNode } from 'react';

// App shell header — same visual language as the marketing nav (sticky, cream
// blur, mono wordmark) so moving from the site into the product feels seamless.
// `slot` renders app-page controls (e.g. the connection picker).
export function AppHeader({ slot }: { slot?: ReactNode }) {
  return (
    <header
      className="sticky top-0 z-50 border-b border-line"
      style={{ background: 'rgba(244,241,234,.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
        <Link href="/app" className="font-mono text-base font-semibold text-ink">
          prompt<span className="text-brand">→</span>dashboard
        </Link>
        <div className="flex min-w-0 items-center gap-5">
          {slot}
          <Link
            href="/app/dashboards"
            className="text-sm font-semibold text-muted transition-colors hover:text-brand"
          >
            Saved
          </Link>
          <Link
            href="/app/connect"
            className="hidden text-sm font-semibold text-muted transition-colors hover:text-brand sm:block"
          >
            Connect
          </Link>
          <Link href="/" className="hidden text-sm font-semibold text-muted transition-colors hover:text-brand sm:block">
            Exit to site
          </Link>
        </div>
      </div>
    </header>
  );
}
