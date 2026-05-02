/**
 * CharacterSheetPage.tsx
 *
 * Wraps VelionCharacterSheet.jsx and wires it to:
 *   - useCharacter hook for REST persistence
 *   - useCombatSync hook for live session WebSocket state
 *
 * Integration phases (SheetSpec Section 10):
 *   Phase 1 (current):  Sheet operates in standalone local-state mode.
 *                       useCharacter data is available but not yet wired into
 *                       the sheet's internal state (that's Phase 1 integration work).
 *   Phase 4:            useCombatSync drives HP/RP when isInCombat is true.
 *
 * The sheet works fully in local state right now. The hooks are imported and
 * ready — wiring them into VelionCharacterSheet.jsx internal state is the
 * next integration task.
 */

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useCharacter, type CharacterDetail } from '@/hooks/useCharacter';
import { useCombatSync }  from '@/hooks/useCombatSync';
import React from 'react';

// VelionCharacterSheet is a JSX file with no type exports.
// Declare the props here and cast the import so TS is satisfied.
import _VelionCharacterSheet from '@/character-sheet/VelionCharacterSheet';
const VelionCharacterSheetImpl = _VelionCharacterSheet as unknown as React.ComponentType<{
  characterId?: string;
  initialData?: CharacterDetail;
  sessionId?: string;
}>;

export default function CharacterSheetPage() {
  const { id }            = useParams<{ id: string }>();
  const [searchParams]    = useSearchParams();
  const querySessionId    = searchParams.get('session') ?? undefined;
  const [storedSessionId, setStoredSessionId] = useState<string | undefined>(() => localStorage.getItem('activeVttSessionId') ?? undefined);
  const sessionId         = querySessionId ?? storedSessionId;

  useEffect(() => {
    if (querySessionId) return;

    const syncFromStorage = () => {
      const next = localStorage.getItem('activeVttSessionId') ?? undefined;
      setStoredSessionId(next);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'activeVttSessionId') {
        syncFromStorage();
      }
    };

    const onFocus = () => {
      syncFromStorage();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [querySessionId]);

  // ── Data hooks ─────────────────────────────────────────────────────────
  const { data: character, isLoading } = useCharacter(id);

  // combatSync is a no-op when sessionId is undefined (standalone mode)
  const combatState = useCombatSync(sessionId, id);

  // ── Loading state ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 'calc(100vh - 52px)', background: '#06070c',
        fontFamily: "'Cinzel', serif", color: '#c4922a',
        fontSize: '11px', letterSpacing: '0.2em',
      }}>
        LOADING CHARACTER...
      </div>
    );
  }

  // ── Dev / no-backend fallback ───────────────────────────────────────────
  // In dev mode with no backend, character will be undefined.
  // The sheet renders in full local-state mode (no characterId prop).
  // Once the backend is connected, characterId + character data flow in.

  return (
    <div className="page-enter">
      <VelionCharacterSheetImpl
        key={id ?? 'local'}
        characterId={id ?? undefined}
        initialData={character ?? undefined}
        sessionId={sessionId}
      />

      {/* DEV: show integration status overlay */}
      {import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true' && (
        <div style={{
          position:   'fixed',
          bottom:     '16px',
          right:      '16px',
          background: '#0a0c14',
          border:     '1px solid #1c2030',
          borderRadius: '4px',
          padding:    '10px 14px',
          fontSize:   '11px',
          fontFamily: "'Cinzel', serif",
          color:      '#706858',
          letterSpacing: '0.08em',
          zIndex:     9999,
          maxWidth:   '240px',
        }}>
          <div style={{ color: '#c4922a', marginBottom: '6px', fontSize: '10px' }}>DEV · SHEET STATUS</div>
          <div>Character ID: <span style={{ color: '#e4d8c0' }}>{id ?? 'none (local)'}</span></div>
          <div>Session: <span style={{ color: '#e4d8c0' }}>{sessionId ?? 'standalone'}</span></div>
          <div>API data: <span style={{ color: character ? '#3dba6a' : '#e05050' }}>{character ? 'loaded' : 'not connected'}</span></div>
          <div>Combat: <span style={{ color: combatState.isInCombat ? '#4a9de8' : '#706858' }}>{combatState.isInCombat ? 'active' : 'inactive'}</span></div>
        </div>
      )}
    </div>
  );
}