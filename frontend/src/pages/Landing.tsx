import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  bg:        '#080b10',
  surface:   '#0d1018',
  card:      '#111520',
  border:    '#1c2230',
  gold:      '#c4922a',
  goldDim:   '#6a4212',
  goldFaint: '#c4922a14',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  textDim:   '#504538',
  rp:        '#3ab5e8',
  rpDim:     '#1a4a5e',
};

// ── Data ──────────────────────────────────────────────────────────────────────
const ABSENT = [
  {
    image: '/no_classes.png',
    note:  'No preset roles or locked archetypes. Your character is defined by what they carry and how they fight — not a menu selection made before the first session.',
  },
  {
    image: '/no_spell_slots.png',
    note:  'No daily resource caps on magic. Spell Gems channel through the same RP pool as every other action. Commitment, not quotas.',
  },
  {
    image: '/no_initiative.png',
    note:  'No random turn order. Combat runs on alternating sides — narrative momentum determines who moves first, not a d20 roll before anything happens.',
  },
  {
    image: '/no_skill_tree.png',
    note:  'No progression gating or locked feat paths. Attributes grow freely at each level. No node unlocks what should already be possible.',
  },
  {
    image: '/no_racial_bonuses.png',
    note:  'No biological stat assignments tied to ancestry. Every character starts from the same four attributes, shaped by play — not by species.',
  },
  {
    image: '/no_action_types.png',
    note:  'No action, bonus action, or reaction split. One resource drives everything. What you spend attacking is simply no longer available to defend.',
  },
];

const PLATFORM_FEATURES = [
  {
    image: '/about_platform-compendium.png',
    label: 'Living Compendium',
    desc:  'The full rules reference, always current. DM sections visible only to those running the table.',
  },
  {
    image: '/about_platform-campaigns.png',
    label: 'Campaign Tools',
    desc:  'Create and manage campaigns. Session tracking, encounter building, and table management for DMs.',
  },
  {
    image: '/about_platform-workshop.png',
    label: 'Homebrew Workshop',
    desc:  'Author custom weapons, armor, items, pets, and creatures. Keep them private or publish to the community.',
  },
  {
    image: '/about_platform-library.png',
    label: 'Shared Library',
    desc:  'Community-created content alongside official material. Browse, add to your sheet, bring it to the table.',
  },
];

// ── Inner content wrapper ─────────────────────────────────────────────────────
const Inner = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '0 40px', ...style }}>
    {children}
  </div>
);

// ── ArtworkSlot ───────────────────────────────────────────────────────────────
type ArtworkSlotProps = {
  src?:          string;
  alt?:          string;
  intent:        string;
  atmosphere:    string;
  style?:        React.CSSProperties;
  fade?:         'bottom' | 'right' | 'left' | 'none';
  imageOpacity?: number;
  className?:    string;
};

function ArtworkSlot({ src, alt, intent, atmosphere, style = {}, fade = 'bottom', imageOpacity = 1, className }: ArtworkSlotProps) {
  const fadeGradients: Record<string, string> = {
    bottom: `linear-gradient(to bottom, transparent 30%, ${T.bg} 100%)`,
    right:  `linear-gradient(to right,  transparent 40%, ${T.bg} 100%)`,
    left:   `linear-gradient(to left,   transparent 40%, ${T.bg} 100%)`,
    none:   'none',
  };
  const fadeOverlay = fadeGradients[fade];
  const base: React.CSSProperties = { position: 'relative', overflow: 'hidden', borderRadius: '3px', ...style };

  if (src) {
    return (
      <div className={className} style={base}>
        <img src={src} alt={alt ?? intent}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: imageOpacity }} />
        {fade !== 'none' && <div style={{ position: 'absolute', inset: 0, background: fadeOverlay }} />}
      </div>
    );
  }

  return (
    <div className={className} style={{ ...base, background: atmosphere, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.04,
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 3px, ${T.gold} 3px, ${T.gold} 4px)` }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse at center, transparent 30%, ${T.bg}bb 100%)` }} />
      {fade !== 'none' && <div style={{ position: 'absolute', inset: 0, background: fadeOverlay, pointerEvents: 'none' }} />}
      <div style={{ zIndex: 1, textAlign: 'center', padding: '0 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.45em', color: T.textDim }}>ARTWORK</div>
        <div style={{ fontFamily: "'EB Garamond', serif", fontStyle: 'italic', fontSize: '15px', color: T.textDim, maxWidth: '360px', lineHeight: 1.5 }}>
          {intent}
        </div>
      </div>
    </div>
  );
}

// ── AbsentCard ────────────────────────────────────────────────────────────────
// Desktop (fine pointer + hover): CSS :hover dims poster and shows overlay.
// Touch / coarse pointer: no dim; description is only in .absent-mobile-note below the image.
function AbsentCard({ image, note }: { image: string; note: string }) {
  return (
    <div className="absent-card">
      <img className="absent-card-poster" src={image} alt="" />

      <div className="absent-card-hover-overlay" aria-hidden>
        <p>{note}</p>
      </div>

      {/* Mobile fallback — hidden on desktop via media query */}
      <div className="absent-mobile-note" style={{
        display: 'none',
        padding: '14px 16px',
        background: T.card,
        borderTop: `1px solid ${T.border}`,
      }}>
        <p style={{
          fontFamily: "'EB Garamond', serif",
          fontSize: '14px', color: T.textMuted,
          lineHeight: 1.65, margin: 0,
        }}>
          {note}
        </p>
      </div>
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.4em', color: T.textDim, marginBottom: '16px' }}>
    {children}
  </div>
);

const SectionHead = ({ children, color = T.gold }: { children: React.ReactNode; color?: string }) => (
  <h2 style={{
    fontFamily: "'Cinzel', serif", fontSize: 'clamp(24px, 3vw, 36px)',
    letterSpacing: '0.12em', color, margin: '0 0 20px', fontWeight: 600, lineHeight: 1.2,
  }}>
    {children}
  </h2>
);

const Body = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <p style={{ fontFamily: "'EB Garamond', serif", fontSize: '19px', color: T.text, lineHeight: 1.85, margin: '0 0 16px', ...style }}>
    {children}
  </p>
);

const Rule = () => (
  <div style={{ height: '1px', background: `linear-gradient(to right, ${T.goldDim}, transparent)`, margin: '0 0 20px' }} />
);

const inputBase: React.CSSProperties = {
  width:           '100%',
  boxSizing:       'border-box',
  fontFamily:      "'EB Garamond', serif",
  fontSize:        '17px',
  color:           T.text,
  background:      T.surface,
  border:          `1px solid ${T.border}`,
  borderRadius:    '3px',
  padding:         '10px 12px',
  outline:         'none',
};

// ── Early access signup (hero, right column) ─────────────────────────────────
function EarlyAccessSignupCard() {
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [enlisted, setEnlisted] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const { data } = await api.get<{ count: number }>('/early-access/count');
      setEnlisted(typeof data.count === 'number' ? data.count : 0);
    } catch {
      setEnlisted(0);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Email is required.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/early-access', {
        email:  trimmed,
        name:   name.trim() || undefined,
        source: 'landing',
      });
      setDone(true);
      setEmail('');
      setName('');
      await refreshCount();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      id="early-access-waitlist"
      className="landing-early-access-card"
      style={{
        width:         '100%',
        background:    `${T.card}ee`,
        backdropFilter:'blur(8px)',
        border:        `1px solid ${T.border}`,
        borderRadius:  '4px',
        padding:       '24px 22px 20px',
        boxShadow:     `0 12px 40px ${T.bg}99`,
      }}
    >
      <div style={{
        fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.35em',
        color: T.textDim, marginBottom: '10px',
      }}>
        EARLY ACCESS
      </div>
      <h2 style={{
        fontFamily: "'Cinzel', serif", fontSize: 'clamp(17px, 1.6vw, 22px)',
        letterSpacing: '0.1em', color: T.gold, fontWeight: 600, margin: '0 0 16px', lineHeight: 1.35,
      }}>
        Join the waitlist
      </h2>
      {done ? (
        <p style={{
          fontFamily: "'EB Garamond', serif", fontSize: '17px', color: T.textMuted,
          lineHeight: 1.65, margin: 0, fontStyle: 'italic',
        }}>
          You are on the list. We will email you when the doors open.
        </p>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label htmlFor="ea-name" style={{ display: 'block', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '6px' }}>
              Name <span style={{ color: T.textDim, fontStyle: 'italic', letterSpacing: '0.05em' }}>(optional)</span>
            </label>
            <input
              id="ea-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              style={inputBase}
            />
          </div>
          <div>
            <label htmlFor="ea-email" style={{ display: 'block', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '6px' }}>
              Email
            </label>
            <input
              id="ea-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              style={inputBase}
            />
          </div>
          {error && (
            <p style={{ margin: 0, fontFamily: "'EB Garamond', serif", fontSize: '15px', color: '#c45c5c' }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            style={{
              fontFamily:     "'Cinzel', serif",
              fontSize:       '12px',
              letterSpacing:  '0.14em',
              color:          T.bg,
              background:     submitting ? T.goldDim : T.gold,
              padding:        '12px 16px',
              borderRadius:   '3px',
              border:         'none',
              fontWeight:     600,
              cursor:         submitting ? 'wait' : 'pointer',
              marginTop:      '4px',
            }}
          >
            {submitting ? 'Sending…' : 'Notify me at launch'}
          </button>
        </form>
      )}
      <p style={{
        fontFamily: "'EB Garamond', serif",
        fontSize:   '15px',
        color:        T.textMuted,
        textAlign:    'center',
        margin:       '18px 0 0',
        fontStyle:    'italic',
      }}>
        {enlisted === null ? (
          <span style={{ color: T.textDim }}>Counting enlistments…</span>
        ) : (
          <>
            <span style={{ color: T.gold, fontStyle: 'normal', fontWeight: 600 }}>{enlisted.toLocaleString()}</span>
            {' '}Adventurer{enlisted === 1 ? '' : 's'} already enlisted
          </>
        )}
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Landing() {
  return (
    <div className="page-enter" style={{ background: T.bg, color: T.text, fontFamily: "'EB Garamond', serif" }}>

      {/* Mobile styles */}
      <style>{`
        /* Full-bleed hero shell — avoids max-width + auto margin that centers the whole row */
        #early-access-waitlist {
          scroll-margin-top: 96px;
        }
        .landing-hero-shell {
          width: 100%;
          box-sizing: border-box;
          margin: 0;
          padding-left: clamp(24px, 5vw, 120px);
          padding-right: clamp(24px, 4vw, 72px);
        }
        .landing-hero-inner {
          display: grid;
          /* Copy | form | flexible margin — extra width goes right of the form, not between columns */
          grid-template-columns: minmax(0, 800px) minmax(260px, 380px) minmax(0, 1fr);
          align-items: start;
          column-gap: clamp(28px, 4vw, 56px);
          row-gap: 48px;
          width: 100%;
        }
        .landing-hero-copy {
          justify-self: start;
          text-align: left;
          min-width: 0;
        }
        .landing-hero-inner .landing-early-access-card {
          justify-self: start;
          width: 100%;
          max-width: 380px;
        }
        @media (min-width: 961px) {
          .landing-hero-inner .landing-early-access-card {
            margin-left: clamp(200px, 3.5vw, 64px);
          }
        }
        /* WHAT IS VELION MYTHERA — narrow viewports: keep copy on the right over the fade, not on the art */
        @media (max-width: 768px) {
          .landing-what-is-fade {
            background: linear-gradient(to right, transparent 0%, transparent 6%, ${T.bg}88 36%, ${T.bg}d8 48%, ${T.bg} 58%) !important;
          }
          .landing-what-is .landing-what-is-slot img {
            object-position: 24% center;
          }
          .landing-what-is-copy {
            justify-content: flex-end !important;
            padding-top: 44px !important;
            padding-bottom: 44px !important;
            padding-right: clamp(10px, 3.5vw, 20px) !important;
            padding-left: clamp(26vw, 32vw, 200px) !important;
          }
          /* RP ECONOMY — copy stays left; solid surface on left, art on right */
          .landing-rp-economy-fade {
            background: linear-gradient(to right, ${T.surface} 0%, ${T.surface}ee 28%, ${T.surface}cc 40%, ${T.surface}88 52%, transparent 76%, transparent 100%) !important;
          }
          .landing-rp-economy .landing-rp-economy-slot img {
            object-position: 78% center;
          }
          .landing-rp-economy-copy {
            justify-content: flex-start !important;
            padding-top: 44px !important;
            padding-bottom: 44px !important;
            padding-left: clamp(10px, 3.5vw, 20px) !important;
            padding-right: clamp(26vw, 32vw, 200px) !important;
          }
          /* BUILT FOR THE TABLE — copy stays right; solid bg on right, art on left */
          .landing-built-for-fade {
            background: linear-gradient(to right, transparent 0%, transparent 6%, ${T.bg}88 36%, ${T.bg}d8 48%, ${T.bg} 58%) !important;
          }
          .landing-built-for-table .landing-built-for-slot img {
            object-position: 72% center;
          }
          .landing-built-for-copy {
            justify-content: flex-end !important;
            padding-top: 44px !important;
            padding-bottom: 44px !important;
            padding-right: clamp(10px, 3.5vw, 20px) !important;
            padding-left: clamp(26vw, 32vw, 200px) !important;
          }
          /* CHARACTER SHEETS flagship — copy stays left; solid surface on left, sheet on right */
          .landing-platform-sheet-fade {
            background: linear-gradient(to right, ${T.surface} 0%, ${T.surface}ee 26%, ${T.surface}dd 38%, ${T.surface}bb 48%, ${T.surface}99 56%, transparent 78%, transparent 100%) !important;
          }
          .landing-platform-sheet-copy {
            padding-top: 32px !important;
            padding-bottom: 32px !important;
            padding-left: clamp(10px, 3.5vw, 20px) !important;
            padding-right: clamp(26vw, 32vw, 200px) !important;
            max-width: min(440px, 100%) !important;
          }
        }
        @media (max-width: 960px) {
          .landing-hero-inner {
            grid-template-columns: 1fr;
            align-items: start;
          }
          .landing-hero-inner .landing-early-access-card {
            justify-self: start;
            max-width: 420px;
          }
        }
        /* AbsentCard — poster dim + overlay only when real hover is available (desktop mouse) */
        .absent-card {
          position: relative;
        }
        .absent-card-poster {
          width: 100%;
          display: block;
          transition: opacity 0.35s ease;
        }
        .absent-card-hover-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          opacity: 0;
          transition: opacity 0.35s ease;
          pointer-events: none;
          background: ${T.bg}33;
        }
        .absent-card-hover-overlay p {
          font-family: 'EB Garamond', serif;
          font-size: clamp(13px, 1.1vw, 16px);
          color: ${T.text};
          line-height: 1.75;
          text-align: center;
          margin: 0;
        }
        @media (min-width: 769px) and (hover: hover) and (pointer: fine) {
          .absent-card:hover .absent-card-poster {
            opacity: 0.2;
          }
          .absent-card:hover .absent-card-hover-overlay {
            opacity: 1;
          }
        }
        @media (hover: none), (max-width: 768px) {
          .absent-mobile-note  { display: block !important; }
          .absent-grid         { grid-template-columns: repeat(2, 1fr) !important; }
          .platform-grid       { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 480px) {
          .absent-grid         { grid-template-columns: 1fr !important; }
          .platform-grid       { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ══════════════════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════════════════ */}
      <section style={{
          position: 'relative',
          height: '1000px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          backgroundImage: 'url(/about_hero.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
        }}>
        {/* Bottom fade overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(to bottom, transparent 30%, ${T.bg} 100%)`,
          pointerEvents: 'none',
        }} />
        {/* Low opacity tint to dim the image */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `${T.bg}d4`,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', zIndex: 1, left: 0, right: 0, bottom: 0,
          paddingBottom: 'clamp(160px, 18vw, 320px)',
          paddingTop: 'clamp(56px, 7vh, 100px)',
        }}>
          <div className="landing-hero-shell">
            <div className="landing-hero-inner">
              <div className="landing-hero-copy">
                <h1 style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: 'clamp(32px, 5vw, 64px)',
                  letterSpacing: '0.08em',
                  color: T.gold, fontWeight: 600, lineHeight: 1.15,
                  margin: '0 0 28px',
                }}>
                  The System Serves the Story.
                </h1>
                <p style={{
                  fontFamily: "'EB Garamond', serif", fontSize: 'clamp(18px, 2vw, 22px)',
                  color: T.textMuted, lineHeight: 1.75, maxWidth: '560px', margin: 0,
                  fontStyle: 'italic',
                }}>
                  A fully original tabletop RPG system — and the platform built to play it.
                </p>
              </div>
              <EarlyAccessSignupCard />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          WHAT IS VELION MYTHERA
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="landing-what-is" style={{ position: 'relative', minHeight: '680px', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <ArtworkSlot
          className="landing-what-is-slot"
          src="/about_what-is-velion.png"
          intent="Hulky mage in star-covered robes — calm, composed, impossible build. Purple robes, dark background."
          atmosphere={`radial-gradient(ellipse at 30% 50%, #1a0c2a 0%, #0e0818 45%, ${T.bg} 100%)`}
          fade="none"
          imageOpacity={1}
          style={{ position: 'absolute', inset: 0, borderRadius: 0 }}
        />
        <div
          className="landing-what-is-fade"
          style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(to right, transparent 0%, transparent 35%, ${T.bg}cc 55%, ${T.bg} 75%)`,
            pointerEvents: 'none',
          }}
        />
        <div className="landing-what-is-copy" style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', justifyContent: 'flex-end', padding: '0 120px 0 0' }}>
          <div className="landing-what-is-copy-inner" style={{ maxWidth: '500px' }}>
            <SectionLabel>WHAT IS VELION MYTHERA</SectionLabel>
            <Rule />
            <SectionHead>Not a Reskin.<br />A New System.</SectionHead>
            <Body>
              Velion Mythera was built from the ground up — not on top of another game. There are no class
              restrictions, no spell slots, no initiative rolls, and no ancestry mechanics. Every character
              is defined by four attributes and the equipment they carry.
            </Body>
            <Body style={{ color: T.textMuted }}>
              Archetypes emerge through play, not through choices made before the first session. The system
              exists to clarify tension and consequence, then step aside so the table can breathe.
            </Body>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          HOW IT DIFFERS — poster grid, hover to reveal description
      ══════════════════════════════════════════════════════════════════════ */}
      <section style={{ background: T.bg, padding: '20px 0' }}>
        <Inner>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <SectionLabel>HOW IT DIFFERS</SectionLabel>
            <Rule />
            <SectionHead>Everything You Won't Find Here</SectionHead>
            <p style={{
              fontFamily: "'EB Garamond', serif", fontSize: '19px',
              color: T.textMuted, lineHeight: 1.75, maxWidth: '600px', margin: '0 auto', fontStyle: 'italic',
            }}>
              Velion Mythera doesn't borrow the furniture from other systems. It starts from a blank room.
            </p>
          </div>
        </Inner>

        {/* Full-width grid — no Inner so posters bleed to viewport edges */}
        <div
          className="absent-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0 }}
        >
          {ABSENT.map(({ image, note }, i) => (
            <AbsentCard key={i} image={image} note={note} />
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          RP ECONOMY — full-bleed artwork, combat image right, text left
          Image fades right-to-left into T.surface so text sits in clean space.
          Replace atmosphere with src="/about_rp-economy.png" when ready.
          Intent: two figures in combat — high contrast, motion blur, tension.
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="landing-rp-economy" style={{ position: 'relative', minHeight: '680px', display: 'flex', alignItems: 'center', overflow: 'hidden', background: T.surface }}>
        {/* Full-bleed artwork */}
        <ArtworkSlot
          className="landing-rp-economy-slot"
          src="/about_rp_economy.png"
          intent="Two figures in combat — high contrast, motion blur, physical tension. Combat image that backs the pull quote."
          atmosphere={`radial-gradient(ellipse at 70% 50%, #1a0808 0%, #0e0606 45%, ${T.surface} 100%)`}
          fade="none"
          style={{ position: 'absolute', inset: 0, borderRadius: 0 }}
        />
        {/* Right-to-left gradient — image lives right, text lives left */}
        <div
          className="landing-rp-economy-fade"
          style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(to left, transparent 0%, transparent 35%, ${T.surface}cc 55%, ${T.surface} 75%)`,
            pointerEvents: 'none',
          }}
        />
        {/* Copy anchored to the left */}
        <div className="landing-rp-economy-copy" style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', justifyContent: 'flex-start', padding: '0 0 0 120px' }}>
          <div className="landing-rp-economy-copy-inner" style={{ maxWidth: '500px' }}>
            <SectionLabel>THE RESOURCE POINT ECONOMY</SectionLabel>
            <Rule />
            <div style={{
              fontFamily: "'Cinzel', serif",
              fontSize: 'clamp(20px, 2.5vw, 30px)',
              letterSpacing: '0.08em', color: T.gold,
              lineHeight: 1.5, fontWeight: 600,
              borderLeft: `3px solid ${T.goldDim}`,
              paddingLeft: '24px', margin: '0 0 32px',
            }}>
              Aggression and exposure<br />are two faces of<br />the same choice.
            </div>
            <Body style={{ color: T.textMuted }}>
              In combat, every meaningful action draws from a single shared pool. What you pour into a strike
              is not there when you need to brace, dodge, or answer in kind.
            </Body>
            <Body style={{ color: T.textMuted }}>
              Nothing is free. Every round tells a story about what the party was willing to risk.
            </Body>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          BUILT FOR THE TABLE — full-bleed artwork, characters right, copy right
          Image fades left-to-right into T.bg so copy sits in clean space on the right.
          objectPosition shifts focus toward the characters, cropping the owl.
          Replace atmosphere with src="/about_built-for-table.png" when ready.
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="landing-built-for-table" style={{ position: 'relative', minHeight: '680px', display: 'flex', alignItems: 'center', overflow: 'hidden', background: T.bg }}>
        {/* Full-bleed artwork — objectPosition pushes focus right, crops owl */}
        <div className="landing-built-for-slot" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <img
            src="/about_built-for-table.png"
            alt="A diverse party of fantasy characters laughing around a candlelit table covered in maps and dice."
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: '65% center',
              display: 'block',
            }}
          />
        </div>
        {/* Left-to-right gradient — image lives left, text lives right */}
        <div
          className="landing-built-for-fade"
          style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(to right, transparent 0%, transparent 30%, ${T.bg}cc 52%, ${T.bg} 70%)`,
            pointerEvents: 'none',
          }}
        />
        {/* Copy anchored to the right */}
        <div className="landing-built-for-copy" style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', justifyContent: 'flex-end', padding: '0 120px 0 0' }}>
          <div className="landing-built-for-copy-inner" style={{ maxWidth: '500px' }}>
            <SectionLabel>BUILT FOR THE TABLE</SectionLabel>
            <Rule />
            <SectionHead>Less Overhead.<br />More Story.</SectionHead>
            <Body>
              Velion Mythera is written to reduce mechanical overhead so the Dungeon Master and players can
              stay in the fiction. The action economy speaks one language across the whole game.
            </Body>
            <Body style={{ color: T.textMuted }}>
              Character creation is built to get you to the first scene with a clear sense of who you are —
              not to front-load every option the system will ever offer. Fewer interruptions. Fewer lookups.
              More room for the story the table is actually telling.
            </Body>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          THE PLATFORM
          Character sheet is the flagship — full-width with slow pan animation.
          Four supporting features use the same hover-reveal treatment as
          "How It Differs". Add src images when artwork is ready.
      ══════════════════════════════════════════════════════════════════════ */}
      <section style={{ background: T.surface, padding: '20px 0 0' }}>
        <Inner>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <SectionLabel>THE PLATFORM</SectionLabel>
            <Rule />
            <SectionHead>Everything You Need at the Table</SectionHead>
            <p style={{
              fontFamily: "'EB Garamond', serif", fontSize: '19px',
              color: T.textMuted, lineHeight: 1.75, maxWidth: '560px',
              margin: '0 auto', fontStyle: 'italic',
            }}>
              Velion is the digital home for playing and preparing that game. The software supports the system
              and the people around it — not the other way around.
            </p>
          </div>
        </Inner>

        {/* ── Character Sheet flagship — pan animation ── */}
        <style>{`
          @keyframes panSheet {
            0%   { transform: translateY(0); }
            100% { transform: translateY(-84%); }
          }
        `}</style>
        <div className="landing-platform-sheet" style={{ position: 'relative', height: '560px', overflow: 'hidden', marginBottom: '2px' }}>
          {/* Panning screenshot */}
          <img
            src="/about_platform-hero.png"
            alt="Velion Mythera character sheet showing attributes, resource points, armor, weapons, and active states."
            style={{
              width: '100%', display: 'block',
              animation: 'panSheet 120s ease-in-out infinite alternate',
            }}
          />
          {/* Deep fade on left so copy sits cleanly, sheet lives on the right */}
          <div
            className="landing-platform-sheet-fade"
            style={{
              position: 'absolute', inset: 0,
              background: `linear-gradient(to right, ${T.surface} 0%, ${T.surface}ee 30%, ${T.surface}88 60%, transparent 70%)`,
            }}
          />
          {/* Copy over the left side */}
          <div
            className="landing-platform-sheet-copy"
            style={{
              position: 'absolute', top: 0, bottom: 0, left: 0,
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              padding: '0 0 0 120px', maxWidth: '440px',
            }}
          >
            <SectionLabel>CHARACTER SHEETS</SectionLabel>
            <Rule />
            <SectionHead>Built for<br />the System.</SectionHead>
            <Body>
              Every stat, active state, piece of gear, and resource — tracked in one place. The sheet is
              built specifically for Velion Mythera, not adapted from a generic template.
            </Body>
            <Body style={{ color: T.textMuted }}>
              Attributes, RP, HP, armor mitigation, weapon channels, spell gems, active states, factions,
              inventory, pets, and session notes — all in a single living document.
            </Body>
          </div>
        </div>

        {/* ── Four supporting features — hover reveal ── */}
        <div
          className="platform-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}
        >
          {PLATFORM_FEATURES.map(({ image, label, desc }, i) => (
            <AbsentCard key={i} image={image} note={desc} />
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FOOTER CTA — early access waitlist
      ══════════════════════════════════════════════════════════════════════ */}
      <section style={{ background: T.bg, padding: '20px 0', borderTop: `1px solid ${T.border}` }}>
        <Inner style={{ textAlign: 'center' }}>
          <SectionLabel>EARLY ACCESS</SectionLabel>
          <h2 style={{
            fontFamily: "'Cinzel', serif", fontSize: 'clamp(22px, 3vw, 34px)',
            letterSpacing: '0.1em', color: T.text, fontWeight: 600, margin: '0 0 16px',
          }}>
            Get notified at launch.
          </h2>
          <p style={{
            fontFamily: "'EB Garamond', serif", fontSize: '18px',
            color: T.textMuted, lineHeight: 1.75, maxWidth: '460px',
            margin: '0 auto 28px', fontStyle: 'italic',
          }}>
            Join the waitlist with your email — name optional. We will only write you when the game and the platform are ready to open.
          </p>
          <a
            href="#early-access-waitlist"
            style={{
              fontFamily: "'Cinzel', serif", fontSize: '14px', letterSpacing: '0.18em',
              color: T.bg, background: T.gold, padding: '12px 36px',
              borderRadius: '3px', textDecoration: 'none', fontWeight: 600,
              display: 'inline-block',
            }}
          >
            Go to waitlist
          </a>
        </Inner>
      </section>
 
    </div>
  );
}