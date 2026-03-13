/**
 * useVTTSocket.ts — Socket.io connection for the VTT
 *
 * Single shared socket per VTT session. All components read from
 * useVTTState (the state store) rather than subscribing to socket
 * events directly.
 *
 * Exposes typed emit helpers so components never touch the socket directly.
 */

import { useEffect, useRef, useCallback } from 'react';
import { io, type Socket }               from 'socket.io-client';
import { useAuthStore }                  from '@/store/authStore';
import { useVTTStore }                   from './useVTTState';
import type { DiceVisibility, ShapeType } from './types';

const SOCKET_URL = (import.meta as any).env.VITE_SOCKET_URL as string;

// ── Hook ───────────────────────────────────────────────────────────────────

export function useVTTSocket(sessionId: string | undefined, characterId?: string) {
  const socketRef = useRef<Socket | null>(null);
  const accessToken = useAuthStore(s => s.accessToken);
  const dispatch    = useVTTStore(s => s.dispatch);

  // ── Connect ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !accessToken) return;

    const socket = io(`${SOCKET_URL}/session`, {
      auth:          { token: accessToken },
      reconnection:  true,
      reconnectionAttempts: 10,
      reconnectionDelay:    1500,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[vtt] socket connected');
      dispatch({ type: 'SET_CONNECTED', connected: true });
      socket.emit('session:join', { session_id: sessionId, character_id: characterId });
    });

    socket.on('disconnect', () => {
      console.log('[vtt] socket disconnected');
      dispatch({ type: 'SET_CONNECTED', connected: false });
    });

    socket.on('connect_error', (err: Error) => {
      console.warn('[vtt] connection error:', err.message);
      dispatch({ type: 'SET_CONNECTED', connected: false });
    });

    // ── Inbound events ───────────────────────────────────────────────

    // Full state snapshot on join / reconnect
    socket.on('session:state', (data: any) => {
      dispatch({ type: 'HYDRATE', payload: data });
    });

    // DM pressed Start Session
    socket.on('session:started', ({ session }: any) => {
      dispatch({ type: 'SESSION_STARTED', session });
    });

    // DM switched the active map
    socket.on('session:map_changed', ({ map, tokens, shapes, fogCells, fogSections }: any) => {
      dispatch({ type: 'MAP_CHANGED', map, tokens, shapes, fogCells, fogSections: fogSections ?? [] });
    });

    // Session ended (inactivity or DM ended it)
    socket.on('session:ended', () => {
      dispatch({ type: 'SESSION_ENDED' });
    });

    // User joined / left
    socket.on('session:user_joined', (user: any) => {
      dispatch({ type: 'USER_JOINED', user });
    });
    socket.on('session:user_left', ({ user_id }: any) => {
      dispatch({ type: 'USER_LEFT', user_id });
    });

    // Token events
    socket.on('token:moved',   (data: any) => dispatch({ type: 'TOKEN_MOVED',   ...data }));
    socket.on('token:placed',  (token: any) => dispatch({ type: 'TOKEN_PLACED',  token }));
    socket.on('token:removed', ({ token_id }: any) => dispatch({ type: 'TOKEN_REMOVED', token_id }));

    // Enemy HP
    socket.on('enemy:hp_updated', (data: any) => dispatch({ type: 'ENEMY_HP_UPDATED', ...data }));

    // Fog cells
    socket.on('fog:updated', ({ cells }: any) => dispatch({ type: 'FOG_UPDATED', cells }));

    // Fog sections
    socket.on('fog_section:created', ({ section }: any) => dispatch({ type: 'FOG_SECTION_ADDED',   section }));
    socket.on('fog_section:updated', ({ section }: any) => dispatch({ type: 'FOG_SECTION_UPDATED', section }));
    socket.on('fog_section:deleted', ({ section_id }: any) => dispatch({ type: 'FOG_SECTION_REMOVED', section_id }));

    // Shapes
    socket.on('shape:added',     (shape: any) => dispatch({ type: 'SHAPE_ADDED',   shape }));
    socket.on('shape:removed',   ({ shape_id }: any) => dispatch({ type: 'SHAPE_REMOVED', shape_id }));
    socket.on('shape:all_cleared', () => dispatch({ type: 'SHAPES_CLEARED' }));

    // Ruler (local display only)
    socket.on('ruler:updated', (data: any) => dispatch({ type: 'RULER_UPDATED', ruler: data }));
    socket.on('ruler:cleared', ({ user_id }: any) => dispatch({ type: 'RULER_CLEARED', user_id }));

    // Dice
    socket.on('dice:result', (entry: any) => dispatch({ type: 'DICE_RESULT', entry }));

    return () => {
      socket.disconnect();
      socketRef.current = null;
      dispatch({ type: 'SET_CONNECTED', connected: false });
    };
  }, [sessionId, accessToken]);

  // ── Emit helpers ────────────────────────────────────────────────────

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  const startSession = useCallback(() => {
    emit('session:start');
  }, [emit]);

  const changeMap = useCallback((map_id: string) => {
    emit('session:map_change', { map_id });
  }, [emit]);

  const moveToken = useCallback((token_id: string, cell_x: number, cell_y: number) => {
    emit('token:move', { token_id, cell_x, cell_y });
  }, [emit]);

  const broadcastTokenPlaced = useCallback((token: unknown) => {
    emit('token:placed', token);
  }, [emit]);

  const broadcastTokenRemoved = useCallback((token_id: string) => {
    emit('token:removed', { token_id });
  }, [emit]);

  const updateEnemyHP = useCallback((instance_id: string, current_hp: number, is_defeated?: boolean) => {
    emit('enemy:hp_update', { instance_id, current_hp, is_defeated });
  }, [emit]);

  const updateFog = useCallback((cells: Array<{ x: number; y: number; revealed: boolean }>) => {
    emit('fog:update', { cells });
  }, [emit]);

  const addShape = useCallback((shape: unknown) => {
    emit('shape:add', shape);
  }, [emit]);

  const removeShape = useCallback((shape_id: string) => {
    emit('shape:remove', { shape_id });
  }, [emit]);

  const updateShape = useCallback((shape: unknown) => {
    emit('shape:update', shape);
  }, [emit]);

  const updateToken = useCallback((token: unknown) => {
    emit('token:update', token);
  }, [emit]);

  const clearAllShapes = useCallback(() => {
    emit('shape:clear_all');
  }, [emit]);

  const updateRuler = useCallback((start: { x: number; y: number }, end: { x: number; y: number }) => {
    emit('ruler:update', { start, end });
  }, [emit]);

  const clearRuler = useCallback(() => {
    emit('ruler:clear');
  }, [emit]);

  const rollDice = useCallback((payload: {
    formula:      string;
    label:        string;
    visibility:   DiceVisibility;
    results:      number[];
    total:        number;
    source_label?: string;
  }) => {
    emit('dice:roll', payload);
  }, [emit]);

  const rollAttack = useCallback((payload: {
    source_label:  string;
    formula:       string;
    results:       number[];
    total:         number;
    damage_type?:  string;
    visibility:    'public' | 'dm';
  }) => {
    emit('attack:rolled', payload);
  }, [emit]);

  return {
    startSession,
    changeMap,
    moveToken,
    broadcastTokenPlaced,
    broadcastTokenRemoved,
    updateEnemyHP,
    updateFog,
    addShape,
    removeShape,
    updateShape,
    updateToken,
    clearAllShapes,
    updateRuler,
    clearRuler,
    rollDice,
    rollAttack,
  };
}