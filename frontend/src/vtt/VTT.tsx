/**
 * VTT.tsx — Main VTT page at /vtt/:sessionId
 *
 * Full-screen, no nav. Three states:
 *   1. Connecting — spinner
 *   2. Waiting    — players see this until DM presses Start Session
 *   3. Live       — map canvas + panels
 *
 * DM in state 2 sees the prep view: full canvas access, Start Session button.
 * Players in state 2 see a holding screen.
 */

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore }    from '@/store/authStore';
import { api } from '@/lib/api';
import { useVTTSocket }    from './useVTTSocket';
import { useVTTStore }     from './useVTTState';
import MapCanvas           from './MapCanvas';
import DMToolbar           from './DMToolbar';
import PartyPanel          from './PartyPanel';
import PlayerBattleHUD     from './PlayerBattleHUD';
import DiceLog             from './DiceLog';
// ── Theme ──────────────────────────────────────────────────────────────────

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

// ── Heartbeat interval ────────────────────────────────────────────────────

const HEARTBEAT_MS = 90_000; // 90 seconds

// ── Component ─────────────────────────────────────────────────────────────

export default function VTT() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate      = useNavigate();
  const user          = useAuthStore(s => s.user);

  const {
    connected, sessionEnded, session, isDM, activeMap,
    diceLog, diceVisibility, activeTool, toolColor, fogBrushSize, fogBrushShape, fogBrushMode,
    tokens, enemyInstances, fogSections, activeFogLayerId, shapes, rulers, campaignMaps,
    dispatch,
  } = useVTTStore();

  /**
   * Party character for this account in the campaign (players and DMs who joined with a PC).
   * Used for battle HUD + party “YOU”; enemy tokens are never matched (`entity_type === 'character'` only).
   */
  const { data: currentCharacterId = null } = useQuery({
    queryKey: ['vtt-my-campaign-character', session?.campaign_id, user?.id],
    enabled: !!connected && !!session?.campaign_id && !!user?.id,
    queryFn: async (): Promise<string | null> => {
      const { data } = await api.get<{
        members?: Array<{ membership: { user_id: string; character_id: string }; character: { id: string } | null }>;
      }>(`/campaigns/${session!.campaign_id}`);
      const members = data.members;
      if (!Array.isArray(members)) return null;
      const row = members.find((m) => m.membership.user_id === user!.id);
      if (!row) return null;
      return row.character?.id ?? row.membership.character_id ?? null;
    },
    staleTime: 60_000,
  });

  const socket = useVTTSocket(sessionId, currentCharacterId ?? undefined);

  useEffect(() => {
    if (!sessionId) return;
    localStorage.setItem('activeVttSessionId', sessionId);
    return () => {
      if (localStorage.getItem('activeVttSessionId') === sessionId) {
        localStorage.removeItem('activeVttSessionId');
      }
    };
  }, [sessionId]);

  // ── Heartbeat to keep session alive ─────────────────────────────────
  useEffect(() => {
    if (!sessionId || !connected) return;
    const tick = () => {
      fetch(`/api/v1/sessions/${sessionId}/heartbeat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken}` },
      }).then(r => { if (r.status === 410) navigate('/campaigns'); });
    };
    const id = setInterval(tick, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [sessionId, connected]);

  // ── Navigate away if session ended ──────────────────────────────────
  useEffect(() => {
    if (sessionEnded) {
      setTimeout(() => navigate('/campaigns'), 3000);
    }
  }, [sessionEnded]);

  useEffect(() => {
    const onGlobalRoll = (event: Event) => {
      const custom = event as CustomEvent<{
        formula: string;
        label: string;
        visibility: 'public' | 'private' | 'dm';
        results: number[];
        total: number;
        source_label?: string;
        requestMeta?: unknown;
      }>;
      const payload = custom.detail;
      if (!payload) return;
      const { requestMeta: _rm, ...rest } = payload;
      socket.rollDice(rest);
    };
    window.addEventListener('velion:dice-roll-submit', onGlobalRoll as EventListener);
    return () => window.removeEventListener('velion:dice-roll-submit', onGlobalRoll as EventListener);
  }, [socket]);

  // ── Loading ──────────────────────────────────────────────────────────
  if (!connected || !session) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:T.bg, flexDirection:'column', gap:'16px' }}>
        <div style={{ width:'32px', height:'32px', border:`2px solid ${T.border}`, borderTop:`2px solid ${T.gold}`, borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
        <span style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.2em', color:T.textDim }}>CONNECTING…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Session ended ────────────────────────────────────────────────────
  if (sessionEnded) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:T.bg, flexDirection:'column', gap:'12px' }}>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize: '21px', color:T.textMuted, letterSpacing:'0.12em' }}>SESSION ENDED</span>
        <span style={{ fontSize: '15px', color:T.textDim }}>Returning to campaigns…</span>
      </div>
    );
  }

  // ── Player waiting screen ────────────────────────────────────────────
  if (!isDM && !session.is_started) {
    return <WaitingScreen sessionName={session.name} />;
  }

  // ── Main VTT layout ──────────────────────────────────────────────────
  const isStarted = session.is_started;
  const ownCharacterToken =
    isStarted && currentCharacterId
      ? tokens.find((t) => t.entity_type === 'character' && t.entity_id === currentCharacterId) ?? null
      : null;

  return (
    <>
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:T.bg, overflow:'hidden', fontFamily:"'Inter',sans-serif" }}>

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', height:'44px', background:T.surface, borderBottom:`1px solid ${T.border}`, flexShrink:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button
            onClick={() => navigate(`/campaigns/${session.campaign_id}`)}
            style={{ background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize: '19px', padding:'4px', lineHeight:1 }}
            title="Back to campaign"
          >←</button>
          {isDM ? (
            <select
              value={activeMap?.id ?? ''}
              onChange={e => e.target.value && socket.changeMap(e.target.value)}
              style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.12em', color:T.text, background:T.card, border:`1px solid ${T.border}`, borderRadius:'3px', padding:'4px 10px', cursor:'pointer', outline:'none', minWidth:'140px' }}
            >
              <option value="" disabled>{activeMap?.name ?? 'NO MAP SET'}</option>
              {campaignMaps.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontFamily:"'Cinzel',serif", fontSize: '15px', letterSpacing:'0.16em', color:T.text }}>
              {activeMap?.name ?? 'NO MAP SET'}
            </span>
          )}
          {!isStarted && isDM && (
            <span style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.18em', color:T.gold, background:T.gold+'18', border:`1px solid ${T.gold}33`, borderRadius:'2px', padding:'2px 8px' }}>
              PREP
            </span>
          )}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          {/* Connected indicator */}
          <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
            <div style={{ width:'6px', height:'6px', borderRadius:'50%', background: connected ? T.green : T.hp }} />
            <span style={{ fontSize: '13px', color:T.textDim }}>
              {connected ? 'LIVE' : 'RECONNECTING…'}
            </span>
          </div>



          {/* DM: Start Session or End Session */}
          {isDM && !isStarted && (
            <button
              onClick={socket.startSession}
              style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'0.14em', background:T.green, border:`1px solid ${T.green}`, borderRadius:'2px', padding:'6px 16px', cursor:'pointer', color:'#080b10', fontWeight:'700' }}
            >
              START SESSION
            </button>
          )}
          {isDM && isStarted && (
            <span style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.18em', color:T.green }}>
              SESSION LIVE
            </span>
          )}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Map canvas — centre */}
        <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
          {/* Floating DM toolbar overlay */}
          {isDM && (
            <div style={{
              position:'absolute',
              left:14,
              top:14,
              zIndex:40,
              pointerEvents:'none',
            }}>
              <div style={{ pointerEvents:'auto' }}>
                <DMToolbar
                  activeTool={activeTool}
                  toolColor={toolColor}
                  fogBrushSize={fogBrushSize}
                  fogBrushShape={fogBrushShape}
                  fogBrushMode={fogBrushMode}
                  activeFogLayerId={activeFogLayerId}
                  fogSections={fogSections}
                  campaignMaps={campaignMaps}
                  activeMapId={activeMap?.id ?? null}
                  sessionId={sessionId!}
                  campaignId={session.campaign_id}
                  socket={socket}
                  dispatch={dispatch}
                />
              </div>
            </div>
          )}

          {activeMap ? (
            <MapCanvas
              map={activeMap}
              tokens={tokens}
              enemyInstances={enemyInstances}
              fogSections={fogSections}
              activeFogLayerId={activeFogLayerId}
              fogBrushMode={fogBrushMode}
              shapes={shapes}
              rulers={rulers}
              isDM={isDM}
              activeTool={activeTool}
              toolColor={toolColor}
              fogBrushSize={fogBrushSize}
              fogBrushShape={fogBrushShape}
              userId={user?.id ?? ''}
              sessionId={sessionId!}
              socket={socket}
              dispatch={dispatch}
            />
          ) : (
            <NoMapPlaceholder isDM={isDM} />
          )}

          {ownCharacterToken && (
            <PlayerBattleHUD
              token={ownCharacterToken}
              characterId={currentCharacterId!}
              diceVisibility={diceVisibility}
            />
          )}
        </div>

        {/* Right sidebar */}
        <div style={{ width:'280px', display:'flex', flexDirection:'column', background:T.surface, borderLeft:`1px solid ${T.border}`, flexShrink:0, overflow:'hidden' }}>
          {/* Party panel — top half */}
          <div style={{ flex:'0 0 auto', borderBottom:`1px solid ${T.border}` }}>
            <PartyPanel
              tokens={tokens}
              enemyInstances={enemyInstances}
              isDM={isDM}
              sessionId={sessionId!}
              campaignId={session.campaign_id}
              currentCharacterId={currentCharacterId}
              socket={socket}
            />
          </div>

          {/* Dice log — fills remaining space */}
          <div style={{ flex:1, overflow:'hidden' }}>
            <DiceLog
              entries={diceLog}
              userId={user?.id ?? ''}
              isDM={isDM}
            />
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// ── Waiting screen ─────────────────────────────────────────────────────────

function WaitingScreen({ sessionName }: { sessionName: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:T.bg, flexDirection:'column', gap:'24px' }}>
      {/* Animated orb */}
      <div style={{ position:'relative', width:'80px', height:'80px' }}>
        <div style={{ position:'absolute', inset:0, border:`1px solid ${T.gold}33`, borderRadius:'50%', animation:'pulse 2s ease-in-out infinite' }} />
        <div style={{ position:'absolute', inset:'12px', border:`1px solid ${T.gold}55`, borderRadius:'50%', animation:'pulse 2s ease-in-out infinite 0.4s' }} />
        <div style={{ position:'absolute', inset:'24px', background:T.gold+'22', border:`1px solid ${T.gold}`, borderRadius:'50%' }} />
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize: '27px' }}>⚔</div>
      </div>

      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize: '19px', letterSpacing:'0.16em', color:T.text, marginBottom:'8px' }}>
          {sessionName || 'WAITING FOR DM'}
        </div>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'0.2em', color:T.textDim }}>
          THE DM IS PREPARING THE SESSION
        </div>
      </div>

      <div style={{ display:'flex', gap:'6px' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ width:'6px', height:'6px', borderRadius:'50%', background:T.gold, opacity:0.4, animation:`blink 1.2s ease-in-out infinite ${i * 0.2}s` }} />
        ))}
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity:0.3; transform:scale(1); } 50% { opacity:0.8; transform:scale(1.05); } }
        @keyframes blink { 0%,100% { opacity:0.2; } 50% { opacity:1; } }
      `}</style>
    </div>
  );
}

// ── No map placeholder ─────────────────────────────────────────────────────

function NoMapPlaceholder({ isDM }: { isDM: boolean }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:'12px', color:T.textDim }}>
      <span style={{ fontSize: '35px', opacity:0.3 }}>🗺</span>
      <span style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.18em' }}>
        {isDM ? 'SELECT A MAP FROM THE TOOLBAR' : 'AWAITING MAP'}
      </span>
    </div>
  );
}