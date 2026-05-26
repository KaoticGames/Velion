import type { CampaignMember } from '@/hooks/useCampaign';
import type { CampaignManagerEncounter, CampaignManagerLootItem } from '@/lib/campaignManager';
import { uid } from '@/lib/campaignManager';
import { T } from './theme';
import { SectionHead, SubHead, inputStyle } from './ui';

interface Props {
  encounters: CampaignManagerEncounter[];
  members: CampaignMember[];
  onChangeEncounters: (encounters: CampaignManagerEncounter[]) => void;
}

export default function LootSection({ encounters, members, onChangeEncounters }: Props) {
  const withChars = members.filter(m => m.character);

  const updateLoot = (encId: string, loot: CampaignManagerLootItem[]) => {
    onChangeEncounters(encounters.map(e => e.id === encId ? { ...e, loot, updatedAt: new Date().toISOString() } : e));
  };

  const addLoot = (encId: string) => {
    const enc = encounters.find(e => e.id === encId);
    if (!enc) return;
    updateLoot(encId, [...enc.loot, {
      id: uid(),
      name: 'New reward',
      kind: 'item',
      quantity: 1,
      assignedCharacterId: null,
    }]);
  };

  if (encounters.length === 0) {
    return (
      <div>
        <SectionHead title="Loot & Rewards" />
        <p style={{ fontSize: '15px', color: T.textMuted }}>Create encounters first to attach loot tables.</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHead title="Loot & Rewards" />
      <p style={{ fontSize: '15px', color: T.textMuted, lineHeight: 1.65, margin: '0 0 16px' }}>
        Per-encounter loot tables — gold, gems, items — and assign rewards to players when ready.
      </p>

      {encounters.map(enc => (
        <div key={enc.id} style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: '3px',
          padding: '16px', marginBottom: '14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <SubHead>{enc.name}</SubHead>
            <button
              type="button"
              onClick={() => addLoot(enc.id)}
              style={{
                fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.12em',
                background: 'transparent', border: `1px solid ${T.gold}`, color: T.gold,
                borderRadius: '2px', padding: '5px 12px', cursor: 'pointer',
              }}
            >+ ADD REWARD</button>
          </div>

          {enc.loot.length === 0 ? (
            <div style={{ fontSize: '13px', color: T.textDim }}>No loot defined</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Name', 'Type', 'Qty', 'Assign to', ''].map(h => (
                    <th key={h} style={{
                      fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.14em',
                      color: T.textDim, textAlign: 'left', padding: '6px 8px',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enc.loot.map(item => (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${T.border}33` }}>
                    <td style={{ padding: '6px 8px' }}>
                      <input
                        value={item.name}
                        onChange={e => updateLoot(enc.id, enc.loot.map(l =>
                          l.id === item.id ? { ...l, name: e.target.value } : l))}
                        style={{ ...inputStyle, padding: '6px 8px' }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <select
                        value={item.kind}
                        onChange={e => updateLoot(enc.id, enc.loot.map(l =>
                          l.id === item.id ? { ...l, kind: e.target.value as CampaignManagerLootItem['kind'] } : l))}
                        style={{ ...inputStyle, padding: '6px 8px' }}
                      >
                        <option value="item">Item</option>
                        <option value="gem">Gem</option>
                        <option value="gold">Gold</option>
                        <option value="other">Other</option>
                      </select>
                    </td>
                    <td style={{ padding: '6px 8px', width: '70px' }}>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={e => updateLoot(enc.id, enc.loot.map(l =>
                          l.id === item.id ? { ...l, quantity: parseInt(e.target.value, 10) || 1 } : l))}
                        style={{ ...inputStyle, padding: '6px 8px' }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <select
                        value={item.assignedCharacterId ?? ''}
                        onChange={e => updateLoot(enc.id, enc.loot.map(l =>
                          l.id === item.id ? { ...l, assignedCharacterId: e.target.value || null } : l))}
                        style={{ ...inputStyle, padding: '6px 8px' }}
                      >
                        <option value="">Unassigned</option>
                        {withChars.map(m => m.character && (
                          <option key={m.character.id} value={m.character.id}>{m.character.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <button
                        type="button"
                        onClick={() => updateLoot(enc.id, enc.loot.filter(l => l.id !== item.id))}
                        style={{ background: 'transparent', border: `1px solid ${T.hp}`, color: T.hp, borderRadius: '2px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
