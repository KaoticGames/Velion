import { useState, useEffect, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuthStore, selectIsDM } from '@/store/authStore';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCampaign, useRemoveMember, useDeleteCampaign,
  type CampaignMember,
} from '@/hooks/useCampaign';
import CampaignManager from '@/campaign-manager/CampaignManager';

const T = {
  bg:'#080b10', surface:'#0d1018', card:'#111520', border:'#1c2230',
  gold:'#c4922a', goldDim:'#6a4212', text:'#e4d8c0', textMuted:'#8a7a68',
  textDim:'#504538', rp:'#3ab5e8', hp:'#d45c5c', green:'#50a060',
  dmGold:'#e8b84b', magic:'#9b6fe8',
};
const TIER_COLOR: Record<string,string> = {
  local:'#8a7a68', veteran:'#3dba6a', heroic:'#4a9de8',
  mythic:'#a055e8', godlike:'#e8a020', cosmic:'#ff5555',
};
const ATTR_COLOR: Record<string,string> = {
  power:'#c8503a', agility:'#50a060', focus:'#9b6fe8', presence:'#c4922a',
};
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';
const fmt = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(1)}k` : String(Math.round(n));

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.26em', color:T.textDim, marginBottom:'12px', marginTop:'28px', borderBottom:`1px solid ${T.border}`, paddingBottom:'8px' }}>{children}</div>
);

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.14em', background: copied ? T.green+'22' : 'transparent', border:`1px solid ${copied ? T.green : T.border}`, borderRadius:'2px', padding:'4px 10px', cursor:'pointer', color: copied ? T.green : T.textMuted, transition:'all 0.15s', flexShrink:0 }}>
      {copied ? '✓ COPIED' : 'COPY'}
    </button>
  );
};

// ── Members ───────────────────────────────────────────────────────────────
function MembersPanel({ members, campaignId, isDM, currentUserId }: { members: CampaignMember[]; campaignId: string; isDM: boolean; currentUserId: string }) {
  const remove = useRemoveMember(campaignId);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!members.length) return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:'3px', padding:'20px', textAlign:'center', fontSize: '15px', color:T.textDim, fontFamily:"'Cinzel',serif", letterSpacing:'0.14em' }}>NO PLAYERS YET</div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
      {members.map(({ membership, character, user }) => {
        const isMe = membership.user_id === currentUserId;
        const ac = character ? ATTR_COLOR[character.chosen_attribute] ?? T.gold : T.textMuted;
        const canRemove = isDM || isMe;
        return (
          <div key={membership.id} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:'3px', padding:'14px 16px', display:'flex', alignItems:'center', gap:'14px' }}>
            <div style={{ width:'40px', height:'40px', borderRadius:'2px', flexShrink:0, background:T.card, border:`1px solid ${ac}44`, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {character?.portrait_url ? <img src={character.portrait_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <span style={{ fontSize: '21px', color:ac, opacity:0.5 }}>⚔</span>}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'2px' }}>
                <span style={{ fontSize: '17px', fontWeight:'600', color:T.text }}>{character?.name ?? 'Unknown Character'}</span>
                {isMe && <span style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.18em', color:T.gold, border:`1px solid ${T.goldDim}`, borderRadius:'2px', padding:'1px 5px' }}>YOU</span>}
              </div>
              <div style={{ fontSize: '14px', color:T.textDim }}>{character ? `Level ${character.level} · ${cap(character.chosen_attribute)} · ${user?.email ?? ''}` : user?.email ?? ''}</div>
            </div>
            {character && (
              <div style={{ display:'flex', gap:'12px', fontSize: '15px', flexShrink:0 }}>
                <span style={{ color:T.textDim }}>HP <span style={{ color:T.hp, fontWeight:'600' }}>{fmt(character.current_hp)}</span>/<span style={{ color:T.textDim }}>{fmt(character.max_hp)}</span></span>
                <span style={{ color:T.textDim }}>RP <span style={{ color:T.rp, fontWeight:'600' }}>{character.base_rp}</span></span>
              </div>
            )}
            {canRemove && (
              <button
                onClick={() => { if (confirming !== membership.character_id) { setConfirming(membership.character_id); return; } remove.mutateAsync(membership.character_id); setConfirming(null); }}
                onBlur={() => setConfirming(null)}
                style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.12em', background: confirming === membership.character_id ? T.hp : 'transparent', border:`1px solid ${T.hp}`, color: confirming === membership.character_id ? '#080b10' : T.hp, borderRadius:'2px', padding:'4px 10px', cursor:'pointer', flexShrink:0 }}>
                {confirming === membership.character_id ? 'CONFIRM' : isMe ? 'LEAVE' : 'REMOVE'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function CampaignDetail() {
  const { id }   = useParams<{ id: string }>();
  const isDM     = useAuthStore(selectIsDM);
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const deleteC  = useDeleteCampaign();
  const qc       = useQueryClient();

  const { data: campaign, isLoading, isError } = useCampaign(id);

  type TabId = 'members' | 'manage';
  const [activeTab, setActiveTab] = useState<TabId>('members');

  const handleDelete = async () => { if (!id) return; await deleteC.mutateAsync(id); navigate('/campaigns'); };

  const [launching, setLaunching]     = useState(false);
  const [launchError, setLaunchError] = useState('');
  const handleLaunchVTT = async () => {
    if (!id) return;
    setLaunching(true); setLaunchError('');
    try {
      const { data } = await api.post(`/sessions/campaigns/${id}/launch`);
      navigate(`/vtt/${data.session.id}`);
    } catch { setLaunchError('Could not start session. Please try again.'); setLaunching(false); }
  };

  const [refreshing, setRefreshing] = useState(false);
  const handleRefreshInvite = async () => {
    if (!id) return;
    setRefreshing(true);
    try { await api.post(`/campaigns/${id}/invites/refresh`); qc.invalidateQueries({ queryKey: ['campaigns', 'detail', id] }); }
    finally { setRefreshing(false); }
  };

  const isOwner  = campaign?.dm_user_id === user?.id;
  const tc       = TIER_COLOR[campaign?.world_tier_baseline ?? 'local'] ?? T.textMuted;
  const invite   = (campaign as any)?.invite;
  const inviteUrl = invite ? `${window.location.origin}/join/${invite.token}` : null;

  const tabs: { id: TabId; label: string; dmOnly?: boolean }[] = [
    { id:'members' as TabId, label:'Members' },
    { id:'manage'  as TabId, label:'Manage', dmOnly:true },
  ].filter(t => !t.dmOnly || (isDM && isOwner));

  useEffect(() => {
    // Keep campaign header visible when navigating from a scrolled list view.
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const mainEl = document.querySelector('main');
    if (mainEl instanceof HTMLElement) {
      mainEl.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [id]);

  if (isLoading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'calc(100vh - 52px)', fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.2em', color:T.textDim }}>LOADING…</div>;
  if (isError || !campaign) return <div style={{ padding:'60px 32px', textAlign:'center' }}><div style={{ fontFamily:"'Cinzel',serif", fontSize: '16px', letterSpacing:'0.2em', color:T.textDim, marginBottom:'16px' }}>CAMPAIGN NOT FOUND</div><Link to="/campaigns" style={{ color:T.gold, fontSize: '15px' }}>← Back to Campaigns</Link></div>;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 52px)', overflow:'hidden' }}>

      <div style={{ borderBottom:`1px solid ${T.border}`, padding:'20px 32px 0', background:T.surface, flexShrink:0 }}>
        <div style={{ marginBottom:'16px' }}>
          <Link to="/campaigns" style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'0.2em', color:T.textDim, textDecoration:'none' }}>← CAMPAIGNS</Link>
        </div>

        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'16px', gap:'24px' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'6px' }}>
              <h1 style={{ fontFamily:"'Cinzel',serif", fontSize: '25px', color:tc, margin:'0', letterSpacing:'0.1em', fontWeight:'700' }}>{campaign.name}</h1>
              {isDM && isOwner && <span style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.18em', color:T.dmGold, background:T.dmGold+'18', border:`1px solid ${T.dmGold}33`, borderRadius:'2px', padding:'2px 6px' }}>DM</span>}
            </div>
            {(campaign as any).summary && <p style={{ fontSize: '16px', color:T.textMuted, lineHeight:'1.6', margin:'0 0 8px', maxWidth:'560px' }}>{(campaign as any).summary}</p>}
            <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.18em', color:tc, background:tc+'18', border:`1px solid ${tc}44`, borderRadius:'2px', padding:'2px 8px' }}>{campaign.world_tier_baseline.toUpperCase()}</span>
              <span style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', color:T.textDim }}>{campaign.members.length} member{campaign.members.length !== 1 ? 's' : ''}</span>
            </div>

          </div>

          {/* Launch VTT + invite link */}
          {isDM && isOwner && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'8px', flexShrink:0 }}>
              <button onClick={handleLaunchVTT} disabled={launching} style={{ fontFamily:"'Cinzel',serif", fontSize: '15px', letterSpacing:'0.16em', background: launching ? T.goldDim : T.gold, border:`1px solid ${T.gold}`, borderRadius:'3px', padding:'11px 26px', cursor: launching ? 'not-allowed' : 'pointer', color:'#080b10', fontWeight:'700', display:'flex', alignItems:'center', gap:'8px' }}>
                <span style={{ fontSize: '17px' }}>⚔</span>
                {launching ? 'LAUNCHING…' : 'LAUNCH VTT'}
              </button>
              {launchError && <span style={{ fontSize: '14px', color:T.hp }}>{launchError}</span>}
              {inviteUrl && (
                <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  <code style={{ fontSize: '13px', color:T.rp, background:T.card, border:`1px solid ${T.border}`, borderRadius:'2px', padding:'3px 8px', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inviteUrl}</code>
                  <CopyButton text={inviteUrl} />
                  <button onClick={handleRefreshInvite} disabled={refreshing} title="Generate a new invite link" style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', background:'transparent', border:`1px solid ${T.border}`, borderRadius:'2px', padding:'4px 7px', cursor:'pointer', color:T.textMuted }}>
                    ↻
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display:'flex' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id as TabId)} style={{ background:'transparent', border:'none', borderBottom: activeTab === t.id ? `2px solid ${tc}` : '2px solid transparent', padding:'10px 20px', cursor:'pointer', fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.16em', color: activeTab === t.id ? tc : T.textMuted, transition:'all 0.15s', fontWeight: activeTab === t.id ? '600' : '400' }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{
        flex: 1, overflow: activeTab === 'manage' ? 'hidden' : 'auto',
        padding: activeTab === 'manage' ? 0 : '28px 32px',
        maxWidth: activeTab === 'manage' ? 'none' : '800px',
        width: '100%',
      }}>
        {activeTab === 'members' && (
          <>
            <SectionLabel>PARTY ({campaign.members.length})</SectionLabel>
            <MembersPanel members={campaign.members} campaignId={campaign.id} isDM={isDM && isOwner} currentUserId={user?.id ?? ''} />
          </>
        )}
        {activeTab === 'manage' && isDM && isOwner && (
          <CampaignManager campaign={campaign} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}