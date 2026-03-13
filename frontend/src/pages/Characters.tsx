import { Link } from 'react-router-dom';
import { useCharacterList } from '@/hooks/useCharacter';
import { useAuthStore } from '@/store/authStore';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', goldDim: '#5a3e10', text: '#e4d8c0', textMuted: '#706858',
  hp: '#e05050', rp: '#4a9de8',
};

const ATTR_COLOR: Record<string, string> = {
  power: '#e87050', agility: '#50c878', focus: '#7090e8', presence: '#e8b050',
};

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export default function Characters() {
  const { data: characters, isLoading, isError } = useCharacterList();
  const { user } = useAuthStore();
  const mockAuth  = import.meta.env.VITE_ENABLE_MOCK_AUTH === 'true';

  const isFree      = !mockAuth && user?.subscription_tier === 'free';
  const charCount   = characters?.length ?? 0;
  const atCharLimit = isFree && charCount >= 3;

  return (
    <div className="page-enter" style={{ padding: '40px 32px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '32px' }}>
        <div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.3em', color: T.textMuted, marginBottom: '8px' }}>
            YOUR ROSTER
          </div>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: '26px', color: T.gold, letterSpacing: '0.1em' }}>
            CHARACTERS
          </h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          {isFree && (
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.1em', color: T.textMuted }}>
              {charCount} / 3 free slots used
            </span>
          )}
          <Link
            to={atCharLimit ? '/account/subscription' : '/characters/new'}
            style={{
              fontFamily:     "'Cinzel', serif",
              fontSize:       '11px',
              letterSpacing:  '0.14em',
              textDecoration: 'none',
              color:          atCharLimit ? T.textMuted : '#06070c',
              background:     atCharLimit ? 'transparent' : T.gold,
              border:         `1px solid ${atCharLimit ? T.textMuted : T.gold}`,
              padding:        '9px 20px',
              borderRadius:   '3px',
              opacity:        atCharLimit ? 0.7 : 1,
            }}
          >
            {atCharLimit ? '⬡ UPGRADE TO ADD MORE' : '+ NEW CHARACTER'}
          </Link>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: T.textMuted, fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em' }}>
          LOADING ROSTER...
        </div>
      )}

      {/* Error — in dev/mock mode this is expected with no backend */}
      {isError && (
        <div style={{
          background: T.card, border: `1px solid ${T.border}`, borderTop: `2px solid ${T.goldDim}`,
          borderRadius: '4px', padding: '32px', textAlign: 'center',
        }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '0.2em', color: T.textMuted, marginBottom: '12px' }}>
            {mockAuth ? 'BACKEND NOT CONNECTED' : 'COULD NOT LOAD CHARACTERS'}
          </div>
          <p style={{ color: T.textMuted, fontSize: '14px', maxWidth: '440px', margin: '0 auto 20px' }}>
            {mockAuth
              ? 'Running in dev mode without a backend. Start the API server on port 3001, or click New Character to open a local sheet.'
              : 'There was a problem loading your characters. Please try again.'}
          </p>
          {mockAuth && (
            <Link to="/characters/new" style={{
              fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.14em',
              textDecoration: 'none', color: '#06070c', background: T.gold,
              padding: '9px 24px', borderRadius: '3px',
            }}>
              OPEN LOCAL SHEET
            </Link>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && charCount === 0 && (
        <div style={{
          background: T.card, border: `1px dashed ${T.border}`, borderRadius: '4px',
          padding: '64px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>⚔</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.18em', color: T.textMuted, marginBottom: '8px' }}>
            NO CHARACTERS YET
          </div>
          <p style={{ color: T.textMuted, fontSize: '15px', marginBottom: '24px' }}>
            Your legend begins here.
          </p>
          <Link to="/characters/new" style={{
            fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.14em',
            textDecoration: 'none', color: '#06070c', background: T.gold,
            padding: '11px 28px', borderRadius: '3px',
          }}>
            CREATE YOUR FIRST CHARACTER
          </Link>
        </div>
      )}

      {/* Character grid */}
      {!isLoading && !isError && charCount > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {characters!.map((c) => (
            <Link
              key={c.id}
              to={`/characters/${c.id}`}
              style={{ textDecoration: 'none' }}
            >
              <div style={{
                background:   T.card,
                border:       `1px solid ${T.border}`,
                borderTop:    `2px solid ${ATTR_COLOR[c.chosen_attribute] ?? T.gold}`,
                borderRadius: '4px',
                padding:      '20px',
                cursor:       'pointer',
                transition:   'border-color 0.15s, background 0.15s',
              }}
                onMouseEnter={(e) => (e.currentTarget.style.background = T.surface)}
                onMouseLeave={(e) => (e.currentTarget.style.background = T.card)}
              >
                {/* Portrait + name */}
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{
                    width: '52px', height: '52px', borderRadius: '3px', flexShrink: 0,
                    background: T.surface, border: `1px solid ${T.border}`,
                    overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {c.portrait_url
                      ? <img src={c.portrait_url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: '22px', opacity: 0.4 }}>⚔</span>
                    }
                  </div>
                  <div>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '14px', color: T.text, fontWeight: '600', marginBottom: '3px' }}>
                      {c.name}
                    </div>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.1em', color: ATTR_COLOR[c.chosen_attribute] ?? T.gold }}>
                      LEVEL {c.level} · {c.chosen_attribute.toUpperCase()}
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ background: T.surface, borderRadius: '3px', padding: '8px 10px' }}>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '0.12em', color: T.hp, marginBottom: '2px' }}>HP</div>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '14px', color: T.text }}>
                      {fmtNum(c.current_hp)} <span style={{ fontSize: '10px', color: T.textMuted }}>/ {fmtNum(c.max_hp)}</span>
                    </div>
                  </div>
                  <div style={{ background: T.surface, borderRadius: '3px', padding: '8px 10px' }}>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '0.12em', color: T.rp, marginBottom: '2px' }}>BASE RP</div>
                    <div style={{ fontFamily: "'Cinzel', serif", fontSize: '14px', color: T.text }}>{c.base_rp}</div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
