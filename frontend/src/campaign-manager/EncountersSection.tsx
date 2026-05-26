import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { EnemyStatBlock } from '@/vtt/types';
import type { CampaignMember } from '@/hooks/useCampaign';
import type { CampaignManagerEncounter, CampaignManagerEncounterEnemy } from '@/lib/campaignManager';
import { uid } from '@/lib/campaignManager';
import {
  calcEncounterPool,
  enemyWeightFromClassification,
  type EncounterDifficulty,
} from '@/lib/encounterPool';
import { T } from './theme';
import { SectionHead, SubHead, SectionLabel, Formula, Callout, inputStyle, rollFormula } from './ui';

const DIFFICULTIES: { id: EncounterDifficulty; label: string }[] = [
  { id: 'easy', label: 'Easy (0.25)' },
  { id: 'standard', label: 'Standard (0.50)' },
  { id: 'hard', label: 'Hard (0.75)' },
  { id: 'deadly', label: 'Deadly (1.00)' },
  { id: 'horde', label: 'Horde (1.25)' },
];

interface Props {
  encounters: CampaignManagerEncounter[];
  activeEncounterId: string | null;
  partySize: number;
  avgPartyBaseRP: number;
  onChange: (encounters: CampaignManagerEncounter[], activeId: string | null) => void;
}

function buildEnemyFromLibrary(e: EnemyStatBlock): CampaignManagerEncounterEnemy {
  const weight = enemyWeightFromClassification(e.classification);
  return {
    id: uid(),
    libraryEnemyId: e.id,
    label: e.name,
    classification: e.classification,
    maxHp: e.hp,
    currentHp: e.hp,
    resistanceMod: 0,
    weight,
    statSnapshot: {
      name: e.name,
      attacks: e.attacks,
      traits: e.traits,
      power: e.power,
      agility: e.agility,
      focus: e.focus,
      presence: e.presence,
    },
  };
}

export default function EncountersSection({
  encounters, activeEncounterId, partySize, avgPartyBaseRP, onChange,
}: Props) {
  const [search, setSearch] = useState('');
  const [rollLog, setRollLog] = useState<string[]>([]);

  const { data: libraryEnemies = [] } = useQuery({
    queryKey: ['library', 'enemies'],
    queryFn: () => api.get('/library/enemies').then(r => r.data?.data ?? []),
    staleTime: 5 * 60_000,
  });

  const active = encounters.find(e => e.id === activeEncounterId) ?? encounters[0] ?? null;

  const recalcPool = (enc: CampaignManagerEncounter): CampaignManagerEncounter => {
    const totalWeight = enc.enemies.reduce((s, en) => s + en.weight, 0) || 1;
    const poolTotal = calcEncounterPool(avgPartyBaseRP || 1, Math.max(1, partySize), totalWeight, enc.difficulty);
    return {
      ...enc,
      poolTotal,
      poolRemaining: enc.poolRemaining > poolTotal ? poolTotal : enc.poolRemaining,
      updatedAt: new Date().toISOString(),
    };
  };

  const setEncounters = (next: CampaignManagerEncounter[], activeId = activeEncounterId) => {
    onChange(next.map(recalcPool), activeId);
  };

  const updateActive = (patch: Partial<CampaignManagerEncounter>) => {
    if (!active) return;
    setEncounters(encounters.map(e => e.id === active.id ? recalcPool({ ...e, ...patch }) : e));
  };

  const addEncounter = () => {
    const now = new Date().toISOString();
    const enc: CampaignManagerEncounter = recalcPool({
      id: uid(),
      name: 'New Encounter',
      difficulty: 'standard',
      enemies: [],
      poolTotal: 0,
      poolRemaining: 0,
      completed: false,
      loot: [],
      createdAt: now,
      updatedAt: now,
    });
    setEncounters([...encounters, enc], enc.id);
  };

  const addEnemy = (lib: EnemyStatBlock) => {
    if (!active) return;
    const enemies = [...active.enemies, buildEnemyFromLibrary(lib)];
    updateActive({ enemies });
  };

  const filtered = (libraryEnemies as EnemyStatBlock[]).filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()),
  ).slice(0, 24);

  const logRoll = (label: string, formula: string) => {
    const { results, total } = rollFormula(formula);
    setRollLog(prev => [`${label}: ${formula} → [${results.join(', ')}] = ${total}`, ...prev].slice(0, 12));
  };

  return (
    <div>
      <SectionHead title="Enemies & Encounters" />
      <p style={{ fontSize: '15px', color: T.textMuted, lineHeight: 1.65, margin: '0 0 12px' }}>
        Build encounters from the library or homebrew workshop. Pool size uses the compendium formula from your party&apos;s average Base RP.
      </p>
      <Formula>Pool = Avg Base RP × Party Size × Σ Enemy Weight × Difficulty Factor</Formula>
      <Callout label="PARTY INPUT">
        Party size <strong style={{ color: T.dmGold }}>{partySize}</strong> · Avg Base RP <strong style={{ color: T.rp }}>{avgPartyBaseRP || '—'}</strong>
        {avgPartyBaseRP === 0 && ' — add characters to the campaign to calculate.'}
      </Callout>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button type="button" onClick={addEncounter} style={{
          fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
          background: T.gold, border: `1px solid ${T.gold}`, color: '#080b10',
          borderRadius: '2px', padding: '8px 16px', cursor: 'pointer', fontWeight: 700,
        }}>+ NEW ENCOUNTER</button>
        <Link to="/homebrew" style={{
          fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
          color: T.gold, textDecoration: 'none', padding: '8px 0',
        }}>HOMEBREW WORKSHOP →</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '16px', minHeight: '400px' }}>
        {/* Encounter list */}
        <div>
          <SubHead>Encounters</SubHead>
          {encounters.length === 0 ? (
            <div style={{ fontSize: '13px', color: T.textDim }}>None yet</div>
          ) : encounters.map(enc => (
            <button
              key={enc.id}
              type="button"
              onClick={() => onChange(encounters, enc.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                marginBottom: '6px', padding: '10px 12px', cursor: 'pointer',
                background: active?.id === enc.id ? T.goldFaint : T.surface,
                border: `1px solid ${active?.id === enc.id ? T.gold : T.border}`,
                borderRadius: '3px', color: T.text,
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 600 }}>{enc.name}</div>
              <div style={{ fontSize: '11px', color: T.textDim, marginTop: '4px' }}>
                {enc.enemies.length} foes · Pool {enc.poolRemaining}/{enc.poolTotal}
                {enc.completed && <span style={{ color: T.green, marginLeft: '6px' }}>✓</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Active encounter */}
        <div>
          {!active ? (
            <div style={{ color: T.textDim, padding: '24px' }}>Select or create an encounter</div>
          ) : (
            <>
              <input
                value={active.name}
                onChange={e => updateActive({ name: e.target.value })}
                style={{ ...inputStyle, marginBottom: '10px', fontFamily: "'Cinzel',serif", letterSpacing: '0.06em' }}
              />
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
                <select
                  value={active.difficulty}
                  onChange={e => updateActive({ difficulty: e.target.value as EncounterDifficulty })}
                  style={{ ...inputStyle, width: 'auto' }}
                >
                  {DIFFICULTIES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                <span style={{ fontSize: '14px', color: T.rp }}>
                  Pool <strong>{active.poolRemaining}</strong> / {active.poolTotal}
                </span>
                <button
                  type="button"
                  onClick={() => updateActive({ completed: !active.completed })}
                  style={{
                    fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.1em',
                    background: active.completed ? T.green + '22' : 'transparent',
                    border: `1px solid ${active.completed ? T.green : T.border}`,
                    color: active.completed ? T.green : T.textMuted,
                    borderRadius: '2px', padding: '4px 10px', cursor: 'pointer',
                  }}
                >{active.completed ? 'COMPLETED' : 'MARK COMPLETE'}</button>
                <button
                  type="button"
                  onClick={() => {
                    const next = encounters.filter(e => e.id !== active.id);
                    setEncounters(next, next[0]?.id ?? null);
                  }}
                  style={{
                    fontFamily: "'Cinzel',serif", fontSize: '11px',
                    border: `1px solid ${T.hp}`, color: T.hp, background: 'transparent',
                    borderRadius: '2px', padding: '4px 10px', cursor: 'pointer',
                  }}
                >DELETE</button>
              </div>

              <SectionLabel>ADD FROM LIBRARY</SectionLabel>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search enemies…"
                style={{ ...inputStyle, marginBottom: '8px' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px', maxHeight: '120px', overflowY: 'auto' }}>
                {filtered.map((e: EnemyStatBlock) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => addEnemy(e)}
                    style={{
                      fontSize: '12px', padding: '4px 10px', cursor: 'pointer',
                      background: T.card, border: `1px solid ${T.border}`, borderRadius: '2px', color: T.text,
                    }}
                  >+ {e.name}</button>
                ))}
              </div>

              <SectionLabel>ENCOUNTER TRACKER</SectionLabel>
              {active.enemies.length === 0 ? (
                <div style={{ color: T.textDim, fontSize: '14px' }}>Add enemies to begin tracking combat.</div>
              ) : active.enemies.map(en => {
                const snap = en.statSnapshot;
                return (
                  <div key={en.id} style={{
                    background: T.card, border: `1px solid ${T.border}`, borderRadius: '3px',
                    padding: '12px', marginBottom: '10px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                      <div>
                        <input
                          value={en.label}
                          onChange={e => {
                            const enemies = active.enemies.map(x =>
                              x.id === en.id ? { ...x, label: e.target.value } : x);
                            updateActive({ enemies });
                          }}
                          style={{ ...inputStyle, width: '200px', marginBottom: '6px' }}
                        />
                        <div style={{ fontSize: '12px', color: T.textDim }}>
                          {en.classification} · weight {en.weight} · RES mod +{en.resistanceMod}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <label style={{ fontSize: '12px', color: T.textDim }}>HP</label>
                        <input
                          type="number"
                          value={en.currentHp}
                          onChange={e => {
                            const v = parseInt(e.target.value, 10) || 0;
                            const enemies = active.enemies.map(x =>
                              x.id === en.id ? { ...x, currentHp: Math.min(en.maxHp, v) } : x);
                            updateActive({ enemies });
                          }}
                          style={{ ...inputStyle, width: '72px' }}
                        />
                        <span style={{ color: T.textDim }}>/</span>
                        <input
                          type="number"
                          value={en.maxHp}
                          onChange={e => {
                            const v = parseInt(e.target.value, 10) || 1;
                            const enemies = active.enemies.map(x =>
                              x.id === en.id ? { ...x, maxHp: v, currentHp: Math.min(x.currentHp, v) } : x);
                            updateActive({ enemies });
                          }}
                          style={{ ...inputStyle, width: '72px' }}
                        />
                        <button
                          type="button"
                          onClick={() => updateActive({ enemies: active.enemies.filter(x => x.id !== en.id) })}
                          style={{ background: 'transparent', border: `1px solid ${T.hp}`, color: T.hp, borderRadius: '2px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}
                        >✕</button>
                      </div>
                    </div>

                    {snap && (
                      <div style={{ marginTop: '10px' }}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                          {[['POW', snap.power], ['AGI', snap.agility], ['FOC', snap.focus], ['PRE', snap.presence]].map(([k, v]) => (
                            <button
                              key={k as string}
                              type="button"
                              onClick={() => {
                                const mod = Math.floor(((v as number) - 10) / 2);
                                const formula = mod >= 0 ? `1d20+${mod}` : `1d20${mod}`;
                                logRoll(`${en.label} ${k} save`, formula);
                              }}
                              style={{
                                fontFamily: "'Cinzel',serif", fontSize: '11px',
                                background: T.rp + '18', border: `1px solid ${T.rp}44`,
                                color: T.rp, borderRadius: '2px', padding: '4px 8px', cursor: 'pointer',
                              }}
                            >{k as string} save</button>
                          ))}
                          <button
                            type="button"
                            onClick={() => logRoll(`${en.label} block`, '1d20')}
                            style={{
                              fontFamily: "'Cinzel',serif", fontSize: '11px',
                              background: T.green + '18', border: `1px solid ${T.green}44`,
                              color: T.green, borderRadius: '2px', padding: '4px 8px', cursor: 'pointer',
                            }}
                          >BLOCK</button>
                        </div>
                        {(snap.attacks ?? []).map((atk, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', background: T.surface, padding: '6px 8px', borderRadius: '2px' }}>
                            <span style={{ fontSize: '13px', color: T.text }}>{atk.name} · {atk.damage_dice} {atk.damage_type}</span>
                            <button
                              type="button"
                              onClick={() => logRoll(`${en.label} — ${atk.name}`, atk.damage_dice)}
                              style={{
                                fontFamily: "'Cinzel',serif", fontSize: '11px',
                                background: T.hp + '18', border: `1px solid ${T.hp}44`,
                                color: T.hp, borderRadius: '2px', padding: '3px 8px', cursor: 'pointer',
                              }}
                            >ROLL</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {rollLog.length > 0 && (
                <>
                  <SubHead>Roll Log (local)</SubHead>
                  <div style={{
                    background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px',
                    padding: '10px', fontFamily: 'monospace', fontSize: '13px', color: T.textMuted,
                  }}>
                    {rollLog.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
