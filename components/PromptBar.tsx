'use client';
import { useState } from 'react';

export function PromptBar({ onSubmit, disabled, defaultValue, placeholder, clearOnSubmit }: {
  onSubmit: (q: string) => void;
  disabled?: boolean;
  defaultValue?: string;
  placeholder?: string;
  clearOnSubmit?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? '');
  return (
    <form
      className="flex w-full gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) {
          onSubmit(value.trim());
          if (clearOnSubmit) setValue('');
        }
      }}
    >
      <div className="relative flex-1">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-sm text-brand">
          ›_
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          placeholder={placeholder ?? 'e.g. Show me revenue by month for the last year'}
          className="w-full rounded-xl border border-line-strong bg-field py-3.5 pl-11 pr-4 text-base text-ink placeholder:text-placeholder focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 disabled:opacity-60"
        />
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="hidden sm:inline">Build my dashboard</span>
        <span className="sm:hidden">Build</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
