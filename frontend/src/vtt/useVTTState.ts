/**
 * useVTTState.ts — Client-side VTT state store (Zustand)
 *
 * Single source of truth for everything the VTT renders.
 * Hydrated by the session:state socket event on connect.
 * Updated by all subsequent socket events via dispatch().
 *
 * Components read from this store. The socket hook writes to it.
 * No component subscribes to socket events directly.
 */

import { create }      from 'zustand';
import type {
  VTTSession, VTTMap, MapToken, EnemyInstance, FogCell, FogSection,
  CanvasShape, DiceLogEntry, DiceResult, ConnectedUser, RulerState,
  VTTStateSnapshot, ToolMode, FogBrushShape,
} from './types';

// ── Action types ───────────────────────────────────────────────────────────

export type Action =
  | { type: 'HYDRATE';           payload: VTTStateSnapshot }
  | { type: 'SET_CONNECTED';     connected: boolean }
  | { type: 'SESSION_STARTED';   session: VTTSession }
  | { type: 'SESSION_ENDED' }
  | { type: 'MAP_CHANGED';       map: VTTMap; tokens: MapToken[]; shapes: CanvasShape[]; fogCells: FogCell[]; fogSections: FogSection[] }
  | { type: 'USER_JOINED';       user: ConnectedUser }
  | { type: 'USER_LEFT';         user_id: string }
  | { type: 'TOKEN_PLACED';      token: MapToken }
  | { type: 'TOKEN_MOVED';       token_id: string; cell_x: number; cell_y: number }
  | { type: 'TOKEN_UPDATED';     token: MapToken }
  | { type: 'TOKEN_REMOVED';     token_id: string }
  | { type: 'ENEMY_HP_UPDATED';  instance_id: string; current_hp: number; is_defeated?: boolean }
  | { type: 'FOG_UPDATED';       cells: Array<{ x: number; y: number; revealed: boolean }> }
  | { type: 'FOG_SECTION_ADDED';    section: FogSection }
  | { type: 'FOG_SECTION_UPDATED';  section: FogSection }
  | { type: 'FOG_SECTION_REMOVED';  section_id: string }
  | { type: 'SHAPE_ADDED';       shape: CanvasShape }
  | { type: 'SHAPE_UPDATED';     shape: CanvasShape }
  | { type: 'SHAPE_REMOVED';     shape_id: string }
  | { type: 'SHAPES_CLEARED' }
  | { type: 'RULER_UPDATED';     ruler: RulerState }
  | { type: 'RULER_CLEARED';     user_id: string }
  | { type: 'DICE_RESULT';       entry: DiceResult }
  | { type: 'SET_TOOL';          tool: ToolMode }
  | { type: 'SET_TOOL_COLOR';    color: string }
  | { type: 'SET_FOG_BRUSH_SIZE';  size: number }
  | { type: 'SET_FOG_BRUSH_SHAPE'; shape: FogBrushShape }
  | { type: 'SET_DICE_VISIBILITY'; visibility: 'public' | 'private' | 'dm' }
  | { type: 'CLEAR_DICE_LOG' };

// ── State shape ────────────────────────────────────────────────────────────

interface VTTState {
  // Connection
  connected:      boolean;
  sessionEnded:   boolean;

  // Session
  session:        VTTSession | null;
  isDM:           boolean;

  // Map
  activeMap:      VTTMap | null;
  campaignMaps:   VTTMap[];

  // Canvas data
  tokens:         MapToken[];
  enemyInstances: EnemyInstance[];
  fogCells:       Map<string, boolean>;   // key: "x,y" → is_revealed
  shapes:         CanvasShape[];
  fogSections:    FogSection[];

  // Rulers (keyed by user_id — each user has one active ruler)
  rulers:         Map<string, RulerState>;

  // Dice
  diceLog:        DiceLogEntry[];
  diceVisibility: 'public' | 'private' | 'dm';

  // Connected users
  connectedUsers: ConnectedUser[];

  // Tool state (DM)
  activeTool:      ToolMode;
  toolColor:       string;
  fogBrushSize:    number;   // radius in cells
  fogBrushShape:   FogBrushShape;

  // Dispatch
  dispatch: (action: Action) => void;
}

// ── Fog helpers ────────────────────────────────────────────────────────────

const fogKey = (x: number, y: number) => `${x},${y}`;

const buildFogMap = (cells: FogCell[]): Map<string, boolean> => {
  const m = new Map<string, boolean>();
  for (const c of cells) m.set(fogKey(c.cell_x, c.cell_y), c.is_revealed);
  return m;
};

// ── Reducer ────────────────────────────────────────────────────────────────

function reducer(state: VTTState, action: Action): Partial<VTTState> {
  switch (action.type) {

    case 'HYDRATE': {
      const { payload } = action;
      return {
        session:        payload.session,
        isDM:           payload.isDM,
        activeMap:      payload.activeMap,
        tokens:         payload.tokens,
        enemyInstances: payload.enemyInstances,
        fogCells:       buildFogMap(payload.fogCells),
        fogSections:    payload.fogSections ?? [],
        shapes:         payload.shapes,
        campaignMaps:   payload.campaignMaps,
        diceLog:        payload.diceLog,
        sessionEnded:   payload.session.status === 'ended',
        connected:      true,
      };
    }

    case 'SET_CONNECTED':
      return { connected: action.connected };

    case 'SESSION_STARTED':
      return { session: action.session };

    case 'SESSION_ENDED':
      return { sessionEnded: true };

    case 'MAP_CHANGED':
      return {
        activeMap:   action.map,
        tokens:      action.tokens,
        shapes:      action.shapes,
        fogCells:    buildFogMap(action.fogCells),
        fogSections: action.fogSections ?? [],
        rulers:      new Map(),
      };

    case 'USER_JOINED': {
      const users = [...state.connectedUsers.filter(u => u.user_id !== action.user.user_id), action.user];
      return { connectedUsers: users };
    }

    case 'USER_LEFT':
      return { connectedUsers: state.connectedUsers.filter(u => u.user_id !== action.user_id) };

    case 'TOKEN_PLACED':
      return { tokens: [...state.tokens, action.token] };

    case 'TOKEN_MOVED':
      return {
        tokens: state.tokens.map(t =>
          t.id === action.token_id ? { ...t, cell_x: action.cell_x, cell_y: action.cell_y } : t
        ),
      };

    case 'TOKEN_UPDATED':
      return {
        tokens: state.tokens.map(t => t.id === action.token.id ? action.token : t),
      };

    case 'TOKEN_REMOVED':
      return { tokens: state.tokens.filter(t => t.id !== action.token_id) };

    case 'ENEMY_HP_UPDATED':
      return {
        enemyInstances: state.enemyInstances.map(e =>
          e.id === action.instance_id
            ? { ...e, current_hp: action.current_hp, ...(action.is_defeated !== undefined ? { is_defeated: action.is_defeated } : {}) }
            : e
        ),
      };

    case 'FOG_UPDATED': {
      const fog = new Map(state.fogCells);
      for (const cell of action.cells) fog.set(fogKey(cell.x, cell.y), cell.revealed);
      return { fogCells: fog };
    }

    case 'FOG_SECTION_ADDED':
      return { fogSections: [...state.fogSections, action.section] };

    case 'FOG_SECTION_UPDATED':
      return { fogSections: state.fogSections.map(s => s.id === action.section.id ? action.section : s) };

    case 'FOG_SECTION_REMOVED':
      return { fogSections: state.fogSections.filter(s => s.id !== action.section_id) };

    case 'SHAPE_ADDED':
      return { shapes: [...state.shapes, action.shape] };

    case 'SHAPE_UPDATED':
      return { shapes: state.shapes.map(s => s.id === action.shape.id ? action.shape : s) };

    case 'SHAPE_REMOVED':
      return { shapes: state.shapes.filter(s => s.id !== action.shape_id) };

    case 'SHAPES_CLEARED':
      return { shapes: [] };

    case 'RULER_UPDATED': {
      const rulers = new Map(state.rulers);
      rulers.set(action.ruler.user_id, action.ruler);
      return { rulers };
    }

    case 'RULER_CLEARED': {
      const rulers = new Map(state.rulers);
      rulers.delete(action.user_id);
      return { rulers };
    }

    case 'DICE_RESULT': {
      // Prepend to log (newest first)
      const entry = action.entry as unknown as DiceLogEntry;
      return { diceLog: [entry, ...state.diceLog].slice(0, 200) };
    }

    case 'CLEAR_DICE_LOG':
      return { diceLog: [] };

    case 'SET_TOOL':
      return { activeTool: action.tool };

    case 'SET_TOOL_COLOR':
      return { toolColor: action.color };

    case 'SET_FOG_BRUSH_SIZE':
      return { fogBrushSize: action.size };

    case 'SET_FOG_BRUSH_SHAPE':
      return { fogBrushShape: action.shape };

    case 'SET_DICE_VISIBILITY':
      return { diceVisibility: action.visibility };

    default:
      return {};
  }
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useVTTStore = create<VTTState>((set, get) => ({
  connected:      false,
  sessionEnded:   false,
  session:        null,
  isDM:           false,
  activeMap:      null,
  campaignMaps:   [],
  tokens:         [],
  enemyInstances: [],
  fogCells:       new Map(),
  fogSections:    [],
  shapes:         [],
  rulers:         new Map(),
  diceLog:        [],
  diceVisibility: 'public',
  connectedUsers: [],
  activeTool:     'select',
  toolColor:      '#ff4444',
  fogBrushSize:   1,
  fogBrushShape:  'circle',

  dispatch: (action: Action) => {
    set(state => ({ ...state, ...reducer(state, action) }));
  },
}));

// ── Selectors ─────────────────────────────────────────────────────────────

/** Is a given fog cell revealed? Default true (revealed) — no DB entry means not fogged */
export const selectFogRevealed = (fogCells: Map<string, boolean>, x: number, y: number): boolean =>
  fogCells.get(fogKey(x, y)) ?? true;

/** Token for a given entity */
export const selectTokenForEntity = (tokens: MapToken[], entityId: string): MapToken | undefined =>
  tokens.find(t => t.entity_id === entityId);

/** Enemy instance by id */
export const selectEnemyInstance = (instances: EnemyInstance[], id: string): EnemyInstance | undefined =>
  instances.find(e => e.id === id);