'use client';
import { useEffect, useRef, useState } from 'react';

// Faithful React port of the animated hero demo in the imported Home.dc.html.
// Cycles through a few plain-English prompts, "types" each one, then assembles
// a mock dashboard (KPIs + bar chart) before moving on.

interface Kpi {
  l: string;
  v: string;
  pos?: boolean;
}
interface Bar {
  h: number;
  lab: string;
  warm?: boolean;
}
interface Prompt {
  text: string;
  title: string;
  pill: string;
  kpis: Kpi[];
  bars: Bar[];
}

const ACCENT = '#1D5C4A';
const WARM = '#C9622F';

const PROMPTS: Prompt[] = [
  {
    text: 'Show me revenue by region this quarter',
    title: 'Revenue by region',
    pill: 'Q3 · live',
    kpis: [
      { l: 'TOTAL', v: '$4.2M' },
      { l: 'VS Q2', v: '+12%', pos: true },
      { l: 'REGIONS', v: '6' },
    ],
    bars: [
      { h: 78, lab: 'NA' },
      { h: 104, lab: 'EU' },
      { h: 58, lab: 'APAC', warm: true },
      { h: 120, lab: 'LATAM' },
      { h: 70, lab: 'MEA' },
      { h: 92, lab: 'ANZ' },
    ],
  },
  {
    text: 'Which channels drove the most signups?',
    title: 'Signups by channel',
    pill: '30d · live',
    kpis: [
      { l: 'SIGNUPS', v: '3,180' },
      { l: 'TOP', v: 'Organic' },
      { l: 'CAC', v: '−18%', pos: true },
    ],
    bars: [
      { h: 118, lab: 'Organic' },
      { h: 86, lab: 'Referral' },
      { h: 64, lab: 'Email' },
      { h: 100, lab: 'Social' },
      { h: 46, lab: 'Paid', warm: true },
      { h: 74, lab: 'Events' },
    ],
  },
  {
    text: 'How is customer retention trending?',
    title: 'Net revenue retention',
    pill: '12mo · live',
    kpis: [
      { l: 'NRR', v: '114%', pos: true },
      { l: 'CHURN', v: '2.1%' },
      { l: 'COHORTS', v: '12' },
    ],
    bars: [
      { h: 56, lab: 'Jan' },
      { h: 70, lab: 'Mar' },
      { h: 80, lab: 'May' },
      { h: 96, lab: 'Jul' },
      { h: 108, lab: 'Sep' },
      { h: 122, lab: 'Nov' },
    ],
  },
];

const T = 40; // ms per typed character
const TYPE_DONE_DELAY = 440; // pause after typing before building
const HOLD = 3200; // how long to show a built dashboard
const START = 340; // delay before typing begins

export function HeroDemo() {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [built, setBuilt] = useState(false);

  const idxRef = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    const push = (t: ReturnType<typeof setTimeout>) => {
      timers.current.push(t);
      return t;
    };

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setTyped(PROMPTS[0].text);
      setBuilt(true);
      return () => {
        stopped.current = true;
        timers.current.forEach(clearTimeout);
        timers.current = [];
      };
    }

    const build = () => {
      if (stopped.current) return;
      setBuilt(true);
      push(setTimeout(next, HOLD));
    };
    const next = () => {
      if (stopped.current) return;
      const n = (idxRef.current + 1) % PROMPTS.length;
      idxRef.current = n;
      setIdx(n);
      setBuilt(false);
      typeIn();
    };
    const typeIn = () => {
      const full = PROMPTS[idxRef.current].text;
      let i = 0;
      setTyped('');
      setBuilt(false);
      const step = () => {
        if (stopped.current) return;
        i++;
        setTyped(full.slice(0, i));
        if (i < full.length) push(setTimeout(step, T));
        else push(setTimeout(build, TYPE_DONE_DELAY));
      };
      push(setTimeout(step, START));
    };

    typeIn();
    return () => {
      stopped.current = true;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  const p = PROMPTS[idx];

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid rgba(22,19,14,.09)',
        borderRadius: 18,
        boxShadow: '0 40px 80px -40px rgba(22,19,14,.42)',
        overflow: 'hidden',
        animation: 'rise .8s .2s both',
      }}
    >
      {/* Prompt bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '15px 16px',
          borderBottom: '1px solid rgba(22,19,14,.08)',
          background: '#faf8f3',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}>
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill={ACCENT} />
        </svg>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
          <span
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 14,
              color: '#16130E',
              whiteSpace: 'nowrap',
            }}
          >
            {typed}
          </span>
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: 17,
              background: ACCENT,
              marginLeft: 2,
              animation: 'blink 1s step-end infinite',
              flex: 'none',
            }}
          />
        </div>
        <span
          style={{
            background: ACCENT,
            width: 32,
            height: 32,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {/* Canvas */}
      <div style={{ padding: '18px 18px 20px', minHeight: 288 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5 }}>{p.title}</div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 11,
              color: ACCENT,
              background: 'rgba(29,92,74,.1)',
              padding: '4px 10px',
              borderRadius: 20,
            }}
          >
            {p.pill}
          </div>
        </div>

        {built ? (
          <>
            <div style={{ display: 'flex', gap: 26, marginBottom: 4 }}>
              {p.kpis.map((k, i) => (
                <div key={k.l} style={{ animation: `rise .5s ${(0.05 + i * 0.09).toFixed(2)}s both` }}>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono',monospace",
                      fontSize: 10.5,
                      color: '#8a8275',
                      letterSpacing: '.05em',
                    }}
                  >
                    {k.l}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      marginTop: 2,
                      color: k.pos ? '#1f7a52' : '#16130E',
                    }}
                  >
                    {k.v}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 152, marginTop: 20 }}>
              {p.bars.map((b, i) => (
                <div
                  key={b.lab}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    justifyContent: 'flex-end',
                    height: '100%',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: b.h,
                      background: b.warm ? WARM : ACCENT,
                      borderRadius: '5px 5px 0 0',
                      transformOrigin: 'bottom',
                      animation: `grow .8s cubic-bezier(.2,.8,.2,1) ${(0.12 + i * 0.075).toFixed(2)}s both`,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono',monospace",
                      fontSize: 9.5,
                      color: '#8a8275',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {b.lab}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 26, marginBottom: 4 }}>
              {[0, 0.2, 0.4].map((d) => (
                <div
                  key={d}
                  style={{
                    width: 64,
                    height: 34,
                    background: '#ece7dd',
                    borderRadius: 6,
                    animation: `pulse-soft 1.2s ease-in-out ${d}s infinite`,
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 152, marginTop: 20 }}>
              {[70, 100, 56, 114, 80, 92].map((h, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: h,
                    background: '#ece7dd',
                    borderRadius: '5px 5px 0 0',
                    animation: `pulse-soft 1.2s ease-in-out ${(i * 0.1).toFixed(1)}s infinite`,
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 16,
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 11.5,
                color: '#8a8275',
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  border: '2px solid #d8d0c2',
                  borderTopColor: ACCENT,
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin .7s linear infinite',
                }}
              />
              Building your dashboard…
            </div>
          </>
        )}
      </div>
    </div>
  );
}
