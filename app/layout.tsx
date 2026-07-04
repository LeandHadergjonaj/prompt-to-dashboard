import './globals.css';

export const metadata = { title: 'Dashboard Builder', description: 'Ask for a dashboard in plain English.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-[#f9f9f7] text-[#0b0b0b]">{children}</body>
    </html>
  );
}
