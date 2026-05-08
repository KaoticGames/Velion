import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore, selectIsDM } from '@/store/authStore';
import {
  useCampaignList, useCreateCampaign, useDeleteCampaign,
  type CampaignSummary,
} from '@/hooks/useCampaign';

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
  dmGold:    '#e8b84b',
};

const TIER_COLOR: Record<string, string> = {
  local:   '#8a7a68',
  veteran: '#3dba6a',
  heroic:  '#4a9de8',
  mythic:  '#a055e8',
  godlike: '#e8a020',
  cosmic:  '#ff5555',
};

const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';

function TierBadge({ tier }: { tier: string }) {
  const c = TIER_COLOR[tier] ?? T.textMuted;
  return (
    <span style={{
      fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.18em',
      color: c, background: c + '18', border: `1px solid ${c}44`,
      borderRadius: '2px', padding: '2px 8px',
    }}>{tier.toUpperCase()}</span>
  );
}

// ── Create Campaign Modal ─────────────────────────────────────────────────
function CreateModal({ onClose }: { onClose: () => void }) {
  const [name, setName]     = useState('');
  const [tier, setTier]     = useState('local');
  const [error, setError]   = useState('');
  const create              = useCreateCampaign();
  const navigate            = useNavigate();

  const TIERS = ['local','veteran','heroic','mythic','godlike','cosmic'];

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Campaign name is required.'); return; }
    try {
      const campaign = await create.mutateAsync({ name: name.trim(), world_tier_baseline: tier });
      onClose();
      navigate(`/campaigns/${campaign.id}`);
    } catch {
      setError('Failed to create campaign. Please try again.');
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#000000bb', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '24px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.gold}44`,
        borderTop: `3px solid ${T.gold}`, borderRadius: '4px',
        width: '100%', maxWidth: '440px', padding: '32px',
      }}>
        <div style={{
          fontFamily: "'Cinzel',serif", fontSize: '13px',
          letterSpacing: '0.3em', color: T.textDim, marginBottom: '4px',
        }}>NEW CAMPAIGN</div>
        <h2 style={{
          fontFamily: "'Cinzel',serif", fontSize: '23px',
          color: T.gold, margin: '0 0 24px', fontWeight: '700',
        }}>Create Campaign</h2>

        {/* Name */}
        <label style={{
          fontFamily: "'Cinzel',serif", fontSize: '12px',
          letterSpacing: '0.2em', color: T.textDim, display: 'block', marginBottom: '6px',
        }}>CAMPAIGN NAME</label>
        <input
          value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="The Shattered Realm..."
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: '3px', padding: '10px 14px', marginBottom: '20px',
            color: T.text, fontSize: '17px', outline: 'none', fontFamily: 'inherit',
          }}
          onFocus={e => e.currentTarget.style.borderColor = T.gold + '66'}
          onBlur={e => e.currentTarget.style.borderColor = T.border}
        />

        {/* World Tier */}
        <label style={{
          fontFamily: "'Cinzel',serif", fontSize: '12px',
          letterSpacing: '0.2em', color: T.textDim, display: 'block', marginBottom: '8px',
        }}>WORLD TIER BASELINE</label>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {TIERS.map(t => {
            const c = TIER_COLOR[t];
            const active = tier === t;
            return (
              <button key={t} onClick={() => setTier(t)} style={{
                fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
                color: active ? '#080b10' : c,
                background: active ? c : c + '18',
                border: `1px solid ${c}`,
                borderRadius: '2px', padding: '5px 12px', cursor: 'pointer',
                transition: 'all 0.12s',
              }}>{t.toUpperCase()}</button>
            );
          })}
        </div>
        <p style={{
          fontSize: '14px', color: T.textMuted, lineHeight: '1.6',
          margin: '0 0 24px', fontStyle: 'italic',
        }}>
          Sets the power baseline for encounters and loot scaling. Can be changed later.
        </p>

        {error && (
          <div style={{
            fontSize: '15px', color: T.hp,
            background: T.hp + '15', border: `1px solid ${T.hp}44`,
            borderRadius: '3px', padding: '8px 12px', marginBottom: '16px',
          }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.14em',
            background: 'transparent', border: `1px solid ${T.border}`,
            borderRadius: '3px', padding: '9px 20px', cursor: 'pointer', color: T.textMuted,
          }}>CANCEL</button>
          <button onClick={handleSubmit} disabled={create.isPending} style={{
            fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.14em',
            background: create.isPending ? T.goldDim : T.gold,
            border: `1px solid ${T.gold}`, borderRadius: '3px',
            padding: '9px 20px', cursor: create.isPending ? 'not-allowed' : 'pointer',
            color: '#080b10', fontWeight: '700',
          }}>
            {create.isPending ? 'CREATING…' : 'CREATE CAMPAIGN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Campaign Card ─────────────────────────────────────────────────────────
function CampaignCard({ campaign, isDM }: { campaign: CampaignSummary; isDM: boolean }) {
  const [hov, setHov]   = useState(false);
  const deleteMut       = useDeleteCampaign();
  const [confirming, setConfirming] = useState(false);
  const tc = TIER_COLOR[campaign.world_tier_baseline] ?? T.textMuted;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    await deleteMut.mutateAsync(campaign.id);
  };

  return (
    <Link to={`/campaigns/${campaign.id}`} style={{ textDecoration: 'none' }}>
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => { setHov(false); setConfirming(false); }}
        style={{
          background: hov ? T.card : T.surface,
          border: `1px solid ${hov ? tc + '66' : T.border}`,
          borderTop: `2px solid ${hov ? tc : tc + '55'}`,
          borderRadius: '3px', padding: '20px 22px',
          cursor: 'pointer', transition: 'all 0.15s',
          position: 'relative',
        }}
      >
        {/* DM badge */}
        {isDM && (
          <div style={{
            position: 'absolute', top: '14px', right: '14px',
            fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.18em',
            color: T.dmGold, background: T.dmGold + '18',
            border: `1px solid ${T.dmGold}33`, borderRadius: '2px', padding: '2px 6px',
          }}>DM</div>
        )}

        <div style={{
          fontFamily: "'Cinzel',serif", fontSize: '20px',
          letterSpacing: '0.08em', color: T.text, marginBottom: '10px',
          paddingRight: isDM ? '48px' : '0',
        }}>{campaign.name}</div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
          <TierBadge tier={campaign.world_tier_baseline} />
        </div>

        <div style={{
          fontSize: '14px', color: T.textDim,
          fontFamily: "'Cinzel',serif", letterSpacing: '0.1em',
        }}>
          Created {new Date(campaign.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
          })}
        </div>

        {/* DM: delete button */}
        {isDM && hov && (
          <button
            onClick={handleDelete}
            style={{
              position: 'absolute', bottom: '14px', right: '14px',
              fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
              background: confirming ? T.hp : 'transparent',
              border: `1px solid ${T.hp}`,
              color: confirming ? '#080b10' : T.hp,
              borderRadius: '2px', padding: '4px 10px', cursor: 'pointer',
            }}
          >
            {confirming ? 'CONFIRM' : 'DELETE'}
          </button>
        )}
      </div>
    </Link>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function Campaigns() {
  const isDM                      = useAuthStore(selectIsDM);
  const { data: campaigns, isLoading, isError } = useCampaignList();
  const [showCreate, setShowCreate] = useState(false);

  const list = campaigns ?? [];

  return (
    <div style={{ padding: '40px 32px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-end', marginBottom: '36px',
      }}>
        <div>
          <h1 style={{
            fontFamily: "'Cinzel',serif", fontSize: '29px',
            color: T.gold, letterSpacing: '0.12em', margin: '0',
          }}>Campaigns</h1>
        </div>

        {isDM && (
          <button onClick={() => setShowCreate(true)} style={{
            fontFamily: "'Cinzel',serif", fontSize: '14px', letterSpacing: '0.14em',
            background: T.gold, border: `1px solid ${T.gold}`,
            borderRadius: '3px', padding: '10px 22px', cursor: 'pointer',
            color: '#080b10', fontWeight: '700',
          }}>+ NEW CAMPAIGN</button>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{
          textAlign: 'center', padding: '80px 0',
          fontFamily: "'Cinzel',serif", fontSize: '14px',
          letterSpacing: '0.2em', color: T.textDim,
        }}>LOADING…</div>
      )}

      {/* Error */}
      {isError && (
        <div style={{
          background: T.card, border: `1px solid ${T.border}`,
          borderTop: `2px solid ${T.hp}`, borderRadius: '3px',
          padding: '24px', color: T.textMuted, fontSize: '16px',
        }}>
          Could not load campaigns. Check your connection and try again.
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && list.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ fontSize: '51px', opacity: 0.2, marginBottom: '16px' }}>⚔</div>
          {isDM ? (
            <>
              <div style={{
                fontFamily: "'Cinzel',serif", fontSize: '17px',
                letterSpacing: '0.2em', color: T.textDim, marginBottom: '12px',
              }}>NO CAMPAIGNS YET</div>
              <p style={{ fontSize: '16px', color: T.textMuted, marginBottom: '24px', maxWidth: '360px', margin: '0 auto 24px' }}>
                Create your first campaign to start building your world, inviting players, and running sessions.
              </p>
              <button onClick={() => setShowCreate(true)} style={{
                fontFamily: "'Cinzel',serif", fontSize: '14px', letterSpacing: '0.14em',
                background: T.gold, border: `1px solid ${T.gold}`,
                borderRadius: '3px', padding: '10px 24px', cursor: 'pointer',
                color: '#080b10', fontWeight: '700',
              }}>+ CREATE YOUR FIRST CAMPAIGN</button>
            </>
          ) : (
            <>
              <div style={{
                fontFamily: "'Cinzel',serif", fontSize: '17px',
                letterSpacing: '0.2em', color: T.textDim, marginBottom: '12px',
              }}>NOT IN ANY CAMPAIGNS</div>
              <p style={{ fontSize: '16px', color: T.textMuted, maxWidth: '360px', margin: '0 auto' }}>
                Ask your DM for an invite link to join a campaign with one of your characters.
              </p>
            </>
          )}
        </div>
      )}

      {/* Campaign grid */}
      {!isLoading && list.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '14px',
        }}>
          {list.map(c => (
            <CampaignCard key={c.id} campaign={c} isDM={isDM} />
          ))}
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}