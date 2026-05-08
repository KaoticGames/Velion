/**
 * Landing.tsx — Early Access promotional page
 *
 * Velion Mythera is not yet live. This page collects email signups
 * and builds anticipation. No account is created — emails are stored
 * in early_access_signups and will be notified at launch.
 */

import React, { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

// ── Palette ────────────────────────────────────────────────────────────────
const T = {
  bg:        '#05060b',
  surface:   '#080a10',
  card:      '#0b0d16',
  border:    '#181c28',
  borderHi:  '#2a3048',
  gold:      '#c4922a',
  goldDim:   '#4a3510',
  goldGlow:  '#c4922a18',
  text:      '#e4d8c0',
  textMuted: '#7a6e60',
  textDim:   '#3a3228',
  hp:        '#c84040',
  green:     '#4a9a5a',
};

const pillars = [
  {
    glyph: '⚔',
    title: 'Resource Point Combat',
    body:  'Every action — attacks, spells, defenses — flows from a single RP pool. No separate action slots. No spell slots. One economy, infinite tactical depth.',
  },
  {
    glyph: '🛡',
    title: 'Save-First Resolution',
    body:  'Defenders roll before damage lands. Every strike is a contest, not a monologue. Survival is skill, not passive RNG.',
  },
  {
    glyph: '💎',
    title: 'Spell Gem Magic',
    body:  'Magic lives in crystallised gems slotted into Focus Bracers. Auto-hitting, auto-scaling, no memorisation required.',
  },
  {
    glyph: '∞',
    title: 'No Level Cap',
    body:  'Characters scale from 300 HP at level 1 to 100,000+ at level 20 — and the encounter math stays balanced across every tier.',
  },
  {
    glyph: '🖥',
    title: 'Digital-First VTT',
    body:  'Built for screens, not paper. Live session sync, fog of war, token management, and browser source overlays for streamers.',
  },
  {
    glyph: '🏰',
    title: 'Equipment-Defined Identity',
    body:  'No class restrictions. A mage in plate is valid. A duelist channelling lightning through twin daggers is valid. Your gear is your archetype.',
  },
];

const milestones = [
  { label: 'Core Rulebook',        done: true  },
  { label: 'Character System',     done: true  },
  { label: 'VTT Platform',         done: true  },
  { label: 'Campaign Tools',       done: true  },
  { label: 'Early Access Launch',  done: false },
  { label: 'Full Public Release',  done: false },
];

function useCountUp(target: number, duration = 1200) {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || target === 0) return;
    started.current = true;
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / duration);
      setVal(Math.floor(p * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val;
}

const inputSt: React.CSSProperties = {
  background: '#07090f',
  border: `1px solid ${T.borderHi}`,
  borderRadius: '3px',
  padding: '12px 14px',
  color: T.text,
  fontSize: '18px',
  fontFamily: "'EB Garamond', serif",
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};

const sectionLabel: React.CSSProperties = {
  fontFamily: "'Cinzel', serif",
  fontSize: '12px',
  letterSpacing: '0.35em',
  color: T.textMuted,
  marginBottom: '12px',
};

const sectionTitle: React.CSSProperties = {
  fontFamily: "'Cinzel', serif",
  fontSize: 'clamp(23px, 3vw, 33px)',
  letterSpacing: '0.1em',
  color: T.gold,
  margin: 0,
};

const bodyText: React.CSSProperties = {
  color: T.textMuted,
  fontSize: '19px',
  lineHeight: 1.8,
  marginBottom: '18px',
};

export default function Landing() {
  const [email,  setEmail]  = useState('');
  const [name,   setName]   = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [count,  setCount]  = useState(0);

  useEffect(() => {
    api.get('/early-access/count').then(r => setCount(r.data.count ?? 0)).catch(() => {});
  }, []);

  const displayCount = useCountUp(count, 1400);

  const handleSubmit = async () => {
    if (!email.trim() || status === 'loading' || status === 'success') return;
    setStatus('loading');
    setErrMsg('');
    try {
      await api.post('/early-access', { email: email.trim(), name: name.trim() || undefined });
      setStatus('success');
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? 'Something went wrong. Please try again.';
      setErrMsg(msg);
      setStatus('error');
    }
  };

  return (
    <div style={{ color: T.text, fontFamily: "'EB Garamond', serif", background: T.bg, minHeight: '100vh' }}>

      {/* ── Grain overlay ────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E")`,
        opacity: 0.7,
      }} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section style={{
        position: 'relative', zIndex: 1,
        minHeight: 'calc(100vh - 52px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '80px 24px 80px',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 70% 55% at 50% 38%, #c4922a0e 0%, transparent 65%)',
        }} />

        {/* Early access badge */}
        <div style={{
          fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.35em',
          color: T.gold, border: `1px solid ${T.gold}55`, borderRadius: '2px',
          padding: '6px 18px', marginBottom: '40px', background: T.goldGlow,
          animation: 'pulse-badge 3s ease-in-out infinite',
        }}>
          ✦ EARLY ACCESS · SIGN UP BELOW ✦
        </div>

        <img
          src="/velion_full_logo.png"
          alt="Velion Mythera"
          style={{
            width: 'min(760px, 90vw)',
            height: 'auto',
            margin: '0 0 8px',
            filter: 'drop-shadow(0 0 30px #c4922a33)',
          }}
        />

        <div style={{
          width: '340px', height: '1px', margin: '16px auto 28px',
          background: `linear-gradient(to right, transparent, ${T.gold}66, transparent)`,
        }} />

        <p style={{
          maxWidth: '560px', fontSize: 'clamp(19px, 2.3vw, 23px)',
          lineHeight: 1.75, color: T.textMuted,
          margin: '0 auto 12px', fontStyle: 'italic',
        }}>
          A digital-first tabletop RPG where power has no ceiling,
          equipment defines identity, and the world bends around your choices.
        </p>
        <p style={{ fontSize: '20px', color: T.text, fontWeight: 600, marginBottom: '52px' }}>
          Something new is being forged. Be first to enter.
        </p>

        {/* ── Sign-up form ───────────────────────────────────────────── */}
        <div style={{
          width: '100%', maxWidth: '500px',
          background: T.card, border: `1px solid ${T.borderHi}`,
          borderTop: `2px solid ${T.gold}`,
          borderRadius: '4px', padding: '32px 28px',
          boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px ${T.gold}08`,
          position: 'relative', zIndex: 1,
        }}>
          {status === 'success' ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: '31px', color: T.gold, marginBottom: '14px' }}>✦</div>
              <div style={{
                fontFamily: "'Cinzel', serif", fontSize: '16px',
                letterSpacing: '0.16em', color: T.gold, marginBottom: '12px',
              }}>
                YOUR NAME IS RECORDED
              </div>
              <p style={{ color: T.textMuted, fontSize: '18px', lineHeight: 1.65, margin: 0 }}>
                We'll send word when Early Access opens.<br />
                May your legend begin soon.
              </p>
            </div>
          ) : (
            <>
              <div style={{
                fontFamily: "'Cinzel', serif", fontSize: '14px',
                letterSpacing: '0.2em', color: T.gold,
                marginBottom: '20px', textAlign: 'center',
              }}>
                JOIN THE EARLY ACCESS LIST
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Your name (optional)"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={inputSt}
                />
                <input
                  type="email"
                  placeholder="Your email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  style={inputSt}
                />
                {status === 'error' && (
                  <div style={{ fontSize: '16px', color: T.hp }}>{errMsg}</div>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={status === 'loading' || !email.trim()}
                  style={{
                    fontFamily: "'Cinzel', serif", fontSize: '15px',
                    letterSpacing: '0.18em', fontWeight: 700,
                    padding: '14px', borderRadius: '3px', border: 'none',
                    cursor: email.trim() && status !== 'loading' ? 'pointer' : 'not-allowed',
                    background: email.trim() ? T.gold : T.goldDim,
                    color: email.trim() ? T.bg : T.textMuted,
                    transition: 'all 0.2s',
                    opacity: status === 'loading' ? 0.7 : 1,
                  }}
                >
                  {status === 'loading' ? 'SENDING…' : 'NOTIFY ME AT LAUNCH'}
                </button>
              </div>
              <p style={{
                fontSize: '15px', color: T.textDim, textAlign: 'center',
                marginTop: '14px', marginBottom: 0,
              }}>
                No account created · No spam · One email when doors open
              </p>
            </>
          )}
        </div>

        {count > 0 && (
          <div style={{
            marginTop: '22px',
            fontFamily: "'Cinzel', serif", fontSize: '14px',
            letterSpacing: '0.16em', color: T.textMuted,
          }}>
            <span style={{ color: T.gold, fontSize: '20px', fontWeight: 700, marginRight: '6px' }}>
              {displayCount}
            </span>
            adventurers already enlisted
          </div>
        )}

        <div style={{
          position: 'absolute', bottom: '28px', left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
          animation: 'float-down 2.4s ease-in-out infinite',
        }}>
          <div style={{ width: '1px', height: '36px', background: `linear-gradient(to bottom, ${T.gold}66, transparent)` }} />
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.3em', color: T.textDim }}>SCROLL</span>
        </div>
      </section>

      {/* ── What is Velion Mythera ───────────────────────────────────── */}
      <section style={{ position: 'relative', zIndex: 1, padding: '100px 24px', maxWidth: '860px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '52px' }}>
          <div style={sectionLabel}>THE WORLD</div>
          <h2 style={sectionTitle}>A New Kind of TTRPG</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '32px' }}>
          <div>
            <p style={bodyText}>
              Velion Mythera draws from the grand traditions of the MMO and JRPG — games where
              power escalates dramatically, where a character's journey from novice to legend is
              felt in every number on the sheet.
            </p>
            <p style={bodyText}>
              It is a living world narrated by a human Dungeon Master, played at a table (or a
              screen), and governed by rules designed to be transparent, exciting, and endlessly replayable.
            </p>
          </div>
          <div>
            <p style={bodyText}>
              The Velion Mythera VTT is built natively for this system — not bolted on after
              the fact. Every rule has a digital counterpart: automated combat, live fog of war,
              encounter building, even streaming overlays for your audience.
            </p>
            <p style={bodyText}>
              This is not a simulation. It is a stage — and the story you create here will
              belong entirely to your party.
            </p>
          </div>
        </div>
      </section>

      {/* ── Feature pillars ─────────────────────────────────────────── */}
      <section style={{
        position: 'relative', zIndex: 1,
        padding: '80px 24px',
        background: T.surface,
        borderTop: `1px solid ${T.border}`,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={sectionLabel}>THE SYSTEM</div>
            <h2 style={sectionTitle}>Built For Epic Scale</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
            {pillars.map((p, i) => (
              <div key={i}
                style={{
                  background: T.card, border: `1px solid ${T.border}`,
                  borderLeft: `3px solid ${T.goldDim}`, borderRadius: '3px',
                  padding: '24px 22px',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderLeftColor = T.gold;
                  el.style.boxShadow = `0 0 24px ${T.gold}0d`;
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderLeftColor = T.goldDim;
                  el.style.boxShadow = 'none';
                }}
              >
                <div style={{ fontSize: '23px', marginBottom: '10px' }}>{p.glyph}</div>
                <div style={{
                  fontFamily: "'Cinzel', serif", fontSize: '14px',
                  letterSpacing: '0.14em', color: T.gold, marginBottom: '10px',
                }}>
                  {p.title.toUpperCase()}
                </div>
                <p style={{ color: T.textMuted, fontSize: '18px', lineHeight: 1.65, margin: 0 }}>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Road to launch ───────────────────────────────────────────── */}
      <section style={{ position: 'relative', zIndex: 1, padding: '100px 24px' }}>
        <div style={{ maxWidth: '520px', margin: '0 auto', textAlign: 'center' }}>
          <div style={sectionLabel}>PROGRESS</div>
          <h2 style={{ ...sectionTitle, marginBottom: '52px' }}>Road to Launch</h2>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {milestones.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px', position: 'relative' }}>
                {i < milestones.length - 1 && (
                  <div style={{
                    position: 'absolute', left: '15px', top: '30px',
                    width: '2px', height: '40px',
                    background: m.done
                      ? `linear-gradient(to bottom, ${T.gold}88, ${T.gold}22)`
                      : T.border,
                  }} />
                )}
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: m.done ? T.goldDim : T.card,
                  border: `2px solid ${m.done ? T.gold : T.border}`,
                  boxShadow: m.done ? `0 0 14px ${T.gold}33` : 'none',
                  fontSize: '15px', color: m.done ? T.gold : T.textDim,
                }}>
                  {m.done ? '✦' : '·'}
                </div>
                <div style={{
                  padding: '14px 0', flex: 1,
                  fontFamily: "'Cinzel', serif", fontSize: '15px',
                  letterSpacing: '0.12em', textAlign: 'left',
                  color: m.done ? T.text : T.textDim,
                }}>
                  {m.label.toUpperCase()}
                </div>
                {!m.done && i === milestones.findIndex(x => !x.done) && (
                  <div style={{
                    fontFamily: "'Cinzel', serif", fontSize: '12px',
                    letterSpacing: '0.2em', color: T.gold,
                    border: `1px solid ${T.gold}44`, padding: '3px 8px',
                    borderRadius: '2px', background: T.goldGlow, whiteSpace: 'nowrap',
                  }}>
                    NEXT
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section style={{
        position: 'relative', zIndex: 1,
        padding: '80px 24px 100px',
        background: T.surface,
        borderTop: `1px solid ${T.border}`,
        textAlign: 'center',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse 50% 70% at 50% 100%, ${T.gold}09, transparent)`,
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ ...sectionLabel, marginBottom: '16px' }}>THE CALL</div>
          <h2 style={{ ...sectionTitle, marginBottom: '18px' }}>Be First Through the Gate</h2>
          <p style={{
            color: T.textMuted, fontSize: '19px',
            maxWidth: '460px', margin: '0 auto 44px', lineHeight: 1.75,
          }}>
            Early access members will be first to create characters, run campaigns, and shape
            the platform while it's still young. One email — we'll reach out when the gates open.
          </p>
          <div style={{
            display: 'flex', gap: '10px', maxWidth: '420px',
            margin: '0 auto', flexWrap: 'wrap', justifyContent: 'center',
          }}>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={{ ...inputSt, flex: '1', minWidth: '200px' }}
            />
            <button
              onClick={handleSubmit}
              disabled={status === 'loading' || status === 'success' || !email.trim()}
              style={{
                fontFamily: "'Cinzel', serif", fontSize: '14px',
                letterSpacing: '0.16em', fontWeight: 700,
                padding: '12px 22px', borderRadius: '3px', border: 'none',
                cursor: 'pointer', whiteSpace: 'nowrap',
                background: status === 'success' ? T.green : T.gold,
                color: T.bg, transition: 'all 0.2s',
              }}
            >
              {status === 'success' ? '✦ ENLISTED' : 'ENLIST'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer style={{
        position: 'relative', zIndex: 1,
        padding: '24px',
        borderTop: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px',
      }}>
        <span style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.2em', color: T.textDim }}>
          © 2026 VELION MYTHERA
        </span>
        <span style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.2em', color: T.textDim }}>
          IN DEVELOPMENT · EARLY ACCESS COMING SOON
        </span>
      </footer>

      <style>{`
        @keyframes pulse-badge {
          0%, 100% { opacity: 0.85; box-shadow: 0 0 0 0 rgba(196,146,42,0); }
          50%       { opacity: 1;    box-shadow: 0 0 14px 2px rgba(196,146,42,0.15); }
        }
        @keyframes float-down {
          0%, 100% { transform: translateX(-50%) translateY(0px); }
          50%       { transform: translateX(-50%) translateY(7px); }
        }
        input[type="email"]::placeholder,
        input[type="text"]::placeholder  { color: #3a3228; }
        input:focus { outline: none; border-color: rgba(196,146,42,0.5) !important; }
      `}</style>
    </div>
  );
}