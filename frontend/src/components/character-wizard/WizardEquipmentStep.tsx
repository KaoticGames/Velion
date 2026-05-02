import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { GearSlot, GearChoice, StartingGearState } from '@/lib/startingEquipment';

const T = {
  card: '#0d1018', surface: '#0a0c14', border: '#1c2030',
  gold: '#c4922a', text: '#e4d8c0', textMuted: '#706858', textDim: '#282430',
  power: '#e87050', success: '#3dba6a',
};

const STARTING_RARITIES = new Set(['common', 'uncommon']);

const SLOT_ROWS: { slot: GearSlot; label: string; kind: 'weapon' | 'armor' | 'bracer' }[] = [
  { slot: 'main_hand',  label: 'Main Hand',    kind: 'weapon' },
  { slot: 'off_hand',   label: 'Off Hand',     kind: 'weapon' },
  { slot: 'helmet',     label: 'Helmet',       kind: 'armor' },
  { slot: 'shirt',      label: 'Shirt',        kind: 'armor' },
  { slot: 'chestplate', label: 'Chestplate',   kind: 'armor' },
  { slot: 'pants',      label: 'Pants',        kind: 'armor' },
  { slot: 'leggings',   label: 'Leggings',     kind: 'armor' },
  { slot: 'gauntlets',  label: 'Gauntlets',    kind: 'armor' },
  { slot: 'boots',      label: 'Boots',        kind: 'armor' },
  { slot: 'bracer',     label: 'Focus Bracer', kind: 'bracer' },
];

type WeaponRow = {
  id: string; name: string; rarity: string;
  req_power: number; req_agility: number; req_focus: number;
};
type ArmorRow = {
  id: string; name: string; rarity: string; slot: string;
  req_power: number; mitigation_percent: string;
};
type BracerRow = {
  id: string; name: string; rarity?: string; grade: string;
  req_focus: number; gem_slots: number;
};

function meetsWeapon(w: WeaponRow, power: number, agility: number, focus: number) {
  return power >= w.req_power && agility >= w.req_agility && focus >= w.req_focus;
}
function meetsArmor(a: ArmorRow, power: number) {
  return power >= a.req_power;
}
function meetsBracer(b: BracerRow, focus: number) {
  return focus >= b.req_focus;
}

const lbl: React.CSSProperties = {
  fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.14em',
  color: T.textMuted, display: 'block', marginBottom: '6px',
};
const mkBtn = (color = T.gold, filled = false): React.CSSProperties => ({
  background: filled ? color : 'transparent',
  border: `1px solid ${color}`, color: filled ? '#06070c' : color,
  fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.12em',
  padding: '8px 14px', borderRadius: '3px', cursor: 'pointer',
});

interface Props {
  power: number; agility: number; focus: number; presence: number;
  value: StartingGearState;
  onChange: (v: StartingGearState) => void;
}

export default function WizardEquipmentStep({
  power, agility, focus, presence: _presence,
  value, onChange,
}: Props) {
  void _presence;
  const [picker, setPicker] = useState<{ slot: GearSlot; kind: 'weapon' | 'armor' | 'bracer' } | null>(null);
  const [search, setSearch] = useState('');

  const { data: weapons = [], isLoading: lw } = useQuery({
    queryKey: ['library', 'weapons', 'wizard'],
    queryFn:  async () => (await api.get<{ data: WeaponRow[] }>('/library/weapons')).data.data,
  });
  const { data: armor = [], isLoading: la } = useQuery({
    queryKey: ['library', 'armor', 'wizard'],
    queryFn:  async () => (await api.get<{ data: ArmorRow[] }>('/library/armor')).data.data,
  });
  const { data: bracers = [], isLoading: lb } = useQuery({
    queryKey: ['library', 'focus-bracers', 'wizard'],
    queryFn:  async () => (await api.get<{ data: BracerRow[] }>('/library/focus-bracers')).data.data,
  });

  const filteredWeapons = useMemo(() => {
    const q = search.trim().toLowerCase();
    return weapons.filter(
      (w) =>
        STARTING_RARITIES.has(w.rarity.toLowerCase()) &&
        meetsWeapon(w, power, agility, focus) &&
        (!q || w.name.toLowerCase().includes(q)),
    );
  }, [weapons, power, agility, focus, search]);

  const armorForPicker = useMemo(() => {
    if (!picker || picker.kind !== 'armor') return [];
    const q = search.trim().toLowerCase();
    return armor.filter(
      (a) =>
        a.slot === picker.slot &&
        STARTING_RARITIES.has(a.rarity.toLowerCase()) &&
        meetsArmor(a, power) &&
        (!q || a.name.toLowerCase().includes(q)),
    );
  }, [armor, picker, power, search]);

  const filteredBracers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bracers.filter(
      (b) =>
        meetsBracer(b, focus) &&
        (!q || b.name.toLowerCase().includes(q)),
    );
  }, [bracers, focus, search]);

  const setSlot = (slot: GearSlot, choice: GearChoice | undefined) => {
    onChange({ ...value, [slot]: choice });
  };

  const openPicker = (slot: GearSlot, kind: 'weapon' | 'armor' | 'bracer') => {
    setSearch('');
    setPicker({ slot, kind });
  };

  const pickWeapon = (w: WeaponRow) => {
    if (!picker) return;
    setSlot(picker.slot, { item_type: 'weapon', item_id: w.id, name: w.name });
    setPicker(null);
  };

  const pickArmor = (a: ArmorRow) => {
    if (!picker) return;
    setSlot(picker.slot, { item_type: 'armor', item_id: a.id, name: a.name });
    setPicker(null);
  };

  const pickBracer = (b: BracerRow) => {
    if (!picker) return;
    setSlot('bracer', { item_type: 'focus_bracer', item_id: b.id, name: b.name });
    setPicker(null);
  };

  const loading = lw || la || lb;

  return (
    <>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.gold}`, borderRadius: '4px', padding: '16px 18px', marginBottom: '24px' }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.18em', color: T.gold, marginBottom: '8px' }}>STARTING GEAR</div>
        <p style={{ fontFamily: "'EB Garamond', serif", fontSize: '14px', lineHeight: 1.65, color: T.textMuted, margin: 0 }}>
          Choose <strong style={{ color: T.text }}>Common</strong> or <strong style={{ color: T.text }}>Uncommon</strong> items from the library.
          Items must meet your attributes (Power {power}, Agility {agility}, Focus {focus}). Everything is optional — you can equip later on your sheet.
        </p>
      </div>

      {loading && (
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', color: T.textMuted, letterSpacing: '0.12em', marginBottom: '16px' }}>
          Loading library…
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {SLOT_ROWS.map(({ slot, label, kind }) => {
          const cur = value[slot];
          return (
            <div
              key={slot}
              style={{
                background: T.surface, border: `1px solid ${T.border}`, borderRadius: '4px',
                padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ ...lbl, marginBottom: '4px' }}>{label.toUpperCase()}</div>
                <div style={{
                  fontFamily: "'EB Garamond', serif", fontSize: '14px',
                  color: cur ? T.text : T.textDim, fontStyle: cur ? 'normal' : 'italic',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {cur ? cur.name : '— None —'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button type="button" onClick={() => openPicker(slot, kind === 'bracer' ? 'bracer' : kind)} style={mkBtn(T.gold)}>
                  {cur ? 'CHANGE' : 'PICK'}
                </button>
                {cur && (
                  <button type="button" onClick={() => setSlot(slot, undefined)} style={mkBtn(T.power)}>
                    CLEAR
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {picker && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(6,7,12,0.72)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
          }}
          onClick={() => setPicker(null)}
        >
          <div
            style={{
              background: T.card, border: `1px solid ${T.border}`, borderTop: `2px solid ${T.gold}`,
              borderRadius: '6px', maxWidth: '520px', width: '100%', maxHeight: 'min(80vh, 640px)',
              display: 'flex', flexDirection: 'column', boxShadow: `0 24px 48px rgba(0,0,0,0.45)`,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '18px 20px', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em', color: T.textMuted, marginBottom: '6px' }}>
                LIBRARY
              </div>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: '16px', color: T.gold, letterSpacing: '0.1em' }}>
                {picker.kind === 'weapon' && `Weapon — ${picker.slot === 'main_hand' ? 'Main Hand' : 'Off Hand'}`}
                {picker.kind === 'armor' && `Armor — ${SLOT_ROWS.find(r => r.slot === picker.slot)?.label ?? picker.slot}`}
                {picker.kind === 'bracer' && 'Focus Bracer'}
              </div>
              <input
                type="search"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  marginTop: '14px', width: '100%', boxSizing: 'border-box',
                  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
                  borderRadius: '3px', padding: '10px 12px', fontSize: '15px', fontFamily: "'EB Garamond', serif",
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px' }}>
              {picker.kind === 'weapon' && (
                <>
                  {filteredWeapons.length === 0 && (
                    <p style={{ color: T.textMuted, fontFamily: "'EB Garamond', serif", fontSize: '14px' }}>No weapons match your filters and attributes.</p>
                  )}
                  {filteredWeapons.map(w => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => pickWeapon(w)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        background: T.surface, border: `1px solid ${T.border}`, borderRadius: '4px',
                        padding: '12px 14px', marginBottom: '8px', cursor: 'pointer', color: T.text,
                      }}
                    >
                      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: T.gold }}>{w.name}</div>
                      <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '12px', color: T.textMuted, marginTop: '4px' }}>
                        {w.rarity} · P {w.req_power} / A {w.req_agility} / F {w.req_focus}
                      </div>
                    </button>
                  ))}
                </>
              )}
              {picker.kind === 'armor' && (
                <>
                  {armorForPicker.length === 0 && (
                    <p style={{ color: T.textMuted, fontFamily: "'EB Garamond', serif", fontSize: '14px' }}>No armor for this slot matches your filters.</p>
                  )}
                  {armorForPicker.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => pickArmor(a)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        background: T.surface, border: `1px solid ${T.border}`, borderRadius: '4px',
                        padding: '12px 14px', marginBottom: '8px', cursor: 'pointer', color: T.text,
                      }}
                    >
                      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: T.gold }}>{a.name}</div>
                      <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '12px', color: T.textMuted, marginTop: '4px' }}>
                        {a.rarity} · {parseFloat(a.mitigation_percent || '0')}% mit · Power {a.req_power}+
                      </div>
                    </button>
                  ))}
                </>
              )}
              {picker.kind === 'bracer' && (
                <>
                  {filteredBracers.length === 0 && (
                    <p style={{ color: T.textMuted, fontFamily: "'EB Garamond', serif", fontSize: '14px' }}>No bracers match your Focus.</p>
                  )}
                  {filteredBracers.map(b => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => pickBracer(b)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        background: T.surface, border: `1px solid ${T.border}`, borderRadius: '4px',
                        padding: '12px 14px', marginBottom: '8px', cursor: 'pointer', color: T.text,
                      }}
                    >
                      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', color: T.gold }}>{b.name}</div>
                      <div style={{ fontFamily: "'EB Garamond', serif", fontSize: '12px', color: T.textMuted, marginTop: '4px' }}>
                        {b.grade} · {b.gem_slots} gem slots · Focus {b.req_focus}+
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
            <div style={{ padding: '14px 20px', borderTop: `1px solid ${T.border}` }}>
              <button type="button" onClick={() => setPicker(null)} style={{ ...mkBtn(T.textMuted), width: '100%' }}>
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { SLOT_ROWS };
