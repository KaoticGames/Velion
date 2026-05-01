/**
 * JRPG-style bottom battle HUD for the local player (token on map).
 * Replaces expandable party-row actions with a single intuitive command bar.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { DiceVisibility, MapToken, VTTCharacterRollRequest } from './types';
import { api } from '@/lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { characterKeys } from '@/hooks/useCharacter';

const T = {
  surface:   '#0a0e14',
  card:      '#111520',
  border:    '#1c2230',
  gold:      '#c4922a',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  textDim:   '#504538',
  rp:        '#3ab5e8',
  green:     '#50a060',
};

type HudMode = 'main' | 'attack' | 'check' | 'item' | 'turn';

interface Props {
  token: MapToken;
  characterId: string;
  diceVisibility: DiceVisibility;
}

function dispatchPlayerRoll(detail: VTTCharacterRollRequest) {
  window.dispatchEvent(new CustomEvent('velion:dice-roll-request', { detail: { ...detail, autoOpen: false } }));
}

type InventoryRow = {
  id: string;
  item_type: string;
  equipped: boolean;
  equipped_slot: string | null;
  quantity?: number;
  item_details?: Record<string, unknown>;
};

type CharacterSheetLite = {
  id: string;
  name: string;
  power: number;
  agility: number;
  focus: number;
  presence: number;
  base_rp: number;
  current_rp?: number;
  rp_banked?: number;
  rp_banking?: boolean;
  updated_at?: string;
};

type WeaponAttackLite = {
  id: string;
  name: string;
  dieType: string;
  channels: Array<{ element: string; dice: number }>;
};

type SpellAttackLite = {
  id: string;
  name: string;
  num_dice: number;
  die_type: number;
  element: string;
};

type ActiveFlow = {
  id: string;
  kind: 'weapon' | 'spell';
  name: string;
  characterId: string;
  sourceLabel: string;
  stake: number;
  weapon?: WeaponAttackLite;
  spell?: SpellAttackLite;
  critRoll: number | null;
  isCrit: boolean;
  damageRows: Array<{ idx: number; label: string; total: number }>;
};

const calcMod = (v: number) => Math.floor((v - 10) / 2);
const modLabel = (v: number) => (v >= 0 ? `+${v}` : `${v}`);
const pressureSteps = (rp: number, avail: number) => {
  if (!avail || rp <= 0) return 0;
  const p = rp / avail;
  return p <= 0.2 ? 1 : p <= 0.4 ? 2 : p <= 0.6 ? 3 : p <= 0.8 ? 4 : 5;
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const mapDamageType = (t: string) => {
  if (['slashing', 'piercing', 'bludgeoning'].includes(t)) return 'Physical';
  if (t === 'light') return 'Radiant';
  return cap(t);
};
const mapGemElement = (t: string) => (t === 'light' ? 'Radiant' : cap(t));
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const hudBtn: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '10px 8px',
  borderRadius: '4px',
  border: `1px solid ${T.gold}55`,
  background: `${T.gold}14`,
  color: T.gold,
  fontFamily: "'Cinzel',serif",
  fontSize: '11px',
  letterSpacing: '0.12em',
  cursor: 'pointer',
  fontWeight: 600,
};

const subBtn: React.CSSProperties = {
  ...hudBtn,
  padding: '8px 6px',
  fontSize: '10px',
};

const quickInputStyle: React.CSSProperties = {
  width: '72px',
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: '4px',
  padding: '6px 8px',
  color: T.text,
  fontSize: '12px',
  outline: 'none',
};

export default function PlayerBattleHUD({ token, characterId, diceVisibility }: Props) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<HudMode>('main');
  const sourceLabel = token.label ?? 'Player';
  const visLabel = diceVisibility.toUpperCase();

  const [curRP, setCurRP] = useState(0);
  const [bankRP, setBankRP] = useState(0);
  const [banking, setBanking] = useState(false);
  const [rpReady, setRpReady] = useState(false);
  const lastHydratedKey = useRef<string | null>(null);
  const [stakeRP, setStakeRP] = useState(0);
  const [activeFlow, setActiveFlow] = useState<ActiveFlow | null>(null);

  const { data: character, isLoading: characterLoading } = useQuery({
    queryKey: characterKeys.detail(characterId),
    queryFn: async (): Promise<CharacterSheetLite> => {
      const { data } = await api.get<CharacterSheetLite>(`/characters/${characterId}`);
      return data;
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ['vtt-battle-hud-inv', characterId],
    queryFn: async (): Promise<InventoryRow[]> => {
      const { data } = await api.get<{ data?: InventoryRow[] }>(`/inventory/${characterId}`);
      return Array.isArray(data?.data) ? data.data : [];
    },
    staleTime: 20_000,
  });

  const weaponAttacks: WeaponAttackLite[] = inventory
    .filter((row) => row.equipped && row.item_type === 'weapon' && row.item_details)
    .map((row) => {
      const det = row.item_details ?? {};
      const channels = Array.isArray(det.channels)
        ? (det.channels as Array<Record<string, unknown>>).map((ch) => ({
            element: mapDamageType(String(ch?.damage_type ?? 'physical')),
            dice: Number(ch?.num_dice ?? 1) || 1,
          }))
        : [{ element: 'Physical', dice: 1 }];
      return {
        id: String(row.id),
        name: String(det.name ?? 'Weapon'),
        dieType: `d${Number(det.base_die_type ?? 6) || 6}`,
        channels,
      };
    });

  useEffect(() => {
    lastHydratedKey.current = null;
  }, [characterId]);

  const generalInventory = inventory.filter(
    (row) => row.item_type === 'general' && (Number(row.quantity) || 0) > 0,
  );

  const spellAttacks: SpellAttackLite[] = inventory
    .filter((row) => row.equipped && row.item_type === 'spell_gem' && row.item_details)
    .map((row) => {
      const det = row.item_details ?? {};
      const nd = Number(det.num_dice ?? 1) || 1;
      const dt = Number(det.die_type ?? 6) || 6;
      const element = mapGemElement(String(det.element_type ?? 'arcane'));
      return { id: String(row.id), name: `${element} Spell`, num_dice: nd, die_type: dt, element };
    });

  /** Pull RP from server when the row revision changes (avoids clobbering unsent local changes on spurious refetches). */
  useEffect(() => {
    if (!character) return;
    const key = character.updated_at
      ? `${character.id}\0${character.updated_at}`
      : `${character.id}\0init\0${character.current_rp ?? ''}\0${character.rp_banked ?? ''}`;
    if (lastHydratedKey.current === key) return;
    lastHydratedKey.current = key;
    setCurRP(character.current_rp ?? character.base_rp ?? 0);
    setBankRP(character.rp_banked ?? 0);
    setBanking(!!character.rp_banking);
    setRpReady(true);
  }, [character]);

  /** Persist session RP to the same row the character sheet uses (debounced). */
  const rpPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!rpReady) return;
    if (rpPersistTimer.current) clearTimeout(rpPersistTimer.current);
    rpPersistTimer.current = setTimeout(() => {
      void api
        .patch(`/characters/${characterId}`, {
          current_rp: curRP,
          rp_banked: bankRP,
          rp_banking: banking,
        })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: characterKeys.detail(characterId) });
        })
        .catch(() => {
          /* non-fatal; next refetch may repair */
        });
    }, 500);
    return () => {
      if (rpPersistTimer.current) clearTimeout(rpPersistTimer.current);
    };
  }, [rpReady, characterId, curRP, bankRP, banking, queryClient]);

  useEffect(() => {
    const onRollComplete = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      const meta = detail?.requestMeta as Record<string, unknown> | undefined;
      if (!meta || !activeFlow || meta.flow_id !== activeFlow.id || meta.character_id !== activeFlow.characterId) return;
      if (meta.kind === 'vttPanelCrit') {
        const r = (detail.results as number[] | undefined)?.[0] ?? detail.total;
        setActiveFlow((prev) => (prev ? { ...prev, critRoll: Number(r), isCrit: Number(r) === 20 } : prev));
        return;
      }
      if (meta.kind === 'vttPanelDmg') {
        setActiveFlow((prev) => {
          if (!prev) return prev;
          const idx = Number(meta.channel_idx ?? 0);
          const label = String(detail?.label ?? `Damage ${idx + 1}`);
          const row = { idx, label, total: Number(detail?.total ?? 0) };
          const existing = prev.damageRows.filter((r) => r.idx !== idx);
          return { ...prev, damageRows: [...existing, row].sort((a, b) => a.idx - b.idx) };
        });
      }
    };
    window.addEventListener('velion:dice-roll-complete', onRollComplete as EventListener);
    return () => window.removeEventListener('velion:dice-roll-complete', onRollComplete as EventListener);
  }, [activeFlow]);

  const effBaseRP = character?.base_rp ?? 0;

  const handleBank = () => {
    if (!character || !rpReady) return;
    if (!banking) {
      setBankRP(curRP);
      setBanking(true);
    } else {
      setBanking(false);
    }
  };

  const handleTurnStart = () => {
    if (!character || !rpReady) return;
    setCurRP(effBaseRP + bankRP);
    setBankRP(0);
    setBanking(false);
    setMode('main');
  };

  const emitQuickRoll = (action: 'check' | 'attack' | 'damage' | 'custom', formula: string, label: string) => {
    const cleanFormula = formula.trim();
    if (!cleanFormula) return;
    dispatchPlayerRoll({
      formula: cleanFormula,
      label,
      visibility: diceVisibility,
      source_label: sourceLabel,
      requestMeta: {
        kind: 'vttQuickRoll',
        action,
        character_id: characterId,
      },
    });
  };

  const startAttackFlow = (attack: WeaponAttackLite | SpellAttackLite, kind: 'weapon' | 'spell') => {
    setStakeRP(0);
    setActiveFlow({
      id: uid(),
      kind,
      name: attack.name,
      characterId,
      sourceLabel,
      stake: 0,
      weapon: kind === 'weapon' ? (attack as WeaponAttackLite) : undefined,
      spell: kind === 'spell' ? (attack as SpellAttackLite) : undefined,
      critRoll: null,
      isCrit: false,
      damageRows: [],
    });
    setMode('main');
  };

  const confirmStake = () => {
    if (!activeFlow || stakeRP <= 0 || stakeRP > curRP) return;
    setCurRP((p) => Math.max(0, p - stakeRP));
    setActiveFlow((prev) => (prev ? { ...prev, stake: stakeRP } : prev));
    setStakeRP(0);
  };

  const rollCrit = () => {
    if (!activeFlow || activeFlow.stake <= 0 || activeFlow.critRoll !== null) return;
    dispatchPlayerRoll({
      formula: '1d20',
      label: `${activeFlow.name} Crit Roll`,
      visibility: diceVisibility,
      source_label: sourceLabel,
      requestMeta: {
        kind: 'vttPanelCrit',
        action: 'crit',
        character_id: characterId,
        flow_id: activeFlow.id,
      },
    });
  };

  const rollDamage = () => {
    if (!activeFlow || activeFlow.stake <= 0 || activeFlow.critRoll == null) return;
    if (activeFlow.kind === 'weapon' && activeFlow.weapon) {
      const weapon = activeFlow.weapon;
      weapon.channels.forEach((ch, idx) => {
        const sides = Number.parseInt(weapon.dieType.replace(/\D/g, ''), 10) || 6;
        const nd = Number(ch.dice) || 1;
        dispatchPlayerRoll({
          formula: `${nd * (activeFlow.isCrit ? 2 : 1)}d${sides}`,
          label: `${weapon.name} ${ch.element} Damage`,
          visibility: diceVisibility,
          source_label: sourceLabel,
          postMultiplier: activeFlow.stake,
          requestMeta: {
            kind: 'vttPanelDmg',
            action: 'damageChannel',
            character_id: characterId,
            flow_id: activeFlow.id,
            channel_idx: idx,
            channel_count: weapon.channels.length,
          },
        });
      });
      return;
    }
    if (activeFlow.kind === 'spell' && activeFlow.spell) {
      const s = activeFlow.spell;
      dispatchPlayerRoll({
        formula: `${s.num_dice}d${s.die_type}`,
        label: `${s.element} Spell Damage`,
        visibility: diceVisibility,
        source_label: sourceLabel,
        postMultiplier: activeFlow.stake * (activeFlow.isCrit ? 2 : 1),
        requestMeta: {
          kind: 'vttPanelDmg',
          action: 'damageChannel',
          character_id: characterId,
          flow_id: activeFlow.id,
          channel_idx: 0,
          channel_count: 1,
        },
      });
    }
  };

  const stakeCommitted = activeFlow?.stake ?? 0;
  const poolAtStake = stakeCommitted > 0 ? curRP + stakeCommitted : curRP;
  const rpForPressure = stakeCommitted > 0 ? stakeCommitted : stakeRP;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 35,
        pointerEvents: 'none',
        padding: '12px 16px 16px',
        background: 'linear-gradient(180deg, transparent 0%, rgba(8,11,16,0.92) 28%, rgba(8,11,16,0.98) 100%)',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          maxWidth: '720px',
          margin: '0 auto',
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: '8px',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        {/* Header: identity + RP */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 14px',
            borderBottom: `1px solid ${T.border}`,
            background: T.surface,
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: '#0a1a2a',
              border: `1px solid ${T.rp}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              color: T.rp,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {(token.label ?? '?').slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Cinzel',serif",
                fontSize: '13px',
                letterSpacing: '0.1em',
                color: T.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {token.label ?? character?.name ?? 'Hero'}
            </div>
            <div style={{ fontSize: '9px', color: T.textDim, letterSpacing: '0.14em', marginTop: '2px' }}>
              BATTLE · {visLabel}
            </div>
          </div>
          {rpReady && character && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '10px', color: T.textMuted }}>RP</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: T.rp, lineHeight: 1.1 }}>
                {curRP}
                <span style={{ fontSize: '12px', color: `${T.rp}66`, fontWeight: 500 }}> / {effBaseRP}</span>
              </div>
              {bankRP > 0 && (
                <div style={{ fontSize: '9px', color: banking ? T.rp : T.textDim, marginTop: '2px' }}>
                  Bank {bankRP}
                  {banking ? ' · locked' : ''}
                </div>
              )}
            </div>
          )}
        </div>

        {characterLoading && (
          <div style={{ padding: '16px', fontSize: '12px', color: T.textDim, textAlign: 'center' }}>Loading…</div>
        )}

        {!characterLoading && character && (
          <>
            {/* Main command row */}
            {!activeFlow && mode === 'main' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '10px 12px' }}>
                <button type="button" style={hudBtn} onClick={() => setMode('attack')}>
                  ATTACK
                </button>
                <button type="button" style={hudBtn} onClick={() => setMode('check')}>
                  CHECK
                </button>
                <button type="button" style={hudBtn} onClick={() => setMode('item')}>
                  ITEM
                </button>
                <button type="button" style={hudBtn} onClick={() => setMode('turn')}>
                  TURN
                </button>
              </div>
            )}

            {/* Attack picker */}
            {!activeFlow && mode === 'attack' && (
              <div style={{ padding: '10px 12px 12px' }}>
                <button
                  type="button"
                  onClick={() => setMode('main')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: T.textMuted,
                    cursor: 'pointer',
                    fontSize: '11px',
                    marginBottom: '8px',
                    fontFamily: "'Cinzel',serif",
                    letterSpacing: '0.1em',
                  }}
                >
                  ← BACK
                </button>
                <div style={{ fontSize: '9px', color: T.textMuted, letterSpacing: '0.1em', marginBottom: '6px' }}>WEAPONS</div>
                {weaponAttacks.length === 0 ? (
                  <div style={{ fontSize: '11px', color: T.textDim, marginBottom: '10px' }}>No equipped weapons</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                    {weaponAttacks.map((w) => (
                      <button key={w.id} type="button" style={subBtn} onClick={() => startAttackFlow(w, 'weapon')}>
                        {w.name}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: '9px', color: T.textMuted, letterSpacing: '0.1em', marginBottom: '6px' }}>SPELL GEMS</div>
                {spellAttacks.length === 0 ? (
                  <div style={{ fontSize: '11px', color: T.textDim }}>No equipped gems</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {spellAttacks.map((s) => (
                      <button key={s.id} type="button" style={subBtn} onClick={() => startAttackFlow(s, 'spell')}>
                        {s.name} ({s.num_dice}d{s.die_type})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Attribute checks */}
            {!activeFlow && mode === 'check' && (
              <div style={{ padding: '10px 12px 12px' }}>
                <button
                  type="button"
                  onClick={() => setMode('main')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: T.textMuted,
                    cursor: 'pointer',
                    fontSize: '11px',
                    marginBottom: '8px',
                    fontFamily: "'Cinzel',serif",
                    letterSpacing: '0.1em',
                  }}
                >
                  ← BACK
                </button>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {(['Power', 'Agility', 'Focus', 'Presence'] as const).map((attr) => {
                    const val =
                      attr === 'Power'
                        ? character.power
                        : attr === 'Agility'
                          ? character.agility
                          : attr === 'Focus'
                            ? character.focus
                            : character.presence;
                    const mod = calcMod(val);
                    return (
                      <button
                        key={attr}
                        type="button"
                        style={subBtn}
                        onClick={() => emitQuickRoll('check', '1d20', `${attr} Check (${modLabel(mod)})`)}
                      >
                        {attr} {modLabel(mod)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Inventory: general / consumable gear (not weapons, armor, or gems) */}
            {!activeFlow && mode === 'item' && (
              <div style={{ padding: '10px 12px 12px' }}>
                <button
                  type="button"
                  onClick={() => setMode('main')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: T.textMuted,
                    cursor: 'pointer',
                    fontSize: '11px',
                    marginBottom: '8px',
                    fontFamily: "'Cinzel',serif",
                    letterSpacing: '0.1em',
                  }}
                >
                  ← BACK
                </button>
                <div style={{ fontSize: '9px', color: T.textMuted, letterSpacing: '0.1em', marginBottom: '8px' }}>
                  GEAR & CONSUMABLES
                </div>
                {generalInventory.length === 0 ? (
                  <div style={{ fontSize: '11px', color: T.textDim }}>No general items in inventory</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {generalInventory.map((row) => {
                      const det = row.item_details ?? {};
                      const name = String(det.name ?? 'Item');
                      const cat = String(det.category ?? 'misc').toLowerCase();
                      const effect = String(det.effect ?? '').trim();
                      const formula = cat === 'consumable' ? '1d4' : '1d20';
                      const label = cat === 'consumable' ? `${name} (consumable potency)` : `${name} (use check)`;
                      return (
                        <div
                          key={row.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px',
                            background: T.surface,
                            border: `1px solid ${T.border}`,
                            borderRadius: '6px',
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '12px', color: T.text, fontWeight: 600 }}>{name}</div>
                            <div style={{ fontSize: '10px', color: T.textDim }}>
                              ×{Number(row.quantity) || 1}
                              {cat !== 'misc' ? ` · ${cat}` : ''}
                            </div>
                            {effect ? (
                              <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '4px', lineHeight: 1.35 }}>
                                {effect}
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            style={{ ...subBtn, flex: '0 0 auto' }}
                            onClick={() => emitQuickRoll('custom', formula, label)}
                          >
                            USE
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Turn: bank + refresh */}
            {!activeFlow && mode === 'turn' && rpReady && (
              <div style={{ padding: '10px 12px 14px' }}>
                <button
                  type="button"
                  onClick={() => setMode('main')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: T.textMuted,
                    cursor: 'pointer',
                    fontSize: '11px',
                    marginBottom: '8px',
                    fontFamily: "'Cinzel',serif",
                    letterSpacing: '0.1em',
                  }}
                >
                  ← BACK
                </button>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', marginBottom: '10px' }}>
                  <button type="button" onClick={handleBank} style={{ ...subBtn, flex: 1, borderColor: banking ? `${T.rp}88` : `${T.gold}55` }}>
                    {banking ? '● BANKED' : '○ BANK RP'}
                  </button>
                  <button
                    type="button"
                    onClick={handleTurnStart}
                    style={{
                      ...subBtn,
                      flex: 1,
                      borderColor: `${T.rp}88`,
                      background: '#060e1a',
                      color: T.rp,
                    }}
                  >
                    START TURN
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: '10px', color: T.textDim, lineHeight: 1.45 }}>
                  Bank saves your remaining RP for your next turn. When a new turn begins, use <strong style={{ color: T.text }}>Start Turn</strong> to refresh your pool (base + banked).
                </p>
              </div>
            )}

            {/* Active attack / spell flow */}
            {activeFlow && (
              <div style={{ padding: '12px 14px 14px', borderTop: `1px solid ${T.border}` }}>
                <div style={{ fontSize: '11px', color: T.gold, fontFamily: "'Cinzel',serif", letterSpacing: '0.12em', marginBottom: '8px' }}>
                  {activeFlow.name.toUpperCase()}
                </div>
                <div style={{ fontSize: '10px', color: T.textDim, marginBottom: '10px' }}>Stake RP → crit roll → damage</div>

                {activeFlow.stake <= 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', color: T.textMuted }}>Stake</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, curRP)}
                      value={stakeRP}
                      onChange={(e) => setStakeRP(Math.max(0, Number(e.target.value) || 0))}
                      style={quickInputStyle}
                    />
                    <button type="button" onClick={confirmStake} disabled={stakeRP <= 0 || curRP <= 0} style={{ ...subBtn, flex: '0 0 auto' }}>
                      CONFIRM
                    </button>
                    <span style={{ marginLeft: 'auto', fontSize: '11px', color: T.rp }}>Pool {curRP}</span>
                  </div>
                )}

                <div
                  style={{
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: '6px',
                    padding: '8px 10px',
                    marginBottom: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: T.textMuted }}>
                    <span>Pressure</span>
                    <span style={{ color: T.gold }}>
                      {pressureSteps(rpForPressure, poolAtStake)}/5 · DC {10 + pressureSteps(rpForPressure, poolAtStake) * 2}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: '6px',
                          borderRadius: '2px',
                          background: i <= pressureSteps(rpForPressure, poolAtStake) ? T.gold : T.border,
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <button
                    type="button"
                    onClick={rollCrit}
                    disabled={activeFlow.stake <= 0 || activeFlow.critRoll !== null}
                    style={subBtn}
                  >
                    CRIT
                  </button>
                  <button type="button" onClick={rollDamage} disabled={activeFlow.critRoll == null} style={subBtn}>
                    DAMAGE
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: T.textMuted, marginBottom: '8px' }}>
                  Crit:{' '}
                  {activeFlow.critRoll == null ? '—' : `${activeFlow.critRoll}${activeFlow.isCrit ? ' (CRIT!)' : ''}`}
                </div>
                {activeFlow.damageRows.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
                    {activeFlow.damageRows.map((row) => (
                      <div key={row.idx} style={{ fontSize: '11px', color: T.textMuted }}>
                        {row.label}: <span style={{ color: T.text }}>{row.total}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveFlow(null);
                    setStakeRP(0);
                    setMode('main');
                  }}
                  style={{ ...subBtn, width: '100%', borderColor: T.border, color: T.textMuted }}
                >
                  CLOSE
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
