import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', goldDim: '#5a3e10', text: '#e4d8c0', textMuted: '#706858', textDim: '#504538',
  rp: '#4a9de8',
};

/** Edit this list for dev / release notes shown on the logged-in home page. */
const PATCH_NOTES: { date: string; items: string[] }[] = [
  {
    date: '2026-05-08',
    items: [
      'OAuth sign-in (Google, Twitch, Discord) with session handoff after popup.',
      'Character portrait uploads via R2; signed read URLs for display.',
      'Global typography scale and character sheet width tweak.',
      'VTT dice flow: results commit to the dice log without extra overlays.',
    ],
  },
];

function capTier(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

export default function HomeAuthenticated() {
  const user = useAuthStore((s) => s.user);
  const name = user?.display_name?.trim() || 'Traveler';
  const tier = user?.subscription_tier ?? 'free';
  const isFree = tier === 'free';
  const isDm = tier === 'dm';

  return (
    <div className="page-enter" style={{
      color: T.text,
      fontFamily: "'EB Garamond', serif",
      padding: '40px 28px 64px',
      maxWidth: '1040px',
      margin: '0 auto',
    }}>
      <header style={{ marginBottom: '40px' }}>
        <div style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '13px',
          letterSpacing: '0.28em',
          color: T.textMuted,
          marginBottom: '10px',
        }}>
          WELCOME BACK
        </div>
        <h1 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: 'clamp(26px, 4vw, 34px)',
          color: T.gold,
          letterSpacing: '0.1em',
          fontWeight: 600,
          margin: '0 0 12px',
        }}>
          {name}
        </h1>
        <p style={{ color: T.textMuted, fontSize: '19px', lineHeight: 1.65, maxWidth: '640px', margin: 0 }}>
          This is your command center for Velion Mythera — characters, campaigns, the workshop, and the compendium.
          Use the shortcuts below to jump in, or browse the top navigation anytime.
        </p>
        <div style={{
          marginTop: '16px',
          fontFamily: "'Cinzel', serif",
          fontSize: '13px',
          letterSpacing: '0.12em',
          color: T.textDim,
        }}>
          Account · <span style={{ color: isDm ? T.gold : T.textMuted }}>{capTier(tier)}</span>
          {isFree && (
            <span style={{ color: T.textMuted, marginLeft: '8px' }}>
              — Free tier includes up to 3 characters. Upgrade for unlimited sheets and workshop writes.
            </span>
          )}
        </div>
      </header>

      {/* CTAs */}
      <section style={{ marginBottom: '44px' }}>
        <h2 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '15px',
          letterSpacing: '0.2em',
          color: T.textMuted,
          margin: '0 0 18px',
        }}>
          QUICK ACTIONS
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '14px',
        }}>
          <Link to="/characters/new" style={{ textDecoration: 'none' }}>
            <div style={ctaCardStyle}>
              <span style={ctaGlyph}>✦</span>
              <div style={ctaTitle}>Create a character</div>
              <p style={ctaDesc}>Open the wizard and roll a new hero for table or solo play.</p>
            </div>
          </Link>
          <Link to="/characters" style={{ textDecoration: 'none' }}>
            <div style={ctaCardStyle}>
              <span style={ctaGlyph}>⚔</span>
              <div style={ctaTitle}>Your roster</div>
              <p style={ctaDesc}>Open existing sheets, edit gear, and track HP and RP.</p>
            </div>
          </Link>
          <Link to="/homebrew" style={{ textDecoration: 'none' }}>
            <div style={ctaCardStyle}>
              <span style={ctaGlyph}>⚒</span>
              <div style={ctaTitle}>Workshop</div>
              <p style={ctaDesc}>Homebrew weapons, armor, and items. Paid tiers unlock publishing tools.</p>
            </div>
          </Link>
          <Link to="/campaigns" style={{ textDecoration: 'none' }}>
            <div style={ctaCardStyle}>
              <span style={ctaGlyph}>🗺</span>
              <div style={ctaTitle}>Campaigns</div>
              <p style={ctaDesc}>{isDm ? 'Run sessions, manage the table, launch the VTT.' : 'See games you are in and join with an invite.'}</p>
            </div>
          </Link>
          <Link to="/library/weapons" style={{ textDecoration: 'none' }}>
            <div style={ctaCardStyle}>
              <span style={ctaGlyph}>📚</span>
              <div style={ctaTitle}>Library</div>
              <p style={ctaDesc}>Official gear and reference — weapons, armor, and more.</p>
            </div>
          </Link>
          <Link to="/compendium" style={{ textDecoration: 'none' }}>
            <div style={ctaCardStyle}>
              <span style={ctaGlyph}>📖</span>
              <div style={ctaTitle}>Compendium</div>
              <p style={ctaDesc}>Rules and lore reference for players and DMs.</p>
            </div>
          </Link>
          <Link to="/account" style={{ textDecoration: 'none' }}>
            <div style={{ ...ctaCardStyle, borderTopColor: `${T.gold}88` }}>
              <span style={ctaGlyph}>⬡</span>
              <div style={ctaTitle}>Account</div>
              <p style={ctaDesc}>Profile, sign-in methods, subscription, and Stripe billing portal.</p>
            </div>
          </Link>
        </div>
      </section>

      {/* Orientation */}
      <section style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: '4px',
        padding: '28px 28px',
        marginBottom: '40px',
      }}>
        <h2 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '15px',
          letterSpacing: '0.2em',
          color: T.gold,
          margin: '0 0 14px',
        }}>
          HOW THIS APP FITS TOGETHER
        </h2>
        <ul style={{ margin: 0, paddingLeft: '22px', color: T.textMuted, fontSize: '18px', lineHeight: 1.7 }}>
          <li><strong style={{ color: T.text }}>Characters</strong> — Build and level PCs; the sheet is the source of truth for RP, saves, and gear.</li>
          <li><strong style={{ color: T.text }}>Campaigns</strong> — DMs create worlds and launch VTT sessions; players join with a link.</li>
          <li><strong style={{ color: T.text }}>Workshop</strong> — Draft homebrew that plugs into sheets and tables according to your subscription.</li>
          <li><strong style={{ color: T.text }}>Library & Compendium</strong> — Official content and reading; use them alongside any character.</li>
        </ul>
      </section>

      {/* Patch notes */}
      <section>
        <h2 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '15px',
          letterSpacing: '0.2em',
          color: T.textMuted,
          margin: '0 0 18px',
        }}>
          DEV PATCH NOTES
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {PATCH_NOTES.map((block) => (
            <div
              key={block.date}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderTop: `2px solid ${T.goldDim}`,
                borderRadius: '4px',
                padding: '22px 24px',
              }}
            >
              <div style={{
                fontFamily: "'Cinzel', serif",
                fontSize: '13px',
                letterSpacing: '0.14em',
                color: T.rp,
                marginBottom: '12px',
              }}>
                {block.date}
              </div>
              <ul style={{ margin: 0, paddingLeft: '20px', color: T.textMuted, fontSize: '17px', lineHeight: 1.65 }}>
                {block.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p style={{ color: T.textDim, fontSize: '15px', fontStyle: 'italic', marginTop: '16px' }}>
          Notes are maintained in <code style={{ color: T.textMuted }}>HomeAuthenticated.tsx</code> — edit the <code style={{ color: T.textMuted }}>PATCH_NOTES</code> array to publish updates.
        </p>
      </section>
    </div>
  );
}

const ctaCardStyle: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderTop: `2px solid ${T.goldDim}`,
  borderRadius: '4px',
  padding: '20px 20px',
  height: '100%',
  transition: 'background 0.15s, border-color 0.15s',
  cursor: 'pointer',
};

const ctaGlyph: CSSProperties = {
  fontSize: '22px',
  display: 'block',
  marginBottom: '10px',
  opacity: 0.85,
};

const ctaTitle: CSSProperties = {
  fontFamily: "'Cinzel', serif",
  fontSize: '15px',
  letterSpacing: '0.12em',
  color: T.gold,
  marginBottom: '8px',
};

const ctaDesc: CSSProperties = {
  margin: 0,
  color: T.textMuted,
  fontSize: '17px',
  lineHeight: 1.55,
};
