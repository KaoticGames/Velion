import React from 'react';
/**
 * PartyPanel.tsx — Right sidebar top section
 * Shows connected players (with HP/RP) and enemy token list for DM.
 */

import { useState } from 'react';
import type { MapToken, EnemyInstance } from './types';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

const T = {
  surface:   '#0d1018',
  card:      '#111520',
  border:    '#1c2230',
  gold:      '#c4922a',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  textDim:   '#504538',
  rp:        '#3ab5e8',
  hp:        '#d45c5c',
  green:     '#50a060',
};

interface Props {
  tokens:          MapToken[];
  enemyInstances:  EnemyInstance[];
  isDM:            boolean;
  sessionId:       string;
  campaignId:      string;
  currentCharacterId: string | null;
  socket:          {
    updateEnemyHP: (id: string, hp: number, defeated?: boolean) => void;
    broadcastTokenPlaced: (token: unknown) => void;
  };
}

type CampaignMemberRow = {
  membership: { character_id: string; user_id: string };
  character: { id: string; name: string; portrait_url: string | null } | null;
  user: { id: string; email: string } | null;
};

export default function PartyPanel({ tokens, enemyInstances, isDM, sessionId, campaignId, currentCharacterId, socket }: Props) {
  const playerTokens = tokens.filter(t => t.entity_type === 'character');
  const enemyTokens  = tokens.filter(t => t.entity_type === 'enemy');
  const [placingCharacterId, setPlacingCharacterId] = useState<string | null>(null);

  const { data: campaignMembers = [] } = useQuery({
    queryKey: ['campaign-members', campaignId],
    enabled: isDM && !!campaignId,
    queryFn: async (): Promise<CampaignMemberRow[]> => {
      const { data } = await api.get<{ members?: CampaignMemberRow[] }>(`/campaigns/${campaignId}`);
      const members = data.members;
      return Array.isArray(members) ? members : [];
    },
    staleTime: 30_000,
  });

  const placeCharacterToken = async (member: CampaignMemberRow) => {
    const character = member.character;
    if (!character) return;
    setPlacingCharacterId(character.id);
    try {
      const created = await api.post(`/vtt/sessions/${sessionId}/tokens`, {
        entity_type: 'character',
        entity_id: character.id,
        cell_x: 0,
        cell_y: 0,
        label: character.name,
        token_url: character.portrait_url ?? null,
      });
      socket.broadcastTokenPlaced(created);
    } catch (e) {
      console.error(e);
    } finally {
      setPlacingCharacterId(null);
    }
  };

  return (
    <div style={{ padding: '10px' }}>
      {/* Players */}
      <SectionLabel>PARTY</SectionLabel>
      {playerTokens.length === 0 ? (
        <div style={{ fontSize: '10px', color: T.textDim, padding: '4px 0 8px', fontFamily: "'Cinzel',serif", letterSpacing: '0.12em' }}>
          NO PLAYER TOKENS ON MAP
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
          {playerTokens.map(token => (
            <PlayerTokenRow
              key={token.id}
              token={token}
              isOwnToken={token.entity_id === currentCharacterId}
            />
          ))}
        </div>
      )}

      {isDM && campaignMembers.length > 0 && (
        <>
          <SectionLabel>CAMPAIGN PARTY</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
            {campaignMembers
              .filter(m => !!m.character)
              .map(member => {
                const character = member.character!;
                const tokenOnMap = playerTokens.some(t => t.entity_id === character.id);
                const isPlacing = placingCharacterId === character.id;
                return (
                  <div
                    key={character.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      background: T.card,
                      border: `1px solid ${T.border}`,
                      borderRadius: '3px',
                      padding: '6px 8px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '11px', color: T.text, fontFamily: "'Cinzel',serif", letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {character.name}
                      </div>
                      <div style={{ fontSize: '9px', color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {member.user?.email ?? 'Player'}
                      </div>
                    </div>
                    {tokenOnMap ? (
                      <span style={{ fontSize: '9px', color: T.green, letterSpacing: '0.08em' }}>ON MAP</span>
                    ) : (
                      <button
                        disabled={isPlacing}
                        onClick={() => void placeCharacterToken(member)}
                        style={{
                          background: isPlacing ? T.border : `${T.gold}22`,
                          border: `1px solid ${T.gold}`,
                          borderRadius: '2px',
                          padding: '4px 8px',
                          cursor: isPlacing ? 'default' : 'pointer',
                          color: T.gold,
                          fontSize: '9px',
                          fontFamily: "'Cinzel',serif",
                          letterSpacing: '0.08em',
                          flexShrink: 0,
                        }}
                      >
                        {isPlacing ? 'ADDING...' : 'PLACE'}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      )}

      {/* Enemy tokens (DM sees HP bars + damage input) */}
      {isDM && enemyTokens.length > 0 && (
        <>
          <SectionLabel>ENEMIES ON MAP</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {enemyTokens.map(token => {
              const inst = enemyInstances.find(e => e.id === token.entity_id);
              if (!inst) return null;
              return (
                <EnemyTokenRow
                  key={token.id}
                  token={token}
                  instance={inst}
                  sessionId={sessionId}
                  socket={socket}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Player row (overview only — actions live in PlayerBattleHUD) ───────────

function PlayerTokenRow({ token, isOwnToken }: { token: MapToken; isOwnToken: boolean }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: '3px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 8px',
      }}
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          background: '#0a1a2a',
          border: `1px solid ${T.rp}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          color: T.rp,
          flexShrink: 0,
          fontWeight: 700,
        }}
      >
        {(token.label ?? '?').slice(0, 2).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '11px',
            color: T.text,
            fontFamily: "'Cinzel',serif",
            letterSpacing: '0.08em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {token.label ?? 'Unknown'}
        </div>
        <div style={{ fontSize: '10px', color: T.textDim, display: 'flex', gap: '8px' }}>
          <span>
            {token.cell_x},{token.cell_y}
          </span>
          {isOwnToken && <span style={{ color: T.green, letterSpacing: '0.08em' }}>YOU</span>}
        </div>
      </div>
    </div>
  );
}

// ── Enemy token row (DM) ───────────────────────────────────────────────────

function EnemyTokenRow({ token, instance, sessionId, socket }: {
  key?:       string;
  token:      MapToken;
  instance:   EnemyInstance;
  sessionId:  string;
  socket:     Props['socket'];
}) {
  const [dmgInput, setDmgInput] = useState('');
  const [expanded, setExpanded] = useState(false);

  const hpPct = Math.max(0, instance.current_hp / instance.max_hp);
  const hpColor = hpPct > 0.5 ? T.green : hpPct > 0.25 ? T.gold : T.hp;

  const applyDamage = async () => {
    const val = parseInt(dmgInput);
    if (isNaN(val) || val === 0) return;
    const newHP    = Math.max(0, instance.current_hp - val);
    const defeated = newHP <= 0;
    try {
      await api.patch(`/vtt/sessions/${sessionId}/enemies/${instance.id}`, { current_hp: newHP, is_defeated: defeated });
      socket.updateEnemyHP(instance.id, newHP, defeated);
    } catch (e) { console.error(e); }
    setDmgInput('');
  };

  const applyHealing = async () => {
    const val = parseInt(dmgInput);
    if (isNaN(val) || val === 0) return;
    const newHP = Math.min(instance.max_hp, instance.current_hp + val);
    try {
      await api.patch(`/vtt/sessions/${sessionId}/enemies/${instance.id}`, { current_hp: newHP, is_defeated: false });
      socket.updateEnemyHP(instance.id, newHP, false);
    } catch (e) { console.error(e); }
    setDmgInput('');
  };

  return (
    <div style={{ background: T.card, border: `1px solid ${instance.is_defeated ? T.textDim : T.border}`, borderRadius: '3px', overflow: 'hidden' }}>
      {/* Header row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        <div style={{
          width: '26px', height: '26px', borderRadius: '50%',
          background: '#2a0a0a', border: `1px solid ${T.hp}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', color: T.hp, flexShrink: 0, fontWeight: 700,
          opacity: instance.is_defeated ? 0.4 : 1,
        }}>
          {instance.label.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', color: instance.is_defeated ? T.textDim : T.text, fontFamily: "'Cinzel',serif", letterSpacing: '0.08em' }}>
            {instance.label}
          </div>
          {/* HP bar */}
          <div style={{ height: '3px', background: '#1a0505', borderRadius: '2px', marginTop: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${hpPct * 100}%`, background: hpColor, borderRadius: '2px', transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: '9px', color: T.textMuted, marginTop: '2px' }}>
            {instance.current_hp} / {instance.max_hp}
            {instance.is_defeated && <span style={{ color: T.hp, marginLeft: '6px' }}>DEFEATED</span>}
          </div>
        </div>
        <span style={{ fontSize: '9px', color: T.textDim }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded damage controls */}
      {expanded && !instance.is_defeated && (
        <div style={{ padding: '6px 8px 8px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            type="number"
            value={dmgInput}
            onChange={e => setDmgInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyDamage()}
            placeholder="amount"
            style={{
              flex: 1, background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: '2px', padding: '4px 6px', color: T.text, fontSize: '11px',
              fontFamily: "'Inter',sans-serif", outline: 'none',
            }}
          />
          <button
            onClick={applyDamage}
            title="Apply damage"
            style={{ background: T.hp + '22', border: `1px solid ${T.hp}`, borderRadius: '2px', padding: '4px 8px', cursor: 'pointer', color: T.hp, fontSize: '10px', fontFamily: "'Cinzel',serif" }}
          >DMG</button>
          <button
            onClick={applyHealing}
            title="Apply healing"
            style={{ background: T.green + '22', border: `1px solid ${T.green}`, borderRadius: '2px', padding: '4px 8px', cursor: 'pointer', color: T.green, fontSize: '10px', fontFamily: "'Cinzel',serif" }}
          >HEAL</button>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "'Cinzel',serif", fontSize: '8px', letterSpacing: '0.22em', color: T.textDim, marginBottom: '6px', borderBottom: `1px solid ${T.border}`, paddingBottom: '4px' }}>
      {children}
    </div>
  );
}