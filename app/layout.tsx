import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Prompt to Dashboard — Ask in plain English. Get the dashboard.',
  description:
    'The AI dashboard builder for teams who’d rather ask a question than file a ticket. Connect your data and get the report you asked for — no SQL, no analyst queue.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-cream font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
