import Link from 'next/link';

// App shell header — same visual language as the marketing nav (sticky, cream
// blur, mono wordmark) so moving from the site into the product feels seamless.
export function AppHeader() {
  return (
    <header
      className="sticky top-0 z-50 border-b border-line"
      style={{ background: 'rgba(244,241,234,.82)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="font-mono text-base font-semibold text-ink">
          prompt<span className="text-brand">→</span>dashboard
        </Link>
        <div className="flex items-center gap-5">
          <span className="hidden items-center gap-2 font-mono text-xs text-faint sm:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-soft opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            Connected to your data
          </span>
          <Link href="/" className="text-sm font-semibold text-muted transition-colors hover:text-brand">
            Exit to site
          </Link>
        </div>
      </div>
    </header>
  );
}
