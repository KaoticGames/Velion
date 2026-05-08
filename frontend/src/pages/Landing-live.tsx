import { Link } from 'react-router-dom';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', goldDim: '#5a3e10', text: '#e4d8c0', textMuted: '#706858',
};

const features = [
  {
    icon: '⚔',
    title: 'Resource Point Combat',
    desc: 'Replace action slots with a unified RP economy. Every swing, spell, and defensive maneuver flows from a single commitment pool.',
  },
  {
    icon: '🎲',
    title: 'Save-First Resolution',
    desc: 'Defenders react before damage is confirmed. Every attack is a genuine contest — not a passive roll against a static target.',
  },
  {
    icon: '💎',
    title: 'Spell Gem Magic',
    desc: 'No spell slots. No memorized lists. Crystallized magic embedded in Focus Bracers, auto-hitting and scaling with committed RP.',
  },
  {
    icon: '🏰',
    title: 'No Class Restrictions',
    desc: 'Equipment defines identity. A mage in plate armour is valid. A duelist channeling lightning through twin daggers is valid. Build freely.',
  },
  {
    icon: '📈',
    title: 'Infinite Scaling',
    desc: 'No level cap. No attribute ceiling. Characters grow from 300 HP at level 1 to 100,000+ at level 20 — and the math stays balanced.',
  },
  {
    icon: '🌐',
    title: 'Digital-First VTT',
    desc: 'Built for screens, not paper. Automated combat math, live session sync, fog of war, and browser source overlays for streaming.',
  },
];

const tiers = [
  {
    name:  'Free',
    price: '$0',
    color: T.textMuted,
    perks: ['Up to 3 characters', 'Character sheet access', 'Join campaigns as player', 'Compendium reference'],
    cta:   'Start Free',
    href:  '/register',
  },
  {
    name:  'Player',
    price: '$X/mo',
    color: '#4a9de8',
    perks: ['Unlimited characters', 'Join any campaign', 'Homebrew items (own use)', 'Browser source overlays'],
    cta:   'Join as Player',
    href:  '/register',
    highlight: false,
  },
  {
    name:  'Dungeon Master',
    price: '$X/mo',
    color: T.gold,
    perks: ['Everything in Player', 'Create & run campaigns', 'Encounter builder', 'Full bestiary library', 'Session management tools', 'Homebrew campaign-wide'],
    cta:   'Run Campaigns',
    href:  '/register',
    highlight: true,
  },
];

export default function Landing() {
  return (
    <div className="page-enter" style={{ color: T.text, fontFamily: "'EB Garamond', serif" }}>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section style={{
        minHeight:      'calc(100vh - 52px)',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        textAlign:      'center',
        padding:        '80px 24px',
        position:       'relative',
        overflow:       'hidden',
      }}>
        {/* Background radial glow */}
        <div style={{
          position:   'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 60% 50% at 50% 40%, #c4922a0a 0%, transparent 70%)',
        }} />

        <img
          src="/velion_full_logo.png"
          alt="Velion Mythera"
          style={{
            width: 'min(760px, 90vw)',
            height: 'auto',
            marginBottom: '32px',
            filter: 'drop-shadow(0 0 30px #c4922a33)',
          }}
        />

        <p style={{
          maxWidth:     '560px',
          fontSize: '22px',
          lineHeight:   '1.7',
          color:        T.textMuted,
          marginBottom: '48px',
          fontStyle:    'italic',
        }}>
          A digital-first TTRPG inspired by the grand traditions of the MMO and JRPG —
          where a character's power has no artificial ceiling, and the living narrator
          bends the world around your choices.
        </p>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link to="/register" style={{
            fontFamily:     "'Cinzel', serif",
            fontSize: '15px',
            letterSpacing:  '0.18em',
            textDecoration: 'none',
            color:          '#06070c',
            background:     T.gold,
            padding:        '14px 36px',
            borderRadius:   '3px',
            fontWeight:     '700',
          }}>
            BEGIN YOUR LEGEND
          </Link>
          <Link to="/compendium" style={{
            fontFamily:     "'Cinzel', serif",
            fontSize: '15px',
            letterSpacing:  '0.18em',
            textDecoration: 'none',
            color:          T.gold,
            border:         `1px solid ${T.gold}66`,
            padding:        '14px 36px',
            borderRadius:   '3px',
          }}>
            READ THE COMPENDIUM
          </Link>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.3em', color: T.textMuted, marginBottom: '12px' }}>
            THE SYSTEM
          </div>
          <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: '31px', color: T.gold, letterSpacing: '0.1em' }}>
            Built For Epic Scale
          </h2>
        </div>

        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap:                 '20px',
        }}>
          {features.map((f) => (
            <div key={f.title} style={{
              background:   T.card,
              border:       `1px solid ${T.border}`,
              borderTop:    `2px solid ${T.goldDim}`,
              borderRadius: '4px',
              padding:      '24px',
            }}>
              <div style={{ fontSize: '27px', marginBottom: '12px' }}>{f.icon}</div>
              <div style={{
                fontFamily:    "'Cinzel', serif",
                fontSize: '15px',
                letterSpacing: '0.12em',
                color:         T.gold,
                marginBottom:  '10px',
              }}>
                {f.title.toUpperCase()}
              </div>
              <p style={{ color: T.textMuted, fontSize: '18px', lineHeight: '1.6' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────── */}
      <section style={{
        padding:    '80px 24px',
        background: T.surface,
        borderTop:  `1px solid ${T.border}`,
        borderBottom:`1px solid ${T.border}`,
      }}>
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.3em', color: T.textMuted, marginBottom: '12px' }}>
              SUBSCRIPTIONS
            </div>
            <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: '31px', color: T.gold, letterSpacing: '0.1em' }}>
              Choose Your Role
            </h2>
          </div>

          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap:                 '20px',
          }}>
            {tiers.map((tier) => (
              <div key={tier.name} style={{
                background:   T.card,
                border:       `1px solid ${tier.highlight ? tier.color + '66' : T.border}`,
                borderTop:    `2px solid ${tier.color}`,
                borderRadius: '4px',
                padding:      '28px 24px',
                position:     'relative',
              }}>
                {tier.highlight && (
                  <div style={{
                    position:      'absolute', top: '-1px', right: '20px',
                    fontFamily:    "'Cinzel', serif", fontSize: '12px',
                    letterSpacing: '0.14em', color: '#06070c',
                    background:    T.gold, padding: '3px 10px', borderRadius: '0 0 3px 3px',
                  }}>
                    MOST POPULAR
                  </div>
                )}
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '17px', letterSpacing: '0.14em', color: tier.color, marginBottom: '6px' }}>
                  {tier.name.toUpperCase()}
                </div>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '35px', color: T.text, marginBottom: '20px' }}>
                  {tier.price}
                </div>
                <ul style={{ listStyle: 'none', marginBottom: '28px' }}>
                  {tier.perks.map((p) => (
                    <li key={p} style={{
                      color: T.textMuted, fontSize: '17px', padding: '4px 0',
                      borderBottom: `1px solid ${T.border}`,
                      display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                      <span style={{ color: tier.color, fontSize: '13px' }}>✦</span>
                      {p}
                    </li>
                  ))}
                </ul>
                <Link to={tier.href} style={{
                  display:        'block',
                  textAlign:      'center',
                  fontFamily:     "'Cinzel', serif",
                  fontSize: '14px',
                  letterSpacing:  '0.14em',
                  textDecoration: 'none',
                  color:          tier.highlight ? '#06070c' : tier.color,
                  background:     tier.highlight ? tier.color : 'transparent',
                  border:         `1px solid ${tier.color}`,
                  padding:        '11px',
                  borderRadius:   '3px',
                }}>
                  {tier.cta.toUpperCase()}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer style={{ padding: '32px 24px', textAlign: 'center', borderTop: `1px solid ${T.border}` }}>
        <p style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.2em', color: T.textMuted }}>
          © 2026 VELION MYTHERA · ALL RIGHTS RESERVED
        </p>
      </footer>
    </div>
  );
}
