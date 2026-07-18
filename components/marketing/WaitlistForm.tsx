'use client';
import { useState } from 'react';

// Lightweight, client-only early-access capture for the closing CTA. No real
// backend at this stage — it just acknowledges the submission, mirroring the
// submit → thank-you pattern from the imported "Join the Waitlist" design.
export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'rgba(29,92,74,.12)',
            display: 'grid',
            placeItems: 'center',
            animation: 'pop .5s cubic-bezier(.2,.9,.3,1.2) both',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#1D5C4A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 500, margin: 0 }}>
          You’re on the list.
        </p>
        <p style={{ fontSize: 15.5, color: '#5c554a', margin: 0 }}>
          We’ll email you the moment early access opens.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) setDone(true);
      }}
      style={{
        marginTop: 34,
        display: 'flex',
        gap: 12,
        justifyContent: 'center',
        flexWrap: 'wrap',
      }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        aria-label="Work email"
        style={{
          width: 300,
          maxWidth: '100%',
          padding: '15px 18px',
          border: '1px solid rgba(22,19,14,.16)',
          borderRadius: 12,
          fontSize: 16,
          fontFamily: "'Hanken Grotesk',sans-serif",
          background: '#fdfcf9',
          color: '#16130E',
          outline: 'none',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = '#1D5C4A';
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(29,92,74,.12)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'rgba(22,19,14,.16)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
      <button
        type="submit"
        style={{
          background: '#1D5C4A',
          color: '#fff',
          border: 'none',
          padding: '15px 28px',
          borderRadius: 12,
          fontSize: 16,
          fontWeight: 600,
          fontFamily: "'Hanken Grotesk',sans-serif",
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#164a3b')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#1D5C4A')}
      >
        Join the waitlist
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
