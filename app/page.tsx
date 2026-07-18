import Link from 'next/link';
import { HeroDemo } from '@/components/marketing/HeroDemo';
import { WaitlistForm } from '@/components/marketing/WaitlistForm';

// Marketing home. A faithful implementation of the imported Home.dc.html design.
// The one product-level addition is a "Log in" entry in the nav that passes
// straight through into the working app at /app (no real auth in this pass).

const NAV_LINK = { color: '#5c554a', fontSize: 15 } as const;
const EYEBROW = {
  fontFamily: "'IBM Plex Mono',monospace",
  fontSize: 12,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  fontWeight: 600,
} as const;
const CARD = {
  background: '#fff',
  border: '1px solid rgba(22,19,14,.08)',
  borderRadius: 16,
  padding: '28px 28px 26px',
} as const;

export default function Home() {
  return (
    <div style={{ overflowX: 'hidden' }}>
      {/* ============ NAV ============ */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(244,241,234,.82)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(22,19,14,.09)',
        }}
      >
        <nav
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '16px 40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link href="/" style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 16, color: '#16130E' }}>
            prompt<span style={{ color: '#1D5C4A' }}>→</span>dashboard
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, fontSize: 15 }}>
            <a href="#how" style={NAV_LINK}>How it works</a>
            <a href="#compare" style={NAV_LINK}>Why not the old way</a>
            <Link
              href="/app"
              style={{
                color: '#16130E',
                border: '1px solid rgba(22,19,14,.2)',
                padding: '9px 18px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 14.5,
              }}
            >
              Log in
            </Link>
            <a
              href="#waitlist"
              style={{
                background: '#16130E',
                color: '#F4F1EA',
                padding: '11px 20px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 14.5,
              }}
            >
              Join the waitlist
            </a>
          </div>
        </nav>
      </header>

      {/* ============ HERO ============ */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 40px 76px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.02fr .98fr', gap: 52, alignItems: 'center' }} className="hero-grid">
          <div>
            <div style={{ ...EYEBROW, color: '#1D5C4A', animation: 'rise .6s both' }}>AI dashboard builder</div>
            <h1
              style={{
                fontFamily: "'Newsreader',serif",
                fontWeight: 500,
                fontSize: 60,
                lineHeight: 1.02,
                letterSpacing: '-.017em',
                margin: '20px 0 0',
                animation: 'rise .7s .06s both',
              }}
              className="hero-h1"
            >
              Ask in plain English.
              <br />
              Get <em style={{ fontStyle: 'italic', color: '#1D5C4A' }}>the dashboard.</em>
            </h1>
            <p
              style={{
                fontSize: 19,
                lineHeight: 1.55,
                color: '#5c554a',
                margin: '24px 0 0',
                maxWidth: '32em',
                animation: 'rise .7s .14s both',
              }}
            >
              Prompt to Dashboard connects to the data you already have and builds the report you asked for — no SQL, no
              analyst queue, no waiting three days for a chart.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 34, animation: 'rise .7s .22s both', flexWrap: 'wrap' }}>
              <a
                href="#waitlist"
                style={{
                  background: '#1D5C4A',
                  color: '#fff',
                  padding: '14px 24px',
                  borderRadius: 11,
                  fontWeight: 600,
                  fontSize: 15.5,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 9,
                }}
              >
                Join the waitlist
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
              <a
                href="#how"
                style={{
                  color: '#16130E',
                  border: '1px solid rgba(22,19,14,.2)',
                  padding: '13px 22px',
                  borderRadius: 11,
                  fontWeight: 600,
                  fontSize: 15.5,
                }}
              >
                See how it works
              </a>
            </div>
            <p
              style={{
                marginTop: 22,
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 12.5,
                color: '#8a8275',
                letterSpacing: '.01em',
                animation: 'rise .7s .3s both',
              }}
            >
              No SQL &nbsp;·&nbsp; No analyst queue &nbsp;·&nbsp; Connects to your data
            </p>
          </div>

          <HeroDemo />
        </div>
      </section>

      {/* ============ TRUST STRIP ============ */}
      <section style={{ borderTop: '1px solid rgba(22,19,14,.08)', borderBottom: '1px solid rgba(22,19,14,.08)', background: '#efe9dd' }}>
        <div
          data-reveal
          style={{ maxWidth: 1200, margin: '0 auto', padding: '26px 40px', display: 'flex', alignItems: 'center', gap: 36, flexWrap: 'wrap' }}
        >
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, letterSpacing: '.04em', color: '#8a8275', textTransform: 'uppercase', flex: 'none' }}>
            Connects to the data you already have
          </span>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', flex: 1 }}>
            {['Postgres', 'Snowflake', 'BigQuery', 'Spreadsheets', 'CRM', 'Product analytics'].map((t) => (
              <span
                key={t}
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  fontSize: 13,
                  color: '#5c554a',
                  background: '#fff',
                  border: '1px solid rgba(22,19,14,.1)',
                  padding: '7px 14px',
                  borderRadius: 8,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ============ THE OLD WAY ============ */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '88px 40px 72px' }}>
        <div data-reveal style={{ maxWidth: 760 }}>
          <div style={{ ...EYEBROW, color: '#C9622F' }}>The old way</div>
          <h2 style={{ fontFamily: "'Newsreader',serif", fontWeight: 500, fontSize: 44, lineHeight: 1.08, letterSpacing: '-.015em', margin: '16px 0 0' }}>
            Building dashboards the old way is slow, technical, and quietly out of date.
          </h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: '#5c554a', margin: '18px 0 0' }}>
            Every question turns into a project. And the people who need the answer are rarely the ones who can get it.
          </p>
        </div>
        <div data-reveal style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 22, marginTop: 44 }} className="pain-grid">
          {[
            {
              icon: (
                <>
                  <circle cx="12" cy="12" r="8.5" stroke="#C9622F" strokeWidth="1.7" />
                  <path d="M12 7.5V12l3 2" stroke="#C9622F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </>
              ),
              h: 'You wait in the analyst queue',
              p: 'Every question becomes a ticket. The report lands days later — if it lands at all.',
            },
            {
              icon: <path d="M8 9l-3 3 3 3M16 9l3 3-3 3M13.5 6.5l-3 11" stroke="#C9622F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
              h: 'Someone has to write the SQL',
              p: 'The people closest to the question can’t answer it themselves. They need a specialist.',
            },
            {
              icon: <path d="M7 4h10M7 20h10M8 4c0 4 8 5 8 8s-8 4-8 8" stroke="#C9622F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
              h: 'The answer arrives too late',
              p: 'By the time the dashboard is built, the campaign’s over and the question has moved on.',
            },
            {
              icon: (
                <>
                  <path d="M4 12a8 8 0 0113.5-5.8L20 8M20 12a8 8 0 01-13.5 5.8L4 16" stroke="#C9622F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 4v4h-4M4 20v-4h4" stroke="#C9622F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </>
              ),
              h: 'Dashboards quietly rot',
              p: 'Manual dashboards drift out of date, and no one is quite sure which numbers to trust anymore.',
            },
          ].map((c) => (
            <div key={c.h} style={CARD}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: '#F3E4D6', display: 'grid', placeItems: 'center', marginBottom: 18 }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
                  {c.icon}
                </svg>
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{c.h}</h3>
              <p style={{ fontSize: 16, lineHeight: 1.5, color: '#5c554a', margin: '10px 0 0' }}>{c.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section id="how" style={{ background: '#16130E', color: '#F4F1EA', scrollMarginTop: 70 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '88px 40px 92px' }}>
          <div data-reveal style={{ maxWidth: 720 }}>
            <div style={{ ...EYEBROW, color: '#7fbfa9' }}>How it works</div>
            <h2 style={{ fontFamily: "'Newsreader',serif", fontWeight: 500, fontSize: 44, lineHeight: 1.08, letterSpacing: '-.015em', margin: '16px 0 0', color: '#F4F1EA' }}>
              From a question to a dashboard in three steps.
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 28, marginTop: 52 }} className="how-grid">
            <div data-reveal style={{ borderTop: '1px solid rgba(244,241,234,.18)', paddingTop: 26 }}>
              <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, color: '#7fbfa9', fontWeight: 500 }}>01</div>
              <h3 style={{ fontSize: 22, fontWeight: 600, margin: '14px 0 0' }}>Connect your data</h3>
              <p style={{ fontSize: 16, lineHeight: 1.55, color: '#b7b1a4', margin: '12px 0 22px' }}>
                Point it at the warehouse, spreadsheet, or app you already use. One-time setup, no migration.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {['Snowflake', 'Postgres', 'Sheets'].map((t) => (
                  <span
                    key={t}
                    style={{
                      fontFamily: "'IBM Plex Mono',monospace",
                      fontSize: 12,
                      color: '#cfc9bc',
                      background: 'rgba(244,241,234,.07)',
                      border: '1px solid rgba(244,241,234,.14)',
                      padding: '6px 11px',
                      borderRadius: 7,
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div data-reveal style={{ borderTop: '1px solid rgba(244,241,234,.18)', paddingTop: 26 }}>
              <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, color: '#7fbfa9', fontWeight: 500 }}>02</div>
              <h3 style={{ fontSize: 22, fontWeight: 600, margin: '14px 0 0' }}>Ask in plain English</h3>
              <p style={{ fontSize: 16, lineHeight: 1.55, color: '#b7b1a4', margin: '12px 0 22px' }}>
                Type the question the way you’d say it out loud. No syntax, no fields to hunt for.
              </p>
              <div style={{ background: '#0e0c09', border: '1px solid rgba(244,241,234,.14)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, color: '#9aa6a0' }}>&gt;_</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12.5, color: '#e7e2d6' }}>Compare Q3 spend vs budget</span>
                <span style={{ width: 2, height: 15, background: '#7fbfa9', animation: 'blink 1s step-end infinite' }} />
              </div>
            </div>
            <div data-reveal style={{ borderTop: '1px solid rgba(244,241,234,.18)', paddingTop: 26 }}>
              <div style={{ fontFamily: "'Newsreader',serif", fontSize: 15, color: '#7fbfa9', fontWeight: 500 }}>03</div>
              <h3 style={{ fontSize: 22, fontWeight: 600, margin: '14px 0 0' }}>Get a dashboard you trust</h3>
              <p style={{ fontSize: 16, lineHeight: 1.55, color: '#b7b1a4', margin: '12px 0 22px' }}>
                Charts assemble in seconds — and you can see exactly how every number was calculated.
              </p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, height: 74 }}>
                {[44, 64, 34, 72, 52].map((h, i) => (
                  <div key={i} data-grow style={{ flex: 1, height: h, background: i === 2 ? '#4f7d6d' : '#7fbfa9', borderRadius: '4px 4px 0 0' }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ BEFORE / AFTER ============ */}
      <section id="compare" style={{ maxWidth: 1200, margin: '0 auto', padding: '88px 40px 76px', scrollMarginTop: 70 }}>
        <div data-reveal style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto' }}>
          <div style={{ ...EYEBROW, color: '#1D5C4A' }}>Old way vs. a sentence</div>
          <h2 style={{ fontFamily: "'Newsreader',serif", fontWeight: 500, fontSize: 44, lineHeight: 1.08, letterSpacing: '-.015em', margin: '16px 0 0' }}>
            Same question. Very different path.
          </h2>
        </div>
        <div data-reveal style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 0, alignItems: 'stretch', marginTop: 48 }} className="compare-grid">
          <div style={{ background: '#efe4d8', border: '1px solid rgba(201,98,47,.28)', borderRadius: '16px 0 0 16px', padding: '34px 32px' }} className="compare-old">
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#C9622F', fontWeight: 600, marginBottom: 20 }}>
              The old way
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                ['01', 'File a request', 'Write up the ask, send it to the data team.'],
                ['02', 'Wait in the queue', 'Days pass. Priorities shift. Follow up.'],
                ['03', 'Get a static chart', 'It answers last week’s question, not today’s.'],
              ].map(([n, h, p]) => (
                <div key={n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: '#C9622F', marginTop: 2 }}>{n}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{h}</div>
                    <div style={{ fontSize: 14.5, color: '#6b6459', marginTop: 2 }}>{p}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: '#C9622F', borderTop: '1px solid rgba(201,98,47,.25)', paddingTop: 16 }}>
              ≈ 3–5 days
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', background: '#F4F1EA' }} className="compare-vs">
            <span style={{ fontFamily: "'Newsreader',serif", fontStyle: 'italic', fontSize: 22, color: '#8a8275' }}>vs</span>
          </div>
          <div style={{ background: '#fff', border: '1px solid rgba(29,92,74,.3)', borderRadius: '0 16px 16px 0', padding: '34px 32px', boxShadow: '0 30px 60px -40px rgba(29,92,74,.5)' }} className="compare-new">
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#1D5C4A', fontWeight: 600, marginBottom: 20 }}>
              With Prompt to Dashboard
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                ['Type the question', 'Ask it in plain English, right where you work.'],
                ['Watch it build', 'The right charts assemble in front of you.'],
                ['Trust it & share it', 'Inspect the logic, then send the live link.'],
              ].map(([h, p]) => (
                <div key={h} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ color: '#1D5C4A', marginTop: 1, flex: 'none' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="#1D5C4A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{h}</div>
                    <div style={{ fontSize: 14.5, color: '#5c554a', marginTop: 2 }}>{p}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24, fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: '#1D5C4A', borderTop: '1px solid rgba(29,92,74,.2)', paddingTop: 16 }}>
              ≈ 30 seconds
            </div>
          </div>
        </div>
        <div data-reveal style={{ textAlign: 'center', marginTop: 36 }}>
          <Link href="/app" style={{ fontSize: 16, fontWeight: 600, color: '#1D5C4A', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            Try the fast path yourself
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h13M13 6l6 6-6 6" stroke="#1D5C4A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ============ PULL QUOTE ============ */}
      <section style={{ background: '#1D5C4A', color: '#F4F1EA' }}>
        <div data-reveal style={{ maxWidth: 1000, margin: '0 auto', padding: '80px 40px', textAlign: 'center' }}>
          <p style={{ fontFamily: "'Newsreader',serif", fontWeight: 500, fontSize: 40, lineHeight: 1.18, letterSpacing: '-.01em', margin: 0 }}>
            Your data should answer to a sentence — <em style={{ fontStyle: 'italic', color: '#bfe3d6' }}>not a ticket.</em>
          </p>
        </div>
      </section>

      {/* ============ CLOSING CTA / WAITLIST ============ */}
      <section id="waitlist" style={{ maxWidth: 1200, margin: '0 auto', padding: '92px 40px 96px', scrollMarginTop: 70 }}>
        <div
          data-reveal
          style={{
            background: '#fff',
            border: '1px solid rgba(22,19,14,.09)',
            borderRadius: 22,
            padding: '60px 48px',
            textAlign: 'center',
            boxShadow: '0 40px 80px -50px rgba(22,19,14,.4)',
          }}
        >
          <h2 style={{ fontFamily: "'Newsreader',serif", fontWeight: 500, fontSize: 50, lineHeight: 1.04, letterSpacing: '-.017em', margin: 0 }}>
            Stop waiting on dashboards.
          </h2>
          <p style={{ fontSize: 19, lineHeight: 1.55, color: '#5c554a', margin: '20px auto 0', maxWidth: '34em' }}>
            Prompt to Dashboard is in early access. Join the waitlist and be among the first teams to ask their data anything.
          </p>
          <WaitlistForm />
          <p style={{ marginTop: 22, fontSize: 14.5, color: '#8a8275' }}>
            Already have access?{' '}
            <Link href="/app" style={{ color: '#1D5C4A', fontWeight: 600 }}>
              Log in →
            </Link>
          </p>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer style={{ borderTop: '1px solid rgba(22,19,14,.1)', background: '#efe9dd' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '56px 40px 40px', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 32 }} className="footer-grid">
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, fontSize: 16 }}>
              prompt<span style={{ color: '#1D5C4A' }}>→</span>dashboard
            </div>
            <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#6b6459', margin: '14px 0 0', maxWidth: '26em' }}>
              The AI dashboard builder for teams who’d rather ask a question than file a ticket.
            </p>
          </div>
          {[
            { head: 'Product', links: [['How it works', '#how'], ['Why not the old way', '#compare'], ['Join the waitlist', '#waitlist'], ['Open the app', '/app']] },
            { head: 'Company', links: [['About', '#'], ['Careers', '#'], ['Contact', '#']] },
            { head: 'Legal', links: [['Privacy', '#'], ['Terms', '#']] },
          ].map((col) => (
            <div key={col.head}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8a8275', marginBottom: 14 }}>
                {col.head}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14.5 }}>
                {col.links.map(([label, href]) =>
                  href.startsWith('/') ? (
                    <Link key={label} href={href} style={{ color: '#5c554a' }}>
                      {label}
                    </Link>
                  ) : (
                    <a key={label} href={href} style={{ color: '#5c554a' }}>
                      {label}
                    </a>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 40px 40px', borderTop: '1px solid rgba(22,19,14,.08)', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, color: '#8a8275' }}>
          © 2026 Prompt to Dashboard · Early access
        </div>
      </footer>
    </div>
  );
}
