import { useState } from 'react';
import type { CampaignMember } from '@/hooks/useCampaign';
import { T, ATTR_COLOR, cap, fmt } from './theme';
import { SectionHead } from './ui';
import CharacterSheetModal from './CharacterSheetModal';

function CharacterTile({
  member,
  onOpen,
}: {
  member: CampaignMember;
  onOpen: (characterId: string, name: string) => void;
}) {
  const { character } = member;
  if (!character) return null;

  const ac = ATTR_COLOR[character.chosen_attribute] ?? T.gold;
  const hpPct = character.max_hp > 0
    ? Math.min(100, (Number(character.current_hp) / Number(character.max_hp)) * 100)
    : 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(character.id, character.name)}
      style={{
        textAlign: 'left',
        width: '100%',
        background: T.card,
        border: `1px solid ${T.border}`,
        borderTop: `2px solid ${ac}`,
        borderRadius: '3px',
        padding: '12px',
        overflow: 'hidden',
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        cursor: 'pointer',
        color: 'inherit',
        transition: 'border-color 0.12s, box-shadow 0.12s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = T.gold + '88';
        e.currentTarget.style.boxShadow = `0 4px 16px ${T.gold}22`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = T.border;
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{
        width: 44,
        height: 44,
        borderRadius: '3px',
        flexShrink: 0,
        background: T.surface,
        border: `1px solid ${ac}44`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {character.portrait_url
          ? <img src={character.portrait_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ color: ac, opacity: 0.45 }}>⚔</span>}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '15px',
              fontWeight: 700,
              color: T.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {character.name}
            </div>
            <div style={{ fontSize: '12px', color: ac, marginTop: '2px' }}>
              ⟡ {cap(character.chosen_attribute)}
            </div>
          </div>
          <div style={{
            fontFamily: "'Cinzel',serif",
            fontSize: '12px',
            letterSpacing: '0.14em',
            color: T.gold,
            background: T.goldFaint,
            border: `1px solid ${T.goldDim}`,
            borderRadius: '2px',
            padding: '3px 7px',
            flexShrink: 0,
          }}>
            LV {character.level}
          </div>
        </div>

        <div style={{ marginTop: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: T.textDim }}>
            <span style={{ color: T.hp }}>❤ {fmt(Number(character.current_hp))}/{fmt(Number(character.max_hp))}</span>
            <span style={{ color: T.rp }}>⚡ {character.base_rp}</span>
          </div>
          <div style={{ height: 4, background: T.border, borderRadius: 2, marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ width: `${hpPct}%`, height: '100%', background: T.hp, transition: 'width 0.2s' }} />
          </div>
        </div>
      </div>
    </button>
  );
}

export default function PartyOverviewSection({ members }: { members: CampaignMember[] }) {
  const withChars = members.filter(m => m.character);
  const [sheetTarget, setSheetTarget] = useState<{ id: string; name: string } | null>(null);

  return (
    <div>
      <SectionHead title="Party Overview" />
      <p style={{ fontSize: '15px', color: T.textMuted, lineHeight: 1.65, margin: '0 0 20px' }}>
        Click a tile to open and edit that player&apos;s character sheet.
      </p>

      {withChars.length === 0 ? (
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px',
          padding: '32px', textAlign: 'center', color: T.textDim,
          fontFamily: "'Cinzel',serif", letterSpacing: '0.14em', fontSize: '13px',
        }}>NO CHARACTERS ENROLLED</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '10px',
        }}>
          {withChars.map((member) => (
            <CharacterTile
              key={member.character!.id}
              member={member}
              onOpen={(id, name) => setSheetTarget({ id, name })}
            />
          ))}
        </div>
      )}

      <CharacterSheetModal
        characterId={sheetTarget?.id ?? null}
        characterName={sheetTarget?.name}
        onClose={() => setSheetTarget(null)}
      />
    </div>
  );
}
