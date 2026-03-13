/**
 * Homebrew.tsx — Homebrew Workshop
 *
 * Standalone page at /homebrew.
 * Requires authentication. Write actions (create/edit/delete) require paid tier.
 *
 * Tabs: Weapons · Armor · Spell Gems · Focus Bracers · Enemies · Pets
 * Each tab: card list of user's items + Create button → form modal.
 * Duplicate detection warns before save; version history collapsible per card.
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import {
  useMyHomebrew, useCreateHomebrew, usePatchHomebrew,
  useDeleteHomebrew, useDuplicateCheck, useVersionHistory,
  type HomebrewType,
} from '@/hooks/useHomebrew';

// ── Design tokens ──────────────────────────────────────────────────────────

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', goldDim: '#5a3e10', text: '#e4d8c0', textMuted: '#706858',
  textDim: '#282430', hp: '#e05050', rp: '#4a9de8', magic: '#9b6fe8',
};

const RARITY_COLOR: Record<string, string> = {
  common: '#b0b0b0', uncommon: '#3dba6a', rare: '#4a9de8',
  epic: '#a055e8', legendary: '#e8a020', mythic: '#ff5555',
};

const ELEM_COLOR: Record<string, string> = {
  Fire: '#e87040', Ice: '#60c8e8', Lightning: '#f0d050', Poison: '#60c850',
  Shadow: '#9060c0', Radiant: '#f0e080', Arcane: '#a060e8', Nature: '#50a040',
  Earth: '#c09050', Wind: '#80c8a0',
};

const ATTR_COLOR: Record<string, string> = {
  Power: '#e87050', Agility: '#50c878', Focus: '#7090e8', Presence: '#e8b050',
};

const CLASS_COLOR: Record<string, string> = {
  minion: '#b0b0b0', standard: '#4a9de8', elite: '#a055e8', boss: '#e8a020',
};

const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

const inp = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  borderRadius: '3px', padding: '6px 10px', fontSize: '14px',
  fontFamily: "'EB Garamond', serif", width: '100%', outline: 'none', ...extra,
});

const LBL: React.CSSProperties = {
  fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.14em',
  color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: '4px',
};

const Btn = (color = T.gold, bg = 'transparent'): React.CSSProperties => ({
  background: bg, border: `1px solid ${color}`, color, borderRadius: '3px',
  padding: '5px 14px', fontSize: '11px', fontFamily: "'Cinzel', serif",
  letterSpacing: '0.1em', cursor: 'pointer',
});

// ── Tab config ────────────────────────────────────────────────────────────

const TABS: { type: HomebrewType; label: string; singular: string; color: string; icon: string }[] = [
  { type: 'weapon',    label: 'Weapons',   singular: 'Weapon',    color: '#c8503a', icon: '⚔' },
  { type: 'armor',     label: 'Armor',     singular: 'Armor',     color: '#8a7040', icon: '🛡' },
  { type: 'spell-gem', label: 'Spell Gems',singular: 'Spell Gem', color: '#9b6fe8', icon: '⬡' },
  { type: 'enemy',     label: 'Enemies',   singular: 'Enemy',     color: '#e05050', icon: '☠' },
  { type: 'pet',       label: 'Pets',      singular: 'Pet',       color: '#50c878', icon: '🐾' },
];

// ── Official trait presets (from seeded library) ───────────────────────────

const OFFICIAL_TRAITS: { name: string; description: string }[] = [
  { name: 'Undead',        description: 'Immune to Poisoned and Bleeding states. Vulnerable to Light damage.' },
  { name: 'Pack Hunter',   description: 'For each ally of the same type present beyond the first, gains +1 to its damage multiplier.' },
  { name: 'Brute Force',   description: 'When using a Full tier attack, adds +2 to damage multiplier.' },
  { name: 'Pounce',        description: 'If the enemy has not attacked this round, its Full attack may apply Grappled on a failed save.' },
  { name: 'Spell Strike',  description: 'Attacks bypass the Pressure Step save — they deal damage automatically, reduced only by elemental resistance.' },
  { name: 'Ironwall',      description: 'If this enemy generates Defensive Steps in a round, they are treated as one step higher than rolled.' },
  { name: 'Bloodthirst',   description: 'On a Full tier attack that hits, heals for 15% of damage dealt.' },
  { name: 'Shadow Shroud', description: 'Immune to Frightened. Resistant to Shadow damage (50%).' },
  { name: 'Stone Body',    description: 'Immune to Bleeding, Poisoned, and Charmed. Physical mitigation treated as +20% for damage resolution.' },
  { name: 'Slow',          description: 'Cannot use Full tier attack two rounds in a row.' },
];

// ── Blank drafts ──────────────────────────────────────────────────────────

const WEAPON_BLANK = {
  name: '', category: 'short_sword', rarity: 'common',
  base_die_type: 6, req_power: 0, req_agility: 0, req_focus: 0,
  gem_slots: 0, description: '', is_public: false,
  channels: [{ damage_type: 'slashing', num_dice: 1 }],
};

const ARMOR_BLANK = {
  name: '', category: 'light', slot: 'chestplate', rarity: 'common',
  mitigation_percent: '6', req_power: 0, gem_slots: 0, description: '', is_public: false,
};

const GEM_BLANK = {
  name: '', element_type: 'fire', rarity: 'common',
  num_dice: 1, die_type: 6, armor_resistance_percent: '2',
  secondary_effect: '', description: '', is_public: false,
};

const ENEMY_BLANK = {
  name: '', classification: 'standard', hp: 2000,
  resistance_modifier: 0, enemy_weight: '1.0',
  power: 10, agility: 10, focus: 10, presence: 10,
  description: '', is_public: false,
  traits: [] as { name: string; description: string }[],
  attacks: [] as { name: string; damage_dice: string; damage_type: string; description: string }[],
  attack_tiers: [
    { tier_name: 'Partial',  pressure_steps: 1, damage_multiplier: 1, max_pool_contribution: 1 },
    { tier_name: 'Standard', pressure_steps: 3, damage_multiplier: 2, max_pool_contribution: 3 },
    { tier_name: 'Full',     pressure_steps: 5, damage_multiplier: 3, max_pool_contribution: 5 },
  ] as { tier_name: string; pressure_steps: number; damage_multiplier: number; max_pool_contribution: number }[],
};

const PET_BLANK = {
  name: '', species: '', power: 10, agility: 10, focus: 10, presence: 10,
  movement: 30, description: '', is_public: false,
  attacks: [] as { name: string; damage_dice: string; damage_type: string; description: string }[],
};

// ── Shared sub-components ─────────────────────────────────────────────────

function Fld({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={style}><label style={LBL}>{label}</label>{children}</div>;
}

function ModalWrap({ children, accentColor = T.gold }: { children: React.ReactNode; accentColor?: string }) {
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 999 }} />
      <div style={{ position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '640px', padding: '0 16px', zIndex: 1000, paddingBottom: '48px' }}>
        <div style={{ background: T.card, border: `1px solid ${accentColor}44`, borderTop: `2px solid ${accentColor}`, borderRadius: '6px', padding: '26px' }}>
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}

function PublicToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: T.surface, border: `1px solid ${value ? T.gold + '44' : T.border}`, borderRadius: '3px' }}>
      <button onClick={() => onChange(!value)}
        style={{ width: '36px', height: '20px', borderRadius: '10px', border: 'none', cursor: 'pointer', background: value ? T.gold : '#2a2e3a', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}>
        <span style={{ position: 'absolute', top: '3px', left: value ? '18px' : '3px', width: '14px', height: '14px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </button>
      <div>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: value ? T.gold : T.textMuted, letterSpacing: '0.1em' }}>PUBLIC</div>
        <div style={{ fontSize: '12px', color: T.textDim }}>Visible to all players in the browser</div>
      </div>
    </div>
  );
}

function VersionHistory({ type, id }: { type: HomebrewType; id: string }) {
  const { data: history, isLoading } = useVersionHistory(type, id);
  if (isLoading) return <div style={{ fontSize: '12px', color: T.textMuted, padding: '8px' }}>Loading history…</div>;
  if (!history?.length) return <div style={{ fontSize: '12px', color: T.textDim, padding: '8px' }}>No previous versions.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0' }}>
      {[...history].reverse().map((v) => (
        <div key={v.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px', padding: '8px 12px', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: T.gold }}>VERSION {v.version}</span>
            <span style={{ color: T.textMuted }}>{new Date(v.saved_at).toLocaleString()}</span>
          </div>
          <div style={{ color: T.textDim, fontStyle: 'italic' }}>
            {(v.snapshot as any).name ?? '(unnamed)'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Form: Weapon ──────────────────────────────────────────────────────────

function WeaponForm({ draft, setDraft }: { draft: typeof WEAPON_BLANK; setDraft: React.Dispatch<React.SetStateAction<typeof WEAPON_BLANK>> }) {
  const DAMAGE_TYPES = ['slashing', 'piercing', 'bludgeoning', 'fire', 'ice', 'lightning', 'shadow', 'arcane', 'poison', 'earth', 'wind', 'light', 'nature'];
  const addChannel = () => setDraft(p => ({ ...p, channels: [...p.channels, { damage_type: 'fire', num_dice: 1 }] }));
  const delChannel = (i: number) => setDraft(p => ({ ...p, channels: p.channels.filter((_, ci) => ci !== i) }));
  const updChannel = (i: number, k: string, v: string | number) =>
    setDraft(p => ({ ...p, channels: p.channels.map((c, ci) => ci === i ? { ...c, [k]: v } : c) }));
  const totalBudget = draft.channels.reduce((s, c) => s + c.num_dice, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <Fld label="Name"><input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} style={inp()} /></Fld>
        <Fld label="Category">
          <select value={draft.category} onChange={e => setDraft(p => ({ ...p, category: e.target.value }))} style={inp()}>
            {['dagger','short_sword','long_sword','rapier','great_axe','warhammer','mace','staff','shortbow','longbow','custom'].map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </Fld>
        <Fld label="Rarity">
          <select value={draft.rarity} onChange={e => setDraft(p => ({ ...p, rarity: e.target.value }))} style={{ ...inp(), color: RARITY_COLOR[draft.rarity] }}>
            {['common','uncommon','rare','epic','legendary','mythic'].map(r => <option key={r} value={r} style={{ color: RARITY_COLOR[r] }}>{cap(r)}</option>)}
          </select>
        </Fld>
        <Fld label="Base Die">
          <select value={draft.base_die_type} onChange={e => setDraft(p => ({ ...p, base_die_type: Number(e.target.value) }))} style={inp()}>
            {[4,6,8,10,12].map(d => <option key={d} value={d}>d{d}</option>)}
          </select>
        </Fld>
        <Fld label="Req. Power"><input type="number" min={0} value={draft.req_power} onChange={e => setDraft(p => ({ ...p, req_power: Number(e.target.value) }))} style={inp()} /></Fld>
        <Fld label="Req. Agility"><input type="number" min={0} value={draft.req_agility} onChange={e => setDraft(p => ({ ...p, req_agility: Number(e.target.value) }))} style={inp()} /></Fld>
        <Fld label="Req. Focus"><input type="number" min={0} value={draft.req_focus} onChange={e => setDraft(p => ({ ...p, req_focus: Number(e.target.value) }))} style={inp()} /></Fld>
        <Fld label="Gem Slots"><input type="number" min={0} max={5} value={draft.gem_slots} onChange={e => setDraft(p => ({ ...p, gem_slots: Number(e.target.value) }))} style={inp()} /></Fld>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <label style={LBL}>Damage Channels <span style={{ color: T.textDim }}>— Total budget: {totalBudget} dice</span></label>
          <button onClick={addChannel} style={{ ...Btn('#c8503a'), padding: '3px 10px', fontSize: '10px' }}>+ CHANNEL</button>
        </div>
        {draft.channels.map((ch, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', background: '#080a12', padding: '6px 8px', borderRadius: '3px' }}>
            <select value={ch.damage_type} onChange={e => updChannel(i, 'damage_type', e.target.value)} style={{ ...inp(), flex: 1 }}>
              {DAMAGE_TYPES.map(t => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
            <input type="number" min={1} max={12} value={ch.num_dice} onChange={e => updChannel(i, 'num_dice', Number(e.target.value))} style={{ ...inp(), width: '60px', textAlign: 'center' }} />
            <span style={{ color: T.textMuted, whiteSpace: 'nowrap', fontSize: '13px' }}>d{draft.base_die_type} × RP</span>
            {draft.channels.length > 1 && <button onClick={() => delChannel(i)} style={{ ...Btn('#662020'), padding: '3px 8px' }}>✕</button>}
          </div>
        ))}
      </div>
      <Fld label="Description / Lore"><textarea value={draft.description} onChange={e => setDraft(p => ({ ...p, description: e.target.value }))} style={{ ...inp(), minHeight: '72px', resize: 'vertical' }} /></Fld>
      <PublicToggle value={draft.is_public} onChange={v => setDraft(p => ({ ...p, is_public: v }))} />
    </div>
  );
}

// ── Form: Armor ───────────────────────────────────────────────────────────

function ArmorForm({ draft, setDraft }: { draft: typeof ARMOR_BLANK; setDraft: React.Dispatch<React.SetStateAction<typeof ARMOR_BLANK>> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <Fld label="Name"><input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} style={inp()} /></Fld>
        <Fld label="Slot">
          <select value={draft.slot} onChange={e => setDraft(p => ({ ...p, slot: e.target.value }))} style={inp()}>
            {['helmet','chestplate','leggings','gauntlets','boots','shirt','pants'].map(s => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
        </Fld>
        <Fld label="Category">
          <select value={draft.category} onChange={e => setDraft(p => ({ ...p, category: e.target.value }))} style={inp()}>
            {['light','medium','heavy'].map(c => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
        </Fld>
        <Fld label="Rarity">
          <select value={draft.rarity} onChange={e => setDraft(p => ({ ...p, rarity: e.target.value }))} style={{ ...inp(), color: RARITY_COLOR[draft.rarity] }}>
            {['common','uncommon','rare','epic','legendary','mythic'].map(r => <option key={r} value={r} style={{ color: RARITY_COLOR[r] }}>{cap(r)}</option>)}
          </select>
        </Fld>
        <Fld label="Mitigation %">
          <input type="number" min={0} max={30} step={0.5} value={draft.mitigation_percent} onChange={e => setDraft(p => ({ ...p, mitigation_percent: e.target.value }))} style={inp()} />
        </Fld>
        <Fld label="Req. Power"><input type="number" min={0} value={draft.req_power} onChange={e => setDraft(p => ({ ...p, req_power: Number(e.target.value) }))} style={inp()} /></Fld>
        <Fld label="Gem Slots"><input type="number" min={0} max={3} value={draft.gem_slots} onChange={e => setDraft(p => ({ ...p, gem_slots: Number(e.target.value) }))} style={inp()} /></Fld>
      </div>
      <Fld label="Description / Lore"><textarea value={draft.description} onChange={e => setDraft(p => ({ ...p, description: e.target.value }))} style={{ ...inp(), minHeight: '72px', resize: 'vertical' }} /></Fld>
      <PublicToggle value={draft.is_public} onChange={v => setDraft(p => ({ ...p, is_public: v }))} />
    </div>
  );
}

// ── Form: Spell Gem ───────────────────────────────────────────────────────

function GemForm({ draft, setDraft }: { draft: typeof GEM_BLANK; setDraft: React.Dispatch<React.SetStateAction<typeof GEM_BLANK>> }) {
  const ELEMENTS = ['fire','ice','lightning','shadow','arcane','poison','earth','wind','light','nature','custom'];
  const elemCap: Record<string, string> = { light: 'Radiant', custom: 'Custom' };
  const dispElem = (e: string) => elemCap[e] ?? cap(e);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <Fld label="Name"><input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} style={inp()} /></Fld>
        <Fld label="Element">
          <select value={draft.element_type} onChange={e => setDraft(p => ({ ...p, element_type: e.target.value }))} style={{ ...inp(), color: ELEM_COLOR[dispElem(draft.element_type)] ?? T.text }}>
            {ELEMENTS.map(el => <option key={el} value={el} style={{ color: ELEM_COLOR[dispElem(el)] ?? T.text }}>{dispElem(el)}</option>)}
          </select>
        </Fld>
        <Fld label="Rarity">
          <select value={draft.rarity} onChange={e => setDraft(p => ({ ...p, rarity: e.target.value }))} style={{ ...inp(), color: RARITY_COLOR[draft.rarity] }}>
            {['common','uncommon','rare','epic','legendary','mythic'].map(r => <option key={r} value={r} style={{ color: RARITY_COLOR[r] }}>{cap(r)}</option>)}
          </select>
        </Fld>
        <Fld label="Dice">
          <div style={{ display: 'flex', gap: '6px' }}>
            <input type="number" min={1} max={6} value={draft.num_dice} onChange={e => setDraft(p => ({ ...p, num_dice: Number(e.target.value) }))} style={{ ...inp(), flex: 1 }} placeholder="# dice" />
            <select value={draft.die_type} onChange={e => setDraft(p => ({ ...p, die_type: Number(e.target.value) }))} style={{ ...inp(), flex: 1 }}>
              {[4,6,8,10,12].map(d => <option key={d} value={d}>d{d}</option>)}
            </select>
          </div>
        </Fld>
        <Fld label="Armor Resist %"><input type="number" min={0} max={100} step={0.5} value={draft.armor_resistance_percent} onChange={e => setDraft(p => ({ ...p, armor_resistance_percent: e.target.value }))} style={inp()} /></Fld>
        <Fld label="Secondary Effect"><input value={draft.secondary_effect} onChange={e => setDraft(p => ({ ...p, secondary_effect: e.target.value }))} placeholder="e.g. Applies Burned" style={inp()} /></Fld>
      </div>
      <Fld label="Description / Lore"><textarea value={draft.description} onChange={e => setDraft(p => ({ ...p, description: e.target.value }))} style={{ ...inp(), minHeight: '72px', resize: 'vertical' }} /></Fld>
      <PublicToggle value={draft.is_public} onChange={v => setDraft(p => ({ ...p, is_public: v }))} />
    </div>
  );
}

// ── Form: Enemy ───────────────────────────────────────────────────────────

function EnemyForm({ draft, setDraft }: { draft: typeof ENEMY_BLANK; setDraft: React.Dispatch<React.SetStateAction<typeof ENEMY_BLANK>> }) {
  const DMG_TYPES = ['slashing','piercing','bludgeoning','fire','ice','lightning','shadow','arcane','poison','earth','wind','light','nature'];
  const [traitPreset, setTraitPreset] = useState('');

  // Derived base_rp for display
  const chosenAttr = Math.max(draft.power, draft.agility, draft.focus, draft.presence);
  const baseRP = 1 + Math.floor((chosenAttr - 10) / 2); // calcBaseRP(1, chosen, 0)

  const addOfficialTrait = (name: string) => {
    if (!name) return;
    const found = OFFICIAL_TRAITS.find(t => t.name === name);
    if (found && !draft.traits.find(t => t.name === found.name)) {
      setDraft(p => ({ ...p, traits: [...p.traits, { ...found }] }));
    }
    setTraitPreset('');
  };
  const addCustomTrait = () => setDraft(p => ({ ...p, traits: [...p.traits, { name: '', description: '' }] }));
  const delTrait = (i: number) => setDraft(p => ({ ...p, traits: p.traits.filter((_, ti) => ti !== i) }));
  const updTrait = (i: number, k: string, v: string) => setDraft(p => ({ ...p, traits: p.traits.map((t, ti) => ti === i ? { ...t, [k]: v } : t) }));

  const addAtk = () => setDraft(p => ({ ...p, attacks: [...p.attacks, { name: '', damage_dice: '1d6', damage_type: 'slashing', description: '' }] }));
  const delAtk = (i: number) => setDraft(p => ({ ...p, attacks: p.attacks.filter((_, ai) => ai !== i) }));
  const updAtk = (i: number, k: string, v: string) => setDraft(p => ({ ...p, attacks: p.attacks.map((a, ai) => ai === i ? { ...a, [k]: v } : a) }));

  const updTier = (i: number, k: string, v: string | number) => setDraft(p => ({ ...p, attack_tiers: p.attack_tiers.map((t, ti) => ti === i ? { ...t, [k]: v } : t) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Core stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <Fld label="Name"><input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} style={inp()} /></Fld>
        <Fld label="Classification">
          <select value={draft.classification} onChange={e => setDraft(p => ({ ...p, classification: e.target.value }))} style={{ ...inp(), color: CLASS_COLOR[draft.classification] }}>
            {['minion','standard','elite','boss'].map(c => <option key={c} value={c} style={{ color: CLASS_COLOR[c] }}>{cap(c)}</option>)}
          </select>
        </Fld>
        <Fld label="HP"><input type="number" min={1} value={draft.hp} onChange={e => setDraft(p => ({ ...p, hp: Number(e.target.value) }))} style={inp()} /></Fld>
        <Fld label="Resistance Modifier"><input type="number" value={draft.resistance_modifier} onChange={e => setDraft(p => ({ ...p, resistance_modifier: Number(e.target.value) }))} style={inp()} /></Fld>
        <Fld label="Enemy Weight"><input type="number" min={0.1} step={0.1} value={draft.enemy_weight} onChange={e => setDraft(p => ({ ...p, enemy_weight: e.target.value }))} style={inp()} /></Fld>
      </div>

      {/* Attributes + RP */}
      <div>
        <label style={{ ...LBL, marginBottom: '8px' }}>Attributes</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px' }}>
          {(['Power','Agility','Focus','Presence'] as const).map(attr => (
            <Fld key={attr} label={attr}>
              <input type="number" min={1} max={30} value={(draft as any)[attr.toLowerCase()]}
                onChange={e => setDraft(p => ({ ...p, [attr.toLowerCase()]: Number(e.target.value) }))}
                style={{ ...inp(), color: ATTR_COLOR[attr] }} />
            </Fld>
          ))}
        </div>
        <div style={{ marginTop: '8px', padding: '8px 12px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px', display: 'inline-flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: T.textDim }}>BASE RP</span>
          <span style={{ fontSize: '16px', fontWeight: '600', color: '#4a9de8' }}>{baseRP}</span>
          <span style={{ fontSize: '12px', color: T.textDim }}>from highest attr mod at level 1</span>
        </div>
      </div>

      {/* Traits */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <label style={LBL}>Traits</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <select value={traitPreset} onChange={e => addOfficialTrait(e.target.value)} style={{ ...inp(), width: 'auto', fontSize: '11px', padding: '3px 24px 3px 8px' }}>
              <option value="">+ Official Trait…</option>
              {OFFICIAL_TRAITS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <button onClick={addCustomTrait} style={{ ...Btn(T.gold), padding: '3px 10px', fontSize: '10px' }}>+ CUSTOM</button>
          </div>
        </div>
        {draft.traits.map((tr, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '6px', marginBottom: '6px' }}>
            <input value={tr.name} onChange={e => updTrait(i, 'name', e.target.value)} placeholder="Trait name" style={inp()} />
            <input value={tr.description} onChange={e => updTrait(i, 'description', e.target.value)} placeholder="Effect description" style={inp()} />
            <button onClick={() => delTrait(i)} style={{ ...Btn('#662020'), padding: '4px 8px' }}>✕</button>
          </div>
        ))}
        {!draft.traits.length && <div style={{ fontSize: '12px', color: T.textDim, fontStyle: 'italic' }}>No traits added.</div>}
      </div>

      {/* Named Attacks */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <label style={LBL}>Attacks</label>
          <button onClick={addAtk} style={{ ...Btn('#e05050'), padding: '3px 10px', fontSize: '10px' }}>+ ATTACK</button>
        </div>
        {draft.attacks.map((atk, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.5fr auto', gap: '6px', marginBottom: '6px', background: '#080a12', padding: '8px', borderRadius: '3px' }}>
            <input value={atk.name} onChange={e => updAtk(i, 'name', e.target.value)} placeholder="Attack name" style={inp()} />
            <input value={atk.damage_dice} onChange={e => updAtk(i, 'damage_dice', e.target.value)} placeholder="2d8" style={inp()} />
            <select value={atk.damage_type} onChange={e => updAtk(i, 'damage_type', e.target.value)} style={inp()}>
              {DMG_TYPES.map(t => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
            <button onClick={() => delAtk(i)} style={{ ...Btn('#662020'), padding: '4px 8px' }}>✕</button>
          </div>
        ))}
        {!draft.attacks.length && <div style={{ fontSize: '12px', color: T.textDim, fontStyle: 'italic' }}>No named attacks. Use Attack Tiers below for damage scaling.</div>}
      </div>

      {/* Attack Tiers */}
      <div>
        <label style={{ ...LBL, marginBottom: '8px' }}>Attack Tiers</label>
        {draft.attack_tiers.map((tier, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: '6px', marginBottom: '6px', background: '#080a12', padding: '8px', borderRadius: '3px' }}>
            <input value={tier.tier_name} onChange={e => updTier(i, 'tier_name', e.target.value)} placeholder="Tier name" style={inp()} />
            <Fld label="Steps"><input type="number" min={1} max={5} value={tier.pressure_steps} onChange={e => updTier(i, 'pressure_steps', Number(e.target.value))} style={inp()} /></Fld>
            <Fld label="Dmg ×"><input type="number" min={1} value={tier.damage_multiplier} onChange={e => updTier(i, 'damage_multiplier', Number(e.target.value))} style={inp()} /></Fld>
            <Fld label="Max Pool"><input type="number" min={0} value={tier.max_pool_contribution} onChange={e => updTier(i, 'max_pool_contribution', Number(e.target.value))} style={inp()} /></Fld>
          </div>
        ))}
      </div>

      <Fld label="Description / Lore"><textarea value={draft.description} onChange={e => setDraft(p => ({ ...p, description: e.target.value }))} style={{ ...inp(), minHeight: '72px', resize: 'vertical' }} /></Fld>
      <PublicToggle value={draft.is_public} onChange={v => setDraft(p => ({ ...p, is_public: v }))} />
    </div>
  );
}

// ── Form: Pet ─────────────────────────────────────────────────────────────

function PetForm({ draft, setDraft }: { draft: typeof PET_BLANK; setDraft: React.Dispatch<React.SetStateAction<typeof PET_BLANK>> }) {
  const DMG_TYPES = ['slashing','piercing','bludgeoning','fire','ice','lightning','shadow','arcane','poison','earth','wind','light','nature'];
  const addAtk = () => setDraft(p => ({ ...p, attacks: [...p.attacks, { name: '', damage_dice: '1d6', damage_type: 'slashing', description: '' }] }));
  const delAtk = (i: number) => setDraft(p => ({ ...p, attacks: p.attacks.filter((_, ai) => ai !== i) }));
  const updAtk = (i: number, k: string, v: string) => setDraft(p => ({ ...p, attacks: p.attacks.map((a, ai) => ai === i ? { ...a, [k]: v } : a) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <Fld label="Name"><input value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} style={inp()} /></Fld>
        <Fld label="Species"><input value={draft.species} onChange={e => setDraft(p => ({ ...p, species: e.target.value }))} placeholder="e.g. Wolf, Dragon, Swallow" style={inp()} /></Fld>
      </div>
      <div>
        <label style={{ ...LBL, marginBottom: '8px' }}>Attributes</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px' }}>
          {(['Power','Agility','Focus','Presence'] as const).map(attr => (
            <Fld key={attr} label={attr} style={{}}>
              <input type="number" min={1} max={30} value={(draft as any)[attr.toLowerCase()]} onChange={e => setDraft(p => ({ ...p, [attr.toLowerCase()]: Number(e.target.value) }))} style={{ ...inp(), color: ATTR_COLOR[attr] }} />
            </Fld>
          ))}
        </div>
        <div style={{ marginTop: '8px', padding: '8px 12px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px', display: 'inline-flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: T.textDim }}>BASE RP</span>
          <span style={{ fontSize: '16px', fontWeight: '600', color: '#4a9de8' }}>{1 + Math.floor((Math.max(draft.power, draft.agility, draft.focus, draft.presence) - 10) / 2)}</span>
          <span style={{ fontSize: '12px', color: T.textDim }}>from highest attr mod at level 1</span>
        </div>
      </div>
      <Fld label="Movement (ft)" style={{ maxWidth: '120px' }}><input type="number" min={5} step={5} value={draft.movement} onChange={e => setDraft(p => ({ ...p, movement: Number(e.target.value) }))} style={inp()} /></Fld>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <label style={LBL}>Attacks</label>
          <button onClick={addAtk} style={{ ...Btn('#50c878'), padding: '3px 10px', fontSize: '10px' }}>+ ATTACK</button>
        </div>
        {draft.attacks.map((atk, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.5fr auto', gap: '6px', marginBottom: '6px', background: '#080a12', padding: '8px', borderRadius: '3px' }}>
            <input value={atk.name} onChange={e => updAtk(i, 'name', e.target.value)} placeholder="Attack name" style={inp()} />
            <input value={atk.damage_dice} onChange={e => updAtk(i, 'damage_dice', e.target.value)} placeholder="2d6" style={inp()} />
            <select value={atk.damage_type} onChange={e => updAtk(i, 'damage_type', e.target.value)} style={inp()}>
              {DMG_TYPES.map(t => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
            <button onClick={() => delAtk(i)} style={{ ...Btn('#662020'), padding: '4px 8px' }}>✕</button>
          </div>
        ))}
        {!draft.attacks.length && <div style={{ fontSize: '12px', color: T.textDim, fontStyle: 'italic' }}>No attacks. Pets without attacks are passive companions.</div>}
      </div>

      <Fld label="Description / Lore"><textarea value={draft.description} onChange={e => setDraft(p => ({ ...p, description: e.target.value }))} style={{ ...inp(), minHeight: '72px', resize: 'vertical' }} /></Fld>
      <PublicToggle value={draft.is_public} onChange={v => setDraft(p => ({ ...p, is_public: v }))} />
    </div>
  );
}

// ── Item cards ────────────────────────────────────────────────────────────

function ItemCard({
  item, type, accentColor, onEdit, onDelete, summary,
}: {
  item: Record<string, unknown>;
  type: HomebrewType;
  accentColor: string;
  onEdit: () => void;
  onDelete: () => void;
  summary: React.ReactNode;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const rarity = (item.rarity as string) ?? '';
  const rarColor = RARITY_COLOR[rarity] ?? T.textMuted;

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${accentColor}44`, borderRadius: '4px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div>
          <div style={{ fontWeight: '500', fontSize: '16px', color: rarity ? rarColor : T.text, marginBottom: '3px' }}>{item.name as string}</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {rarity && <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', padding: '1px 8px', borderRadius: '8px', background: `${rarColor}18`, border: `1px solid ${rarColor}44`, color: rarColor }}>{cap(rarity)}</span>}
            {!!item.version && <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: T.textDim }}>v{item.version as number}</span>}
            {!!item.is_public && <span style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: T.gold }}>◈ PUBLIC</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={onEdit} style={{ ...Btn(T.gold), padding: '4px 10px', fontSize: '10px' }}>✎ EDIT</button>
          {!deleteConfirm
            ? <button onClick={() => setDeleteConfirm(true)} style={{ ...Btn('#662020'), padding: '4px 10px', fontSize: '10px' }}>✕</button>
            : <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => setDeleteConfirm(false)} style={{ ...Btn(T.textMuted), padding: '4px 8px', fontSize: '10px' }}>NO</button>
                <button onClick={onDelete} style={{ ...Btn('#e05050'), padding: '4px 8px', fontSize: '10px', background: '#1a0808' }}>DELETE</button>
              </div>
          }
        </div>
      </div>

      <div style={{ fontSize: '13px', color: T.textMuted, marginBottom: '10px', lineHeight: '1.6' }}>{summary}</div>

      {!!item.description && <div style={{ fontSize: '13px', color: T.textDim, fontStyle: 'italic', marginBottom: '10px' }}>{item.description as string}</div>}

      <button onClick={() => setShowHistory(p => !p)} style={{ ...Btn(T.textDim), padding: '3px 10px', fontSize: '10px', marginBottom: showHistory ? '10px' : 0 }}>
        {showHistory ? '▲ HIDE HISTORY' : '▾ VERSION HISTORY'}
      </button>
      {showHistory && <VersionHistory type={type} id={item.id as string} />}
    </div>
  );
}

// ── Item summaries ────────────────────────────────────────────────────────

function WeaponSummary({ item }: { item: Record<string, unknown> }) {
  const channels = (item.channels as { damage_type: string; num_dice: number }[]) ?? [];
  return (
    <span>
      {channels.map((ch, i) => (
        <span key={i}>{i > 0 && ' + '}{ch.num_dice}d{item.base_die_type as number} <span style={{ color: ch.damage_type === 'slashing' || ch.damage_type === 'piercing' || ch.damage_type === 'bludgeoning' ? T.text : ELEM_COLOR[cap(ch.damage_type)] ?? T.text }}>{cap(ch.damage_type)}</span></span>
      ))} × RP{(item.req_power as number) > 0 ? ` · PWR ${item.req_power}+` : ''}{(item.req_agility as number) > 0 ? ` · AGI ${item.req_agility}+` : ''}{(item.req_focus as number) > 0 ? ` · FOC ${item.req_focus}+` : ''}
    </span>
  );
}

function ArmorSummary({ item }: { item: Record<string, unknown> }) {
  return <span>{cap(item.slot as string)} · {cap(item.category as string)} · {String(item.mitigation_percent)}% mitigation{(item.req_power as number) > 0 ? ` · PWR ${item.req_power}+` : ''}</span>;
}

function GemSummary({ item }: { item: Record<string, unknown> }) {
  const elemCap: Record<string, string> = { light: 'Radiant' };
  const elem = elemCap[item.element_type as string] ?? cap(item.element_type as string);
  return <span><span style={{ color: ELEM_COLOR[elem] ?? T.text }}>{elem}</span> · {item.num_dice as number}d{item.die_type as number} × RP · +{String(item.armor_resistance_percent)}% armor res{item.secondary_effect ? ` · ${String(item.secondary_effect)}` : ''}</span>;
}

function EnemySummary({ item }: { item: Record<string, unknown> }) {
  const hp = Number(item.hp);
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  return <span><span style={{ color: CLASS_COLOR[item.classification as string] ?? T.text }}>{cap(item.classification as string)}</span> · {fmt(hp)} HP · Weight {item.enemy_weight as string}</span>;
}

function PetSummary({ item }: { item: Record<string, unknown> }) {
  return <span>{item.species as string} · P{item.power as number} A{item.agility as number} F{item.focus as number} Pr{item.presence as number} · {item.movement as number}ft</span>;
}

const SUMMARY_MAP: Record<HomebrewType, React.ComponentType<{ item: Record<string, unknown> }>> = {
  'weapon': WeaponSummary, 'armor': ArmorSummary, 'spell-gem': GemSummary,
  'enemy': EnemySummary, 'pet': PetSummary,
};

// ── Duplicate warning modal ───────────────────────────────────────────────

function DupWarning({ matches, onConfirm, onCancel }: {
  matches: { id: string; name: string }[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalWrap accentColor="#e8a020">
      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.2em', color: '#e8a020', marginBottom: '16px' }}>⚠ POSSIBLE DUPLICATE</div>
      <p style={{ color: T.textMuted, fontSize: '14px', lineHeight: '1.7', marginBottom: '14px' }}>
        The following existing items have similar stats. Are you sure you want to create another?
      </p>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px', padding: '10px 14px', marginBottom: '18px' }}>
        {matches.map(m => (
          <div key={m.id} style={{ fontSize: '14px', color: T.text, padding: '4px 0', borderBottom: `1px solid ${T.border}` }}>{m.name}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <button onClick={onCancel} style={{ ...Btn(T.textMuted), padding: '10px' }}>CANCEL</button>
        <button onClick={onConfirm} style={{ ...Btn('#e8a020'), padding: '10px', background: '#1a1000' }}>SAVE ANYWAY</button>
      </div>
    </ModalWrap>
  );
}

// ── Tab content ───────────────────────────────────────────────────────────

function TabContent({
  type, accentColor, isPaid,
}: { type: HomebrewType; accentColor: string; isPaid: boolean }) {
  const { data: items, isLoading } = useMyHomebrew(type);
  const create  = useCreateHomebrew(type);
  const patch   = usePatchHomebrew(type);
  const destroy = useDeleteHomebrew(type);
  const dupCheck = useDuplicateCheck();

  const [modal,       setModal]       = useState<'create' | 'edit' | null>(null);
  const [editTarget,  setEditTarget]  = useState<Record<string, unknown> | null>(null);
  const [dupWarning,  setDupWarning]  = useState<{ matches: { id: string; name: string }[]; payload: Record<string, unknown> } | null>(null);

  // Per-type draft state
  const [weaponDraft,  setWeaponDraft]  = useState({ ...WEAPON_BLANK });
  const [armorDraft,   setArmorDraft]   = useState({ ...ARMOR_BLANK });
  const [gemDraft,     setGemDraft]     = useState({ ...GEM_BLANK });
  const [enemyDraft,   setEnemyDraft]   = useState<typeof ENEMY_BLANK>({ ...ENEMY_BLANK, traits: [...ENEMY_BLANK.traits], attacks: [...ENEMY_BLANK.attacks], attack_tiers: [...ENEMY_BLANK.attack_tiers] });
  const [petDraft,     setPetDraft]     = useState<typeof PET_BLANK>({ ...PET_BLANK, attacks: [...PET_BLANK.attacks] });

  const getDraft = useCallback((): Record<string, unknown> => {
    if (type === 'weapon')    return { ...weaponDraft, total_dice_budget: weaponDraft.channels.reduce((s, c) => s + c.num_dice, 0) };
    if (type === 'armor')     return { ...armorDraft };
    if (type === 'spell-gem') return { ...gemDraft };
    if (type === 'enemy')     return { ...enemyDraft };
    return { ...petDraft };
  }, [type, weaponDraft, armorDraft, gemDraft, enemyDraft, petDraft]);

  const resetDraft = () => {
    setWeaponDraft({ ...WEAPON_BLANK });
    setArmorDraft({ ...ARMOR_BLANK });
    setGemDraft({ ...GEM_BLANK });
    setEnemyDraft({ ...ENEMY_BLANK, traits: [...ENEMY_BLANK.traits], attacks: [...ENEMY_BLANK.attacks], attack_tiers: [...ENEMY_BLANK.attack_tiers] });
    setPetDraft({ ...PET_BLANK, attacks: [...PET_BLANK.attacks] });
  };

  const loadDraftFromItem = (item: Record<string, unknown>) => {
    if (type === 'weapon')    setWeaponDraft({ ...WEAPON_BLANK, ...(item as any) });
    if (type === 'armor')     setArmorDraft({ ...ARMOR_BLANK, ...(item as any) });
    if (type === 'spell-gem') setGemDraft({ ...GEM_BLANK, ...(item as any) });
    if (type === 'enemy')     setEnemyDraft({ ...ENEMY_BLANK, ...(item as any), traits: (item.traits as any) ?? [], attacks: (item.attacks as any) ?? [], attack_tiers: (item.attack_tiers as any) ?? [...ENEMY_BLANK.attack_tiers] });
    if (type === 'pet')       setPetDraft({ ...PET_BLANK, ...(item as any), attacks: (item.attacks as any) ?? [] });
  };

  const openCreate = () => { resetDraft(); setEditTarget(null); setModal('create'); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const openEdit   = (item: Record<string, unknown>) => { loadDraftFromItem(item); setEditTarget(item); setModal('edit'); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const closeModal = () => { setModal(null); setEditTarget(null); window.scrollTo({ top: 0, behavior: 'instant' }); };

  const buildDupPayload = (): Record<string, unknown> | null => {
    const draft = getDraft();
    if (type === 'weapon')    return { item_type: 'weapon',      base_die_type: draft.base_die_type, total_dice_budget: draft.total_dice_budget, channels: draft.channels };
    if (type === 'armor')     return { item_type: 'armor',       slot: draft.slot,         mitigation_percent: draft.mitigation_percent };
    if (type === 'spell-gem') return { item_type: 'spell_gem',   element_type: draft.element_type, num_dice: draft.num_dice, die_type: draft.die_type };
    if (type === 'enemy')     return { item_type: 'enemy',       classification: draft.classification, hp: draft.hp };
    if (type === 'pet')       return { item_type: 'pet',         species: draft.species,  power: draft.power, agility: draft.agility, focus: draft.focus, presence: draft.presence };
    return null;
  };

  const doSave = async (payload: Record<string, unknown>) => {
    if (modal === 'edit' && editTarget) {
      await patch.mutateAsync({ id: editTarget.id as string, ...payload });
    } else {
      await create.mutateAsync(payload);
    }
    closeModal();
  };

  const handleSave = async () => {
    const payload = getDraft();
    if (!(payload.name as string)?.trim()) return;

    // Duplicate check only on create
    if (modal === 'create') {
      const dupPayload = buildDupPayload();
      if (dupPayload) {
        const matches = await dupCheck.mutateAsync(dupPayload);
        if (matches.length) { setDupWarning({ matches, payload }); return; }
      }
    }
    await doSave(payload);
  };

  const isSaving = create.isPending || patch.isPending;

  const FormComponent = ({
    'weapon':    <WeaponForm draft={weaponDraft} setDraft={setWeaponDraft} />,
    'armor':     <ArmorForm  draft={armorDraft}  setDraft={setArmorDraft}  />,
    'spell-gem': <GemForm    draft={gemDraft}    setDraft={setGemDraft}    />,
    'enemy':     <EnemyForm  draft={enemyDraft}  setDraft={setEnemyDraft}  />,
    'pet':       <PetForm    draft={petDraft}    setDraft={setPetDraft}    />,
  } as Record<HomebrewType, React.ReactElement>)[type];

  const SummaryComp = SUMMARY_MAP[type];

  return (
    <>
      {/* Paywall notice */}
      {!isPaid && (
        <div style={{ background: '#0e0a04', border: `1px solid ${T.gold}44`, borderRadius: '4px', padding: '14px 18px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: T.gold, letterSpacing: '0.14em', marginBottom: '4px' }}>PLAYER OR DM SUBSCRIPTION REQUIRED</div>
            <div style={{ fontSize: '13px', color: T.textMuted }}>Homebrew creation requires a paid plan. Browsing public homebrew is always free.</div>
          </div>
          <Link to="/account/subscription" style={{ ...Btn(T.gold, `${T.gold}15`), textDecoration: 'none', padding: '8px 18px', whiteSpace: 'nowrap' }}>UPGRADE</Link>
        </div>
      )}

      {/* Create button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <button onClick={openCreate} disabled={!isPaid}
          style={{ ...Btn(accentColor, `${accentColor}12`), padding: '8px 20px', fontSize: '12px', opacity: isPaid ? 1 : 0.4 }}>
          + CREATE NEW
        </button>
      </div>

      {/* Item list */}
      {isLoading && <div style={{ textAlign: 'center', padding: '40px', color: T.textMuted, fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em' }}>LOADING…</div>}
      {!isLoading && (!items || items.length === 0) && (
        <div style={{ textAlign: 'center', padding: '60px 20px', border: `1px dashed ${T.border}`, borderRadius: '4px' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px' }}>✦</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em', color: T.textMuted, marginBottom: '8px' }}>NO HOMEBREW YET</div>
          <div style={{ fontSize: '14px', color: T.textDim }}>Create your first homebrew item above.</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items?.map((item: Record<string, unknown>) => (
          <ItemCard
            key={item.id as string}
            item={item}
            type={type}
            accentColor={accentColor}
            onEdit={() => openEdit(item)}
            onDelete={() => destroy.mutate(item.id as string)}
            summary={<SummaryComp item={item} />}
          />
        ))}
      </div>

      {/* Create / Edit modal */}
      {modal && (
        <ModalWrap accentColor={accentColor}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.22em', color: accentColor, marginBottom: '4px' }}>
            {modal === 'create' ? 'CREATE' : 'EDIT'} HOMEBREW
          </div>
          <div style={{ fontSize: '18px', fontWeight: '500', color: T.text, marginBottom: '16px' }}>
            {modal === 'edit' ? (editTarget?.name as string) : `New ${TABS.find(t => t.type === type)?.singular}`}
          </div>
          <div style={{ height: '1px', background: `${accentColor}33`, marginBottom: '18px' }} />
          {FormComponent}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '20px' }}>
            <button onClick={closeModal} style={{ ...Btn(T.textMuted), padding: '10px' }}>CANCEL</button>
            <button onClick={handleSave} disabled={isSaving}
              style={{ ...Btn(accentColor, `${accentColor}15`), padding: '10px', fontSize: '12px', opacity: isSaving ? 0.5 : 1 }}>
              {isSaving ? 'SAVING…' : modal === 'edit' ? '✓ SAVE CHANGES' : '✦ CREATE'}
            </button>
          </div>
        </ModalWrap>
      )}

      {/* Duplicate warning */}
      {dupWarning && (
        <DupWarning
          matches={dupWarning.matches}
          onConfirm={async () => { setDupWarning(null); await doSave(dupWarning.payload); }}
          onCancel={() => setDupWarning(null)}
        />
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function Homebrew() {
  const { user } = useAuthStore();
  const isPaid = user?.subscription_tier === 'player' || user?.subscription_tier === 'dm';
  const [activeTab, setActiveTab] = useState<HomebrewType>('weapon');

  const activeTabCfg = TABS.find(t => t.type === activeTab)!;

  return (
    <div className="page-enter" style={{ padding: '40px 32px', maxWidth: '1100px', margin: '0 auto' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap'); *{box-sizing:border-box} input,select,textarea{font-family:inherit;font-size:inherit} input:focus,select:focus,textarea:focus{border-color:#c4922a!important;outline:none} select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23c4922a'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;padding-right:24px!important;cursor:pointer} select option{background:#0d1018} button{cursor:pointer;transition:opacity 0.15s} button:hover{opacity:0.75} button:disabled{opacity:0.3;cursor:not-allowed} textarea{resize:vertical} ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-thumb{background:#2a2e3a;border-radius:3px}`}</style>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.35em', color: T.goldDim, marginBottom: '6px' }}>◈ VELION MYTHERA</div>
        <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: '26px', fontWeight: '700', color: T.gold, letterSpacing: '0.15em', margin: 0, marginBottom: '6px' }}>HOMEBREW WORKSHOP</h1>
        <p style={{ color: T.textMuted, fontSize: '14px', margin: 0 }}>
          Create and manage custom weapons, armor, gems, enemies, and companions. Public items are visible in character sheet browsers.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '24px', background: T.surface, borderRadius: '4px', padding: '4px', border: `1px solid ${T.border}` }}>
        {TABS.map(tab => {
          const active = activeTab === tab.type;
          return (
            <button key={tab.type} onClick={() => setActiveTab(tab.type)}
              style={{ flex: 1, padding: '8px 4px', border: 'none', borderRadius: '3px', fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.15s',
                background: active ? `${tab.color}18` : 'transparent',
                color: active ? tab.color : T.textMuted,
                borderBottom: active ? `2px solid ${tab.color}` : '2px solid transparent',
              }}>
              <span style={{ display: 'block', fontSize: '16px', marginBottom: '3px' }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <TabContent key={activeTab} type={activeTab} accentColor={activeTabCfg.color} isPaid={isPaid ?? false} />
    </div>
  );
}