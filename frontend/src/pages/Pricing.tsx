import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BILLING_PLAN_USD } from '@/lib/billingPlanDisplay';
import { useBillingPriceCatalog, type MergedStripePrices } from '@/hooks/useBillingPriceCatalog';
import { useAuthStore } from '@/store/authStore';

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  bg:        '#06070c',
  surface:   '#0a0c14',
  card:      '#0d1018',
  border:    '#1c2030',
  gold:      '#c4922a',
  goldDim:   '#6a4212',
  goldFaint: '#c4922a14',
  text:      '#e4d8c0',
  textMuted: '#706858',
  textDim:   '#504538',
  rp:        '#4a9de8',
  rpDim:     '#1a4a5e',
  green:     '#50a060',
};

// ── Tier definitions ──────────────────────────────────────────────────────────
type TierId = 'free' | 'player' | 'dm';

const TIERS = [
  {
    id:          'free' as TierId,
    name:        'Free',
    tagline:     'Try the system at the table',
    accent:      '#706858',
    monthly:     0,
    annual:      0,
    cta:         'Get Started',
    features: [
      { text: 'Up to **3** active characters', detail: 'Server-enforced limit' },
      { text: 'Full **character sheet** for each hero', detail: 'All stats, gear, and states tracked' },
      { text: '**Compendium** reference', detail: 'Full rules access while signed in' },
      { text: '**Join campaigns** by invite link', detail: 'Any tier account can join' },
      { text: '**Browse the library**', detail: 'Community and official content' },
      { text: 'Use library items on your sheets', detail: 'Weapons, armor, gems, and more' },
    ],
  },
  {
    id:          'player' as TierId,
    name:        'Player',
    tagline:     'Everything you need at the table',
    accent:      '#4a9de8',
    monthly:     BILLING_PLAN_USD.player.monthly,
    annual:      BILLING_PLAN_USD.player.annual,
    cta:         'Subscribe',
    ctaHref:     null,
    features: [
      { text: '**Unlimited** characters', detail: 'No cap — build as many as you want' },
      { text: 'Everything in **Free**', detail: 'Sheets, compendium, invites, library' },
      { text: '**Homebrew Workshop** access', detail: 'Create custom weapons, armor, gems, bracers, enemies, and pets' },
      { text: '**Publish** to the community library', detail: 'Share creations with all players' },
      { text: 'Keep creations **private** or go public', detail: 'Toggle per item' },
      { text: '**Duplicate detection** in the workshop', detail: 'Avoid accidental clones' },
    ],
  },
  {
    id:          'dm' as TierId,
    name:        'Dungeon Master',
    tagline:     'Run campaigns and the virtual table',
    accent:      '#c4922a',
    monthly:     BILLING_PLAN_USD.dm.monthly,
    annual:      BILLING_PLAN_USD.dm.annual,
    cta:         'Subscribe',
    ctaHref:     null,
    highlight:   true,
    features: [
      { text: 'Everything in **Player**', detail: 'All player-side benefits included' },
      { text: '**Create and manage campaigns**', detail: 'Name, settings, full lifecycle control' },
      { text: '**Invite management**', detail: 'Generate links, refresh tokens, manage access' },
      { text: '**Campaign assets**', detail: 'Upload and attach files for your table' },
      { text: '**Session tools**', detail: 'Launch and end play sessions tied to a campaign' },
      { text: '**Full VTT control**', detail: 'Maps, fog, tokens, encounters, enemy instances' },
    ],
  },
];

function stripePriceIdForTier(id: TierId, annual: boolean, m: MergedStripePrices): string | null {
  if (id === 'free') return null;
  if (id === 'player') return annual ? m.player_annual : m.player_monthly;
  return annual ? m.dm_annual : m.dm_monthly;
}

const FAQ = [
  {
    q: 'What happens to my homebrew if I cancel Player?',
    a: 'Your creations remain in the library and on your character sheets. You lose the ability to create or edit new homebrew items, but nothing is deleted.',
  },
  {
    q: 'What happens to my campaigns if I cancel DM?',
    a: 'Campaigns are preserved. Players can still view campaign data, but sessions cannot be launched and campaign settings cannot be modified until the subscription is restored — or ownership is transferred to another DM-tier account.',
  },
  {
    q: 'Can I switch between monthly and annual?',
    a: 'Yes. Switching to annual mid-cycle prorates your remaining monthly balance. Stripe handles this automatically.',
  },
  {
    q: 'Can players join a campaign for free?',
    a: 'Yes. Any account — Free, Player, or DM — can join a campaign via invite link. Only the DM running the campaign needs a subscription.',
  },
  {
    q: 'Can I transfer campaign ownership?',
    a: 'Yes. A DM can transfer ownership to another player in the campaign. The receiving player must have an active DM subscription.',
  },
  {
    q: 'Can I downgrade at any time?',
    a: 'Yes. Downgrading takes effect at the end of your current billing period. You keep access to the higher tier until then.',
  },
];

const FIT_GUIDE = [
  {
    type:   'Just playing in a friend\'s campaign',
    answer: 'Free is everything you need. Join the campaign, build your character, use the library.',
    tier:   'Free',
    color:  '#706858',
  },
  {
    type:   'Building characters and publishing homebrew',
    answer: 'Player unlocks unlimited characters and the full homebrew workshop. Publish your creations for the whole community.',
    tier:   'Player',
    color:  '#4a9de8',
  },
  {
    type:   'Running the table',
    answer: 'Dungeon Master is the only tier that can create and run campaigns, launch sessions, and control the VTT.',
    tier:   'Dungeon Master',
    color:  '#c4922a',
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────
function FeatureLine({ text, detail }: { text: string; detail: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <li style={{ marginBottom: '14px', paddingLeft: '0', listStyle: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
        <span style={{ color: T.gold, fontSize: '12px', flexShrink: 0 }}>◆</span>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: '17px', color: T.text, lineHeight: 1.5 }}>
          {parts.map((chunk, i) =>
            i % 2 === 1
              ? <strong key={i} style={{ color: T.gold, fontWeight: 600 }}>{chunk}</strong>
              : <span key={i}>{chunk}</span>
          )}
        </span>
      </div>
      <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '14px', color: T.textMuted, lineHeight: 1.5, paddingLeft: '20px', fontStyle: 'italic' }}>
        {detail}
      </div>
    </li>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      borderBottom: `1px solid ${T.border}`,
      padding: '0',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          cursor: 'pointer', padding: '18px 0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px',
        }}
      >
        <span style={{ fontFamily: "'Cinzel', serif", fontSize: '15px', letterSpacing: '0.08em', color: T.text, lineHeight: 1.4 }}>
          {q}
        </span>
        <span style={{
          color: T.gold, fontSize: '18px', flexShrink: 0,
          transition: 'transform 0.2s ease',
          transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
          display: 'inline-block',
        }}>
          +
        </span>
      </button>
      {open && (
        <div style={{
          fontFamily: "'EB Garamond', serif", fontSize: '17px',
          color: T.textMuted, lineHeight: 1.75,
          paddingBottom: '18px',
        }}>
          {a}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Pricing() {
  const user     = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const { merged } = useBillingPriceCatalog();
  const [annual, setAnnual] = useState(false);

  const handleSubscribe = (priceId: string | null) => {
    if (!priceId) return;
    if (!user) {
      navigate('/register');
      return;
    }
    navigate(`/subscribe?price_id=${encodeURIComponent(priceId)}`);
  };

  return (
    <div className="page-enter" style={{
      background: T.bg, color: T.text,
      fontFamily: "'EB Garamond', serif",
      minHeight: 'calc(100vh - 75px)',
    }}>
      <style>{`
        @media (max-width: 900px) {
          .pricing-grid { grid-template-columns: 1fr !important; }
          .fit-grid     { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* ── Header ── */}
        <header style={{ marginBottom: '48px', textAlign: 'center' }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.4em', color: T.textDim, marginBottom: '14px' }}>
            MEMBERSHIP
          </div>
          <h1 style={{
            fontFamily: "'Cinzel', serif", fontSize: 'clamp(26px, 4vw, 38px)',
            letterSpacing: '0.12em', color: T.gold, fontWeight: 600, margin: '0 0 16px',
          }}>
            Choose Your Tier
          </h1>
          <p style={{
            fontSize: '19px', color: T.textMuted, lineHeight: 1.75,
            maxWidth: '560px', margin: '0 auto 32px', fontStyle: 'italic',
          }}>
            One DM subscription runs the whole table. Players join free — upgrade only when you want more.
          </p>

          {/* ── Billing toggle ── */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '14px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: '4px', padding: '6px 16px' }}>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.12em', color: annual ? T.textDim : T.text }}>
              Monthly
            </span>
            <button
              type="button"
              onClick={() => setAnnual(a => !a)}
              style={{
                width: '42px', height: '22px', borderRadius: '11px', border: 'none', cursor: 'pointer',
                background: annual ? T.gold : T.border, position: 'relative', transition: 'background 0.2s ease',
              }}
            >
              <span style={{
                position: 'absolute', top: '3px',
                left: annual ? '22px' : '3px',
                width: '16px', height: '16px', borderRadius: '50%',
                background: T.bg, transition: 'left 0.2s ease',
                display: 'block',
              }} />
            </button>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.12em', color: annual ? T.text : T.textDim }}>
              Annual
            </span>

          </div>
        </header>

        {/* ── Tier cards ── */}
        <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', alignItems: 'stretch', marginBottom: '60px' }}>
          {TIERS.map(tier => {
            const price   = annual ? tier.annual : tier.monthly;
            const priceId = stripePriceIdForTier(tier.id, annual, merged);
            const isCurrent = user?.subscription_tier === tier.id;

            return (
              <section key={tier.id} style={{
                background: T.card,
                border: `1px solid ${tier.highlight ? tier.accent + '66' : T.border}`,
                borderTop: `3px solid ${tier.accent}`,
                borderRadius: '6px',
                padding: '28px 22px 24px',
                display: 'flex', flexDirection: 'column',
                position: 'relative',
                boxShadow: tier.highlight ? `0 0 32px ${tier.accent}11` : undefined,
              }}>
                {/* Recommended badge */}
                {tier.highlight && (
                  <div style={{
                    position: 'absolute', top: '-1px', right: '20px',
                    background: T.gold, color: T.bg,
                    fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.2em',
                    padding: '3px 10px', borderRadius: '0 0 4px 4px', fontWeight: 600,
                  }}>
                    RECOMMENDED
                  </div>
                )}

                {/* Tier name */}
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.28em', color: T.textDim, marginBottom: '6px' }}>
                  {tier.id.toUpperCase()}
                </div>
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: '22px', letterSpacing: '0.1em', color: tier.accent, fontWeight: 600, margin: '0 0 4px' }}>
                  {tier.name}
                </h2>
                <p style={{ fontSize: '15px', color: T.textMuted, margin: '0 0 20px', fontStyle: 'italic' }}>
                  {tier.tagline}
                </p>

                {/* Price */}
                <div style={{ marginBottom: '24px', paddingBottom: '20px', borderBottom: `1px solid ${T.border}` }}>
                  {price === 0 ? (
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '36px', color: T.text, fontWeight: 600 }}>
                      Free
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: '15px', color: T.textMuted, alignSelf: 'flex-start', marginTop: '8px' }}>$</span>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: '42px', color: T.text, fontWeight: 600, lineHeight: 1 }}>
                        {annual ? (price / 12).toFixed(2) : price}
                      </span>
                      <span style={{ fontFamily: "'EB Garamond', serif", fontSize: '15px', color: T.textMuted }}>/month</span>
                    </div>
                  )}
                  {annual && price > 0 && (
                    <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '14px', color: T.textMuted, marginTop: '4px', fontStyle: 'italic' }}>
                      Billed as ${price}/year — includes 2 months free
                    </div>
                  )}
                </div>

                {/* Features */}
                <ul style={{ flex: 1, margin: '0 0 24px', padding: 0 }}>
                  {tier.features.map((f, i) => (
                    <FeatureLine key={i} text={f.text} detail={f.detail} />
                  ))}
                </ul>

                {/* CTA */}
                {tier.id === 'free' ? (
                  !user ? (
                    <Link
                      to="/register"
                      style={{
                        display: 'block', textAlign: 'center',
                        fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.18em',
                        color: T.bg, background: tier.accent,
                        padding: '12px', borderRadius: '3px', textDecoration: 'none', fontWeight: 600,
                      }}
                    >
                      {tier.cta}
                    </Link>
                  ) : user.subscription_tier === 'free' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{
                        textAlign: 'center', padding: '11px',
                        fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.16em',
                        color: tier.accent, border: `1px solid ${tier.accent}44`, borderRadius: '3px',
                      }}>
                        YOUR CURRENT PLAN
                      </div>
                      <Link
                        to="/account"
                        style={{
                          display: 'block', textAlign: 'center',
                          fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.18em',
                          color: tier.accent, background: 'transparent',
                          border: `1px solid ${tier.accent}`,
                          padding: '12px', borderRadius: '3px', textDecoration: 'none', fontWeight: 600,
                        }}
                      >
                        Subscriptions & billing
                      </Link>
                    </div>
                  ) : (
                    <Link
                      to="/account"
                      style={{
                        display: 'block', textAlign: 'center',
                        fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.18em',
                        color: T.bg, background: tier.accent,
                        padding: '12px', borderRadius: '3px', textDecoration: 'none', fontWeight: 600,
                      }}
                    >
                      Account & billing
                    </Link>
                  )
                ) : isCurrent ? (
                  <div style={{
                    textAlign: 'center', padding: '11px',
                    fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.16em',
                    color: tier.accent, border: `1px solid ${tier.accent}44`, borderRadius: '3px',
                  }}>
                    CURRENT PLAN
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!priceId}
                    onClick={() => handleSubscribe(priceId)}
                    style={{
                      width: '100%', cursor: !priceId ? 'not-allowed' : 'pointer',
                      opacity: !priceId ? 0.55 : 1,
                      fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.18em',
                      color: tier.highlight ? T.bg : tier.accent,
                      background: tier.highlight ? tier.accent : 'transparent',
                      border: `1px solid ${tier.accent}`,
                      padding: '12px', borderRadius: '3px', fontWeight: 600,
                    }}
                  >
                    {tier.cta}
                  </button>
                )}
              </section>
            );
          })}
        </div>

        {/* ── Which tier is right for you ── */}
        <div style={{ marginBottom: '60px' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.4em', color: T.textDim, marginBottom: '12px' }}>
              NOT SURE?
            </div>
            <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 'clamp(20px, 3vw, 28px)', letterSpacing: '0.1em', color: T.text, fontWeight: 600, margin: 0 }}>
              Which tier is right for you
            </h2>
          </div>
          <div className="fit-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {FIT_GUIDE.map(({ type, answer, tier, color }) => (
              <div key={tier} style={{
                background: T.surface, border: `1px solid ${T.border}`,
                borderLeft: `3px solid ${color}`, borderRadius: '4px', padding: '20px',
              }}>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em', color, marginBottom: '8px' }}>
                  → {tier.toUpperCase()}
                </div>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '15px', color: T.text, marginBottom: '10px', lineHeight: 1.4 }}>
                  {type}
                </div>
                <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '16px', color: T.textMuted, lineHeight: 1.65, fontStyle: 'italic' }}>
                  {answer}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── FAQ ── */}
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.4em', color: T.textDim, marginBottom: '12px' }}>
              QUESTIONS
            </div>
            <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 'clamp(20px, 3vw, 28px)', letterSpacing: '0.1em', color: T.text, fontWeight: 600, margin: 0 }}>
              Frequently asked
            </h2>
          </div>
          <div style={{ borderTop: `1px solid ${T.border}` }}>
            {FAQ.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)}
          </div>
        </div>

        {/* ── Billing note ── */}
        <div style={{
          marginTop: '48px', padding: '20px 24px',
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: '6px', maxWidth: '640px',
          marginLeft: 'auto', marginRight: 'auto', textAlign: 'center',
        }}>
          <p style={{ margin: 0, fontSize: '15px', color: T.textMuted, lineHeight: 1.7 }}>
            Billing is handled through <strong style={{ color: T.text }}>Stripe</strong>. Manage your subscription, update payment methods, or cancel any time from{' '}
            {user ? (
              <Link to="/account" style={{ color: T.rp, textDecoration: 'none', borderBottom: `1px solid ${T.rp}55` }}>
                Account → Billing
              </Link>
            ) : (
              <>
                <Link to="/register" style={{ color: T.rp, textDecoration: 'none', borderBottom: `1px solid ${T.rp}55` }}>your account</Link>
                {' '}once signed in
              </>
            )}
            .
          </p>
        </div>

      </div>
    </div>
  );
}