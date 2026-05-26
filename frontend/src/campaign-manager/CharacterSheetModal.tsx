import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import React from 'react';
import { useCharacter } from '@/hooks/useCharacter';
import _VelionCharacterSheet from '@/character-sheet/VelionCharacterSheet';
import { T } from './theme';

const VelionCharacterSheet = _VelionCharacterSheet as unknown as React.ComponentType<{
  characterId?: string;
  initialData?: import('@/hooks/useCharacter').CharacterDetail;
}>;

interface Props {
  characterId: string | null;
  characterName?: string;
  onClose: () => void;
}

export default function CharacterSheetModal({ characterId, characterName, onClose }: Props) {
  const { data: character, isLoading } = useCharacter(characterId ?? undefined);

  useEffect(() => {
    if (!characterId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [characterId, onClose]);

  if (!characterId || typeof document === 'undefined') return null;

  const title = characterName ?? character?.name ?? 'Character';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} character sheet`}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(1200px, 96vw)',
          height: 'min(92vh, 900px)',
          background: '#06070c',
          border: `1px solid ${T.border}`,
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: `1px solid ${T.border}`,
          background: T.surface, flexShrink: 0,
        }}>
          <div>
            <div style={{
              fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.22em',
              color: T.dmGold, marginBottom: '4px',
            }}>DM — PLAYER SHEET</div>
            <div style={{
              fontFamily: "'Cinzel',serif", fontSize: '18px', letterSpacing: '0.08em', color: T.text,
            }}>{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.16em',
              background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted,
              borderRadius: '3px', padding: '8px 14px', cursor: 'pointer',
            }}
          >
            CLOSE ✕
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {isLoading ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', fontFamily: "'Cinzel',serif", fontSize: '13px',
              letterSpacing: '0.2em', color: T.textDim,
            }}>LOADING SHEET…</div>
          ) : (
            <VelionCharacterSheet characterId={characterId} initialData={character ?? undefined} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
