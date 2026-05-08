import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useInvitePreview, useJoinCampaign } from '@/hooks/useCampaign';
import { useCharacterList } from '@/hooks/useCharacter';

const T = {
  bg:        '#080b10',
  surface:   '#0d1018',
  card:      '#111520',
  border:    '#1c2230',
  gold:      '#c4922a',
  goldDim:   '#6a4212',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  textDim:   '#504538',
  rp:        '#3ab5e8',
  hp:        '#d45c5c',
  green:     '#50a060',
};

const TIER_COLOR: Record<string,string> = {
  local:'#8a7a68', veteran:'#3dba6a', heroic:'#4a9de8',
  mythic:'#a055e8', godlike:'#e8a020', cosmic:'#ff5555',
};
const ATTR_COLOR: Record<string,string> = {
  power:'#c8503a', agility:'#50a060', focus:'#9b6fe8', presence:'#c4922a',
};

const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';
const fmt = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n/1_000).toFixed(1)}k` : String(Math.round(n));

export default function JoinCampaign() {
  const { token }               = useParams<{ token: string }>();
  const navigate                = useNavigate();
  const [selectedChar, setChar] = useState<string | null>(null);
  const [error, setError]       = useState('');
  const [joined, setJoined]     = useState(false);
  const [joinedName, setJoinedName] = useState('');

  const { data: preview, isLoading: previewLoading, isError: previewError, error: previewErr } = useInvitePreview(token);
  const { data: characters, isLoading: charsLoading }    = useCharacterList();
  const join = useJoinCampaign();

  // Characters not already in a campaign — we can't know from the list alone
  // so we attempt join and surface the conflict error if it arises
  const availableChars = characters ?? [];

  const tc = TIER_COLOR[preview?.campaign.world_tier_baseline ?? 'local'] ?? T.textMuted;

  const getPreviewError = (): string => {
    const err = previewErr as any;
    const code = err?.response?.data?.error?.code;
    if (code === 'INVITE_EXPIRED')   return 'This invite link has expired.';
    if (code === 'INVITE_EXHAUSTED') return 'This invite link has reached its maximum uses.';
    if (code === 'NOT_FOUND')        return 'This invite link is invalid or has been revoked.';
    return 'This invite link is not valid.';
  };

  const handleJoin = async () => {
    if (!selectedChar || !token) return;
    setError('');
    try {
      const result = await join.mutateAsync({ token, character_id: selectedChar });
      setJoinedName(result.campaign.name);
      setJoined(true);
    } catch (e: any) {
      const code = e?.response?.data?.error?.code;
      if (code === 'CHARACTER_ALREADY_IN_CAMPAIGN') {
        setError('This character is already in a campaign. Choose a different character or remove them from their current campaign first.');
      } else if (code === 'ALREADY_IN_CAMPAIGN') {
        setError('You already have a character enrolled in this campaign.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  };

  // ── Success screen ────────────────────────────────────────────────────
  if (joined) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 'calc(100vh - 52px)', background: T.bg, padding: '24px',
      }}>
        <div style={{
          background: T.card, border: `1px solid ${T.green}44`,
          borderTop: `3px solid ${T.green}`, borderRadius: '4px',
          padding: '48px 40px', textAlign: 'center', maxWidth: '420px', width: '100%',
        }}>
          <div style={{ fontSize: '43px', marginBottom: '20px' }}>⚔</div>
          <div style={{
            fontFamily: "'Cinzel',serif", fontSize: '14px',
            letterSpacing: '0.3em', color: T.green, marginBottom: '8px',
          }}>CAMPAIGN JOINED</div>
          <h2 style={{
            fontFamily: "'Cinzel',serif", fontSize: '23px',
            color: T.text, margin: '0 0 12px', letterSpacing: '0.1em',
          }}>{joinedName}</h2>
          <p style={{ fontSize: '16px', color: T.textMuted, lineHeight: '1.7', marginBottom: '28px' }}>
            Your character has been enrolled. Your DM will let you know when the first session begins.
          </p>
          <button onClick={() => navigate('/campaigns')} style={{
            fontFamily: "'Cinzel',serif", fontSize: '14px', letterSpacing: '0.14em',
            background: T.gold, border: `1px solid ${T.gold}`,
            borderRadius: '3px', padding: '11px 28px', cursor: 'pointer',
            color: '#080b10', fontWeight: '700',
          }}>VIEW CAMPAIGNS →</button>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────
  if (previewLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 'calc(100vh - 52px)', fontFamily: "'Cinzel',serif",
        fontSize: '14px', letterSpacing: '0.2em', color: T.textDim,
      }}>LOADING INVITE…</div>
    );
  }

  // ── Invalid / expired invite ──────────────────────────────────────────
  if (previewError || !preview) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 'calc(100vh - 52px)', padding: '24px',
      }}>
        <div style={{
          background: T.card, border: `1px solid ${T.hp}44`,
          borderTop: `3px solid ${T.hp}`, borderRadius: '4px',
          padding: '48px 40px', textAlign: 'center', maxWidth: '400px', width: '100%',
        }}>
          <div style={{ fontSize: '39px', marginBottom: '16px', opacity: 0.4 }}>✕</div>
          <div style={{
            fontFamily: "'Cinzel',serif", fontSize: '14px',
            letterSpacing: '0.26em', color: T.hp, marginBottom: '10px',
          }}>INVITE INVALID</div>
          <p style={{ fontSize: '16px', color: T.textMuted, lineHeight: '1.7', marginBottom: '28px' }}>
            {getPreviewError()}
          </p>
          <button onClick={() => navigate('/campaigns')} style={{
            fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.14em',
            background: 'transparent', border: `1px solid ${T.border}`,
            borderRadius: '3px', padding: '9px 20px', cursor: 'pointer', color: T.textMuted,
          }}>← BACK TO CAMPAIGNS</button>
        </div>
      </div>
    );
  }

  // ── Main join screen ──────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 52px)', background: T.bg, padding: '32px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: '520px' }}>

        {/* Campaign info card */}
        <div style={{
          background: T.card, border: `1px solid ${tc}44`,
          borderTop: `3px solid ${tc}`, borderRadius: '4px',
          padding: '28px 32px', marginBottom: '20px', textAlign: 'center',
        }}>
          <div style={{
            fontFamily: "'Cinzel',serif", fontSize: '13px',
            letterSpacing: '0.3em', color: T.textDim, marginBottom: '6px',
          }}>YOU'VE BEEN INVITED TO</div>
          <h1 style={{
            fontFamily: "'Cinzel',serif", fontSize: '27px',
            color: tc, margin: '0 0 12px', fontWeight: '700', letterSpacing: '0.1em',
          }}>{preview.campaign.name}</h1>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{
              fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.18em',
              color: tc, background: tc + '18', border: `1px solid ${tc}44`,
              borderRadius: '2px', padding: '2px 8px',
            }}>{preview.campaign.world_tier_baseline.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: '15px', color: T.textDim }}>
            Run by <span style={{ color: T.textMuted }}>{preview.dm.email}</span>
          </div>
          {preview.invite.max_uses !== null && (
            <div style={{
              fontSize: '14px', color: T.textDim,
              fontFamily: "'Cinzel',serif", letterSpacing: '0.1em', marginTop: '6px',
            }}>
              {preview.invite.max_uses - preview.invite.use_count} spots remaining
            </div>
          )}
        </div>

        {/* Character picker */}
        <div style={{
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: '4px', padding: '24px 28px',
        }}>
          <div style={{
            fontFamily: "'Cinzel',serif", fontSize: '12px',
            letterSpacing: '0.26em', color: T.textDim, marginBottom: '14px',
          }}>SELECT YOUR CHARACTER</div>

          {charsLoading && (
            <div style={{
              textAlign: 'center', padding: '24px', color: T.textDim,
              fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.16em',
            }}>LOADING CHARACTERS…</div>
          )}

          {!charsLoading && availableChars.length === 0 && (
            <div style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: '3px', padding: '20px', textAlign: 'center',
              fontSize: '16px', color: T.textMuted, marginBottom: '16px',
            }}>
              You don't have any characters yet.{' '}
              <a href="/characters/new" style={{ color: T.gold }}>Create one first.</a>
            </div>
          )}

          {!charsLoading && availableChars.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {availableChars.map(char => {
                const ac = ATTR_COLOR[char.chosen_attribute] ?? T.gold;
                const selected = selectedChar === char.id;
                return (
                  <button key={char.id} onClick={() => setChar(char.id)} style={{
                    background: selected ? ac + '18' : T.surface,
                    border: `1px solid ${selected ? ac : T.border}`,
                    borderRadius: '3px', padding: '12px 14px', cursor: 'pointer',
                    textAlign: 'left', transition: 'all 0.12s',
                    display: 'flex', alignItems: 'center', gap: '14px',
                  }}>
                    {/* Portrait */}
                    <div style={{
                      width: '38px', height: '38px', borderRadius: '2px', flexShrink: 0,
                      background: char.portrait_url ? 'transparent' : T.card,
                      border: `1px solid ${ac}44`, overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {char.portrait_url
                        ? <img src={char.portrait_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: '19px', color: ac, opacity: 0.5 }}>⚔</span>}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '17px', fontWeight: '600', color: T.text, marginBottom: '2px' }}>
                        {char.name}
                      </div>
                      <div style={{ fontSize: '14px', color: T.textDim }}>
                        Level {char.level} · {cap(char.chosen_attribute)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', fontSize: '15px', flexShrink: 0 }}>
                      <span style={{ color: T.textDim }}>
                        RP <span style={{ color: T.rp, fontWeight: '600' }}>{char.base_rp}</span>
                      </span>
                      <span style={{ color: T.textDim }}>
                        HP <span style={{ color: T.hp, fontWeight: '600' }}>{fmt(char.max_hp)}</span>
                      </span>
                    </div>

                    {selected && (
                      <div style={{
                        width: '18px', height: '18px', borderRadius: '50%',
                        background: ac, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: '14px', color: '#080b10',
                        fontWeight: '700', flexShrink: 0,
                      }}>✓</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <div style={{
              fontSize: '15px', color: T.hp,
              background: T.hp + '15', border: `1px solid ${T.hp}44`,
              borderRadius: '3px', padding: '10px 14px', marginBottom: '16px', lineHeight: '1.6',
            }}>{error}</div>
          )}

          <button
            onClick={handleJoin}
            disabled={!selectedChar || join.isPending}
            style={{
              width: '100%', fontFamily: "'Cinzel',serif", fontSize: '15px',
              letterSpacing: '0.16em', background: !selectedChar ? T.goldDim : T.gold,
              border: `1px solid ${!selectedChar ? T.goldDim : T.gold}`,
              borderRadius: '3px', padding: '13px', cursor: !selectedChar ? 'not-allowed' : 'pointer',
              color: '#080b10', fontWeight: '700', transition: 'all 0.15s',
              opacity: join.isPending ? 0.7 : 1,
            }}
          >
            {join.isPending ? 'JOINING…' : selectedChar ? 'JOIN CAMPAIGN →' : 'SELECT A CHARACTER'}
          </button>
        </div>
      </div>
    </div>
  );
}