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

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore }    from '@/store/authStore';
import { useVTTSocket }    from './useVTTSocket';
import { useVTTStore }     from './useVTTState';
import MapCanvas           from './MapCanvas';
import DMToolbar           from './DMToolbar';
import PartyPanel          from './PartyPanel';
import DiceRollerPortal, { DiceToolbarButton } from './DiceRoller';
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
    diceLog, diceVisibility, activeTool, toolColor, fogBrushSize, fogBrushShape,
    tokens, enemyInstances, fogCells, fogSections, shapes, rulers, campaignMaps,
    dispatch,
  } = useVTTStore();

  const [showDiceTray, setShowDiceTray] = useState(false);
  const socket = useVTTSocket(sessionId, undefined);

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

  // ── Loading ──────────────────────────────────────────────────────────
  if (!connected || !session) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:T.bg, flexDirection:'column', gap:'16px' }}>
        <div style={{ width:'32px', height:'32px', border:`2px solid ${T.border}`, borderTop:`2px solid ${T.gold}`, borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.2em', color:T.textDim }}>CONNECTING…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Session ended ────────────────────────────────────────────────────
  if (sessionEnded) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:T.bg, flexDirection:'column', gap:'12px' }}>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'18px', color:T.textMuted, letterSpacing:'0.12em' }}>SESSION ENDED</span>
        <span style={{ fontSize:'12px', color:T.textDim }}>Returning to campaigns…</span>
      </div>
    );
  }

  // ── Player waiting screen ────────────────────────────────────────────
  if (!isDM && !session.is_started) {
    return (
      <WaitingScreen sessionName={session.name} />
    );
  }

  // ── Main VTT layout ──────────────────────────────────────────────────
  const isStarted = session.is_started;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:T.bg, overflow:'hidden', fontFamily:"'Inter',sans-serif" }}>

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', height:'44px', background:T.surface, borderBottom:`1px solid ${T.border}`, flexShrink:0, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button
            onClick={() => navigate(`/campaigns/${session.campaign_id}`)}
            style={{ background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize:'16px', padding:'4px', lineHeight:1 }}
            title="Back to campaign"
          >←</button>
          {isDM ? (
            <select
              value={activeMap?.id ?? ''}
              onChange={e => e.target.value && socket.changeMap(e.target.value)}
              style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.12em', color:T.text, background:T.card, border:`1px solid ${T.border}`, borderRadius:'3px', padding:'4px 10px', cursor:'pointer', outline:'none', minWidth:'140px' }}
            >
              <option value="" disabled>{activeMap?.name ?? 'NO MAP SET'}</option>
              {campaignMaps.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:'12px', letterSpacing:'0.16em', color:T.text }}>
              {activeMap?.name ?? 'NO MAP SET'}
            </span>
          )}
          {!isStarted && isDM && (
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.18em', color:T.gold, background:T.gold+'18', border:`1px solid ${T.gold}33`, borderRadius:'2px', padding:'2px 8px' }}>
              PREP
            </span>
          )}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          {/* Connected indicator */}
          <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
            <div style={{ width:'6px', height:'6px', borderRadius:'50%', background: connected ? T.green : T.hp }} />
            <span style={{ fontSize:'10px', color:T.textDim }}>
              {connected ? 'LIVE' : 'RECONNECTING…'}
            </span>
          </div>



          {/* DM: Start Session or End Session */}
          {isDM && !isStarted && (
            <button
              onClick={socket.startSession}
              style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.14em', background:T.green, border:`1px solid ${T.green}`, borderRadius:'2px', padding:'6px 16px', cursor:'pointer', color:'#080b10', fontWeight:'700' }}
            >
              START SESSION
            </button>
          )}
          {isDM && isStarted && (
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.18em', color:T.green }}>
              SESSION LIVE
            </span>
          )}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left sidebar — DM tools (DM only) */}
        {isDM && (
          <DMToolbar
            activeTool={activeTool}
            toolColor={toolColor}
            fogBrushSize={fogBrushSize}
            fogBrushShape={fogBrushShape}
            fogSections={fogSections}
            campaignMaps={campaignMaps}
            activeMapId={activeMap?.id ?? null}
            sessionId={sessionId!}
            campaignId={session.campaign_id}
            showDiceTray={showDiceTray}
            onToggleDiceTray={() => setShowDiceTray(v => !v)}
            socket={socket}
            dispatch={dispatch}
          />
        )}

        {/* Player dice toolbar — shown when not DM */}
        {!isDM && (
          <div style={{ width:'56px', display:'flex', flexDirection:'column', alignItems:'center', background:T.surface, borderRight:`1px solid ${T.border}`, padding:'8px 0', flexShrink:0 }}>
            <DiceToolbarButton open={showDiceTray} onClick={() => setShowDiceTray(v => !v)} />
          </div>
        )}

        {/* Map canvas — centre */}
        <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
          {activeMap ? (
            <MapCanvas
              map={activeMap}
              tokens={tokens}
              enemyInstances={enemyInstances}
              fogCells={fogCells}
              fogSections={fogSections}
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
      {/* Dice tray — always mounted, shown/hidden via CSS so WebGL canvas stays alive */}
      <DiceRollerPortal
        open={showDiceTray}
        toolbarWidth={56}
        sessionId={sessionId!}
        visibility={diceVisibility}
        isDM={isDM}
        socket={socket}
        dispatch={dispatch}
        onClose={() => setShowDiceTray(false)}
      />
    </div>
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
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'24px' }}>⚔</div>
      </div>

      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'16px', letterSpacing:'0.16em', color:T.text, marginBottom:'8px' }}>
          {sessionName || 'WAITING FOR DM'}
        </div>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.2em', color:T.textDim }}>
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
      <span style={{ fontSize:'32px', opacity:0.3 }}>🗺</span>
      <span style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.18em' }}>
        {isDM ? 'SELECT A MAP FROM THE TOOLBAR' : 'AWAITING MAP'}
      </span>
    </div>
  );
}