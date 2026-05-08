/**
 * vtt/types.ts — Shared VTT types
 * Mirrors the backend schema types used across socket events and REST responses.
 */

// ── Session ────────────────────────────────────────────────────────────────

export interface VTTSession {
  id:               string;
  campaign_id:      string;
  name:             string;
  status:           'scheduled' | 'active' | 'paused' | 'ended';
  active_map_id:    string | null;
  is_started:       boolean;
  started_at:       string | null;
  ended_at:         string | null;
  last_activity_at: string;
}

// ── Map ────────────────────────────────────────────────────────────────────

export interface VTTMap {
  id:             string;
  campaign_id:    string;
  name:           string;
  image_url:      string;
  grid_cell_size: number;
  width_cells:    number;
  height_cells:   number;
  feet_per_cell:  number;  // feet each grid square represents (default 5)
  created_at:     string;
}

// ── Tokens ─────────────────────────────────────────────────────────────────

export interface MapToken {
  id:          string;
  session_id:  string;
  map_id:      string;
  entity_type: 'character' | 'enemy';
  entity_id:   string;
  cell_x:      number;
  cell_y:      number;
  label:       string | null;
  token_url:   string | null;
  scale:       number;       // visual scale multiplier, default 1.0
  is_hidden:   boolean;      // DM-only toggle; hidden tokens invisible to players
  group_id:    string | null; // tokens sharing group_id move together
  created_at:  string;
}

// ── Enemy Instances ────────────────────────────────────────────────────────

export interface EnemyInstance {
  id:          string;
  session_id:  string;
  enemy_id:    string;
  label:       string;
  current_hp:  number;   // bigint serialised as number by JSON
  max_hp:      number;
  is_defeated: boolean;
  created_at:  string;
}

// ── Fog ────────────────────────────────────────────────────────────────────

export interface FogCell {
  id:          string;
  map_id:      string;
  cell_x:      number;
  cell_y:      number;
  is_revealed: boolean;
}

// ── Fog Sections ───────────────────────────────────────────────────────────

export interface FogSection {
  id:         string;
  map_id:     string;
  name:       string;
  image_data: string | null;   // base64 PNG — pixel-precise fog for this layer
  is_hidden:  boolean;
  created_at: string;
}

// ── Canvas Shapes ──────────────────────────────────────────────────────────

export type ShapeType = 'marker' | 'circle' | 'rect' | 'line' | 'cone';

export interface CanvasShape {
  id:         string;
  session_id: string;
  map_id:     string;
  shape_type: ShapeType;
  color:      string;
  data:       Record<string, unknown>;
  created_by: string;
  created_at: string;
}

// ── Dice ───────────────────────────────────────────────────────────────────

export type DiceVisibility = 'public' | 'private' | 'dm';

export interface DiceLogEntry {
  id:           string;
  session_id:   string;
  roller_id:    string;
  source_label: string | null;
  formula:      string;
  results:      number[];
  total:        number;
  label:        string;
  visibility:   DiceVisibility;
  created_at:   string;
}

// Transient entry before it's persisted (from socket events)
export interface DiceResult {
  roller_id:    string;
  source_label: string | null;
  formula:      string;
  results:      number[];
  total:        number;
  label:        string;
  visibility:   DiceVisibility;
  /** Ephemeral: per-die faces for VTT / OBS sync visuals (not stored in DB). */
  animation_spec?: Array<{ sides: number; value: number }>;
  /** Ephemeral: dice-box style toss string for 3D replay (not stored in DB). */
  physics_notation?: string;
  /** Ephemeral: client-generated id to correlate `dice:roll_start` with `dice:result` (not in DB). */
  roll_id?: string;
  /** Ephemeral: echoed from `authority: 'server'` rolls for sheet / VTT UI (not stored in DB). */
  request_meta?: unknown;
}

export interface VTTRollRequestMeta {
  kind: 'vttQuickRoll' | 'vttPanelCrit' | 'vttPanelDmg';
  action: 'check' | 'attack' | 'damage' | 'custom' | 'crit' | 'damageChannel';
  character_id?: string;
  flow_id?: string;
  channel_idx?: number;
  channel_count?: number;
}

export interface VTTCharacterRollRequest {
  formula: string;
  label: string;
  visibility: DiceVisibility;
  source_label?: string;
  /** Applied after summing dice (weapon: stake; gem: stake × crit factor). */
  postMultiplier?: number;
  requestMeta?: VTTRollRequestMeta;
}

// ── Ruler ──────────────────────────────────────────────────────────────────

export interface RulerState {
  user_id: string;
  start:   { x: number; y: number };
  end:     { x: number; y: number };
}

// ── Connected Users ────────────────────────────────────────────────────────

export interface ConnectedUser {
  user_id:      string;
  character_id: string | null;
  is_dm:        boolean;
}

// ── VTT State Snapshot (from session:state) ───────────────────────────────

export interface VTTStateSnapshot {
  session:         VTTSession;
  activeMap:       VTTMap | null;
  tokens:          MapToken[];
  enemyInstances:  EnemyInstance[];
  shapes:          CanvasShape[];
  fogCells:        FogCell[];
  fogSections:     FogSection[];
  fogImage?:       string | null;
  diceLog:         DiceLogEntry[];
  campaignMaps:    VTTMap[];   // DM only
  isDM:            boolean;
}

// ── Tool Modes ─────────────────────────────────────────────────────────────

export type ToolMode =
  | 'select'
  | 'pan'
  | 'fog'           // active when a fog layer is selected; paint/erase on that layer
  | 'ruler'
  | 'marker'
  | 'circle'
  | 'rect'
  | 'line'
  | 'cone'
  | 'token_place';

export type FogBrushShape = 'circle' | 'square' | 'fill';
export type FogBrushMode  = 'paint' | 'erase';

// ── Enemy library type (from /library) ────────────────────────────────────

export interface EnemyAttack {
  name:        string;
  damage_dice: string;
  damage_type: string;
  description: string;
}

export interface EnemyTrait {
  name:               string;
  description:        string;
  mechanic_override?: string;
}

export interface EnemyStatBlock {
  id:             string;
  name:           string;
  classification: string;
  hp:             number;
  power:          number;
  agility:        number;
  focus:          number;
  presence:       number;
  base_rp:        number;
  attacks:        EnemyAttack[];
  traits:         EnemyTrait[];
  description:    string;
}