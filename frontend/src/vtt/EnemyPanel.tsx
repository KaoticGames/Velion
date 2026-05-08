/**
 * EnemyPanel.tsx — DM enemy stat block panel
 *
 * DM can browse enemies from the library, place tokens on the map,
 * and roll directly from stat block actions (attacks, saves).
 * Rolls are sent via socket as attack:rolled events.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api }      from '@/lib/api';
import type { Action } from './useVTTState';
import type { EnemyStatBlock, EnemyInstance, MapToken, VTTMap } from './types';

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
  dmGold:    '#e8b84b',
};

interface Props {
  sessionId:       string;
  enemyInstances:  EnemyInstance[];
  tokens:          MapToken[];
  map:             VTTMap | null;
  socket:          {
    rollAttack:           (p: { source_label: string; formula: string; results: number[]; total: number; damage_type?: string; visibility: 'public' | 'dm' }) => void;
    broadcastTokenPlaced: (token: unknown) => void;
  };
  dispatch: (action: Action) => void;
}

// ── Simple dice roller ─────────────────────────────────────────────────────

function rollFormula(formula: string): { results: number[]; total: number } {
  const match = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return { results: [0], total: 0 };
  const count  = parseInt(match[1]);
  const sides  = parseInt(match[2]);
  const mod    = parseInt(match[3] ?? '0');
  const results: number[] = [];
  for (let i = 0; i < count; i++) results.push(Math.floor(Math.random() * sides) + 1);
  return { results, total: results.reduce((s, n) => s + n, 0) + mod };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function EnemyPanel({ sessionId, enemyInstances, tokens, map, socket, dispatch }: Props) {
  const [search, setSearch]   = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [placing, setPlacing]   = useState<EnemyStatBlock | null>(null);
  const [placeLabel, setPlaceLabel] = useState('');
  const [rollVisibility, setRollVisibility] = useState<'public' | 'dm'>('public');

  const { data: enemiesData } = useQuery({
    queryKey: ['library', 'enemies'],
    queryFn:  () => api.get('/library/enemies').then(r => r.data?.data ?? []),
    staleTime: 5 * 60_000,
  });

  const enemies: EnemyStatBlock[] = (enemiesData ?? []).filter((e: EnemyStatBlock) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase())
  );

  const placeEnemy = async () => {
    if (!placing || !map) return;
    const label = placeLabel.trim() || placing.name;
    try {
      // Create enemy instance
      const instResp = await api.post(`/vtt/sessions/${sessionId}/enemies`, {
        enemy_id: placing.id,
        label,
        max_hp:   placing.hp,
      });
      const instance = instResp.data;

      // Place token at (0,0) — DM can drag it to position
      const tokenResp = await api.post(`/vtt/sessions/${sessionId}/tokens`, {
        entity_type: 'enemy',
        entity_id:   instance.id,
        cell_x:      0,
        cell_y:      0,
        label,
      });
      const token = tokenResp.data;

      dispatch({ type: 'DICE_RESULT', entry: instance }); // reuse to update enemy list
      dispatch({ type: 'TOKEN_PLACED', token });
      socket.broadcastTokenPlaced(token);
    } catch (e) { console.error(e); }

    setPlacing(null);
    setPlaceLabel('');
  };

  const rollAttack = (enemy: EnemyStatBlock, instance: EnemyInstance | undefined, attackName: string, formula: string, damageType: string) => {
    const { results, total } = rollFormula(formula);
    const source_label = instance ? `${instance.label} — ${attackName}` : `${enemy.name} — ${attackName}`;
    socket.rollAttack({ source_label, formula, results, total, damage_type: damageType, visibility: rollVisibility });
  };

  const rollSave = (enemy: EnemyStatBlock, instance: EnemyInstance | undefined, attr: string, val: number) => {
    const mod     = Math.floor((val - 10) / 2);
    const formula = mod >= 0 ? `1d20+${mod}` : `1d20${mod}`;
    const { results, total } = rollFormula(formula);
    const source_label = instance ? `${instance.label} — ${attr} Save` : `${enemy.name} — ${attr} Save`;
    socket.rollAttack({ source_label, formula, results, total, visibility: rollVisibility });
  };

  const classColor: Record<string, string> = {
    minion:   T.textMuted,
    standard: T.text,
    elite:    T.gold,
    boss:     T.hp,
  };

  return (
    <div style={{ padding: '10px' }}>
      {/* Header */}
      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.22em', color: T.textDim, marginBottom: '8px', borderBottom: `1px solid ${T.border}`, paddingBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>ENEMIES</span>
        {/* Roll visibility toggle */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['public', 'dm'] as const).map(v => (
            <button key={v} onClick={() => setRollVisibility(v)}
              style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.12em', padding: '2px 6px', borderRadius: '2px', cursor: 'pointer', background: rollVisibility === v ? T.gold + '22' : 'transparent', border: `1px solid ${rollVisibility === v ? T.gold : T.border}`, color: rollVisibility === v ? T.gold : T.textDim }}
            >{v.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search enemies…"
        style={{ width: '100%', background: T.surface, border: `1px solid ${T.border}`, borderRadius: '2px', padding: '5px 8px', color: T.text, fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginBottom: '6px' }}
      />

      {/* Enemy list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {enemies.slice(0, 20).map((enemy: EnemyStatBlock) => {
          const isOpen = expanded === enemy.id;
          // Find any placed instances of this enemy
          const instances = enemyInstances.filter(e => e.enemy_id === enemy.id);

          return (
            <div key={enemy.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: '3px', overflow: 'hidden' }}>
              {/* Row header */}
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', cursor: 'pointer' }}
                onClick={() => setExpanded(isOpen ? null : enemy.id)}
              >
                <div>
                  <span style={{ fontSize: '14px', color: T.text, fontFamily: "'Cinzel',serif", letterSpacing: '0.08em' }}>{enemy.name}</span>
                  <span style={{ fontSize: '12px', color: classColor[enemy.classification] ?? T.textMuted, marginLeft: '6px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{enemy.classification}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {/* Place token button */}
                  <button
                    onClick={e => { e.stopPropagation(); setPlacing(enemy); setPlaceLabel(enemy.name); }}
                    title="Place token on map"
                    style={{ background: T.gold + '18', border: `1px solid ${T.gold}44`, borderRadius: '2px', padding: '2px 6px', cursor: 'pointer', color: T.gold, fontSize: '12px', fontFamily: "'Cinzel',serif" }}
                  >+ TOKEN</button>
                  <span style={{ fontSize: '12px', color: T.textDim }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded stat block */}
              {isOpen && (
                <div style={{ padding: '0 8px 10px', borderTop: `1px solid ${T.border}` }}>
                  {/* Core stats */}
                  <div style={{ display: 'flex', gap: '10px', padding: '8px 0 6px', flexWrap: 'wrap' }}>
                    {[['HP', enemy.hp], ['POW', enemy.power], ['AGI', enemy.agility], ['FOC', enemy.focus], ['PRE', enemy.presence]].map(([k, v]) => (
                      <div key={k as string} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '12px', color: T.textDim, fontFamily: "'Cinzel',serif", letterSpacing: '0.1em' }}>{k}</div>
                        <div style={{ fontSize: '16px', color: T.text, fontWeight: 700 }}>{v as number}</div>
                      </div>
                    ))}
                  </div>

                  {/* Saves */}
                  <div style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '4px' }}>SAVES</div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {[['POW', enemy.power], ['AGI', enemy.agility], ['FOC', enemy.focus], ['PRE', enemy.presence]].map(([attr, val]) => (
                      <button
                        key={attr as string}
                        onClick={() => {
                          const inst = instances[0];
                          rollSave(enemy, inst, attr as string, val as number);
                        }}
                        style={{ background: T.rp + '18', border: `1px solid ${T.rp}44`, borderRadius: '2px', padding: '3px 8px', cursor: 'pointer', color: T.rp, fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.1em' }}
                      >
                        {attr as string} {(Math.floor(((val as number) - 10) / 2) >= 0 ? '+' : '')}{Math.floor(((val as number) - 10) / 2)}
                      </button>
                    ))}
                  </div>

                  {/* Attacks */}
                  {enemy.attacks.length > 0 && (
                    <>
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '4px' }}>ATTACKS</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '8px' }}>
                        {enemy.attacks.map((atk, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: T.surface, borderRadius: '2px', padding: '4px 8px' }}>
                            <div>
                              <span style={{ fontSize: '13px', color: T.text }}>{atk.name}</span>
                              <span style={{ fontSize: '12px', color: T.textMuted, marginLeft: '6px' }}>{atk.damage_dice} {atk.damage_type}</span>
                            </div>
                            <button
                              onClick={() => {
                                const inst = instances[0];
                                rollAttack(enemy, inst, atk.name, atk.damage_dice, atk.damage_type);
                              }}
                              style={{ background: T.hp + '18', border: `1px solid ${T.hp}44`, borderRadius: '2px', padding: '2px 8px', cursor: 'pointer', color: T.hp, fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.1em' }}
                            >ROLL</button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Placed instances quick-list */}
                  {instances.length > 0 && (
                    <>
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '4px' }}>ON MAP</div>
                      {instances.map(inst => (
                        <div key={inst.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: inst.is_defeated ? T.textDim : T.text, marginBottom: '2px' }}>
                          <span>{inst.label}</span>
                          <span style={{ color: inst.is_defeated ? T.hp : T.textMuted }}>{inst.current_hp}/{inst.max_hp} HP</span>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Traits */}
                  {enemy.traits.length > 0 && (
                    <>
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginBottom: '4px', marginTop: '4px' }}>TRAITS</div>
                      {enemy.traits.map((trait, i) => (
                        <div key={i} style={{ fontSize: '13px', color: T.textMuted, marginBottom: '4px', lineHeight: '1.5' }}>
                          <span style={{ color: T.text, fontFamily: "'Cinzel',serif" }}>{trait.name}:</span> {trait.description}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Place token modal */}
      {placing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setPlacing(null)}
        >
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: '4px', padding: '20px', minWidth: '260px' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: '15px', letterSpacing: '0.14em', color: T.text, marginBottom: '12px' }}>
              PLACE — {placing.name}
            </div>
            <div style={{ fontSize: '14px', color: T.textMuted, marginBottom: '6px' }}>Label (e.g. "Goblin A")</div>
            <input
              value={placeLabel}
              onChange={e => setPlaceLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && placeEnemy()}
              autoFocus
              style={{ width: '100%', background: T.surface, border: `1px solid ${T.border}`, borderRadius: '2px', padding: '7px 10px', color: T.text, fontSize: '15px', outline: 'none', boxSizing: 'border-box', marginBottom: '12px' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setPlacing(null)}
                style={{ background: 'transparent', border: `1px solid ${T.border}`, borderRadius: '2px', padding: '6px 14px', cursor: 'pointer', color: T.textMuted, fontFamily: "'Cinzel',serif", fontSize: '13px' }}>
                CANCEL
              </button>
              <button onClick={placeEnemy}
                style={{ background: T.gold + '22', border: `1px solid ${T.gold}`, borderRadius: '2px', padding: '6px 14px', cursor: 'pointer', color: T.gold, fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.12em' }}>
                PLACE TOKEN
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}