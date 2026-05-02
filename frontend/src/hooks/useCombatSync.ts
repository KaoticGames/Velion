/**
 * useCombatSync.ts — WebSocket combat state synchronisation.
 *
 * Subscribes to Socket.io events when inside a live session.
 * Returns live combat values that override the character's persisted state.
 *
 * SheetSpec Section 5: the sheet does not create its own socket connection —
 * it subscribes to events from a shared connection established when the VTT
 * screen mounts. This hook manages that shared connection.
 *
 * When sessionId is undefined, the hook is a no-op (standalone mode).
 */

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/authStore';
import { isSocketSessionAuthFailure, kickToLogin } from '@/lib/authSession';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL as string;

// ── Types ──────────────────────────────────────────────────────────────────

export interface CombatState {
  isInCombat:   boolean;
  combatHP:     number | null;
  combatRP:     number | null;
  bankedRP:     number | null;
  activeStates: Set<string>;
}

const DEFAULT_STATE: CombatState = {
  isInCombat:   false,
  combatHP:     null,
  combatRP:     null,
  bankedRP:     null,
  activeStates: new Set(),
};

// ── Hook ───────────────────────────────────────────────────────────────────

export function useCombatSync(
  sessionId:   string | undefined,
  characterId: string | undefined,
  participantId?: string,
): CombatState {
  const accessToken = useAuthStore((s) => s.accessToken);
  const socketRef   = useRef<Socket | null>(null);
  const [state, setState] = useState<CombatState>(DEFAULT_STATE);

  useEffect(() => {
    // No-op in standalone mode (no sessionId) or when not authenticated
    if (!sessionId || !accessToken) return;

    // Connect to Socket.io namespace /session
    const socket = io(`${SOCKET_URL}/session`, {
      auth:             { token: accessToken },
      transports:       ['websocket', 'polling'],
      reconnection:     true,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect_error', (err: Error) => {
      if (isSocketSessionAuthFailure(err)) {
        kickToLogin();
      }
    });

    // Join the session room
    socket.emit('session:join', { session_id: sessionId, character_id: characterId });

    // ── State snapshot on connect/reconnect ────────────────────────────
    socket.on('session:state', (payload: {
      encounter?: { status: string };
      participants: Array<{
        character_id: string;
        current_hp:   number;
        current_rp:   number;
        banked_rp:    number;
        states:       string[];
      }>;
    }) => {
      const me = payload.participants?.find((p) => p.character_id === characterId);
      if (!me) return;

      setState({
        isInCombat:   payload.encounter?.status === 'active',
        combatHP:     me.current_hp,
        combatRP:     me.current_rp,
        bankedRP:     me.banked_rp,
        activeStates: new Set(me.states ?? []),
      });
    });

    // ── HP events ──────────────────────────────────────────────────────
    socket.on('hp:updated', (p: { participant_id: string; current_hp: number }) => {
      if (p.participant_id !== participantId) return;
      setState((prev) => ({ ...prev, combatHP: p.current_hp }));
    });

    socket.on('hp:downed', (p: { participant_id: string }) => {
      if (p.participant_id !== participantId) return;
      setState((prev) => ({ ...prev, combatHP: 0 }));
    });

    socket.on('hp:revived', (p: { participant_id: string; current_hp: number }) => {
      if (p.participant_id !== participantId) return;
      setState((prev) => ({ ...prev, combatHP: p.current_hp }));
    });

    // ── RP events ──────────────────────────────────────────────────────
    socket.on('rp:spent', (p: { participant_id: string; current_rp: number }) => {
      if (p.participant_id !== participantId) return;
      setState((prev) => ({ ...prev, combatRP: p.current_rp }));
    });

    socket.on('turn:start', (p: {
      participant_id: string;
      rp_reset:       number;
      banked_rp:      number;
    }) => {
      if (p.participant_id !== participantId) return;
      setState((prev) => ({
        ...prev,
        combatRP: p.rp_reset + p.banked_rp,
        bankedRP: 0,
      }));
    });

    socket.on('turn:end', (p: { participant_id: string; banked_rp: number }) => {
      if (p.participant_id !== participantId) return;
      setState((prev) => ({ ...prev, bankedRP: p.banked_rp }));
    });

    // ── State events ───────────────────────────────────────────────────
    socket.on('state:applied', (p: { participant_id: string; state_name: string }) => {
      if (p.participant_id !== participantId) return;
      setState((prev) => {
        const next = new Set(prev.activeStates);
        next.add(p.state_name);
        return { ...prev, activeStates: next };
      });
    });

    socket.on('state:removed', (p: { participant_id: string; state_name: string }) => {
      if (p.participant_id !== participantId) return;
      setState((prev) => {
        const next = new Set(prev.activeStates);
        next.delete(p.state_name);
        return { ...prev, activeStates: next };
      });
    });

    // ── Encounter lifecycle ────────────────────────────────────────────
    socket.on('encounter:start', () => {
      setState((prev) => ({ ...prev, isInCombat: true }));
    });

    socket.on('encounter:end', () => {
      setState(DEFAULT_STATE);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setState(DEFAULT_STATE);
    };
  }, [sessionId, characterId, participantId, accessToken]);

  return state;
}
