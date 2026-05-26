/**
 * Campaign Manager state persisted in campaigns.settings.campaignManager
 */

import type { EncounterDifficulty } from './encounterPool';

export type ManagerSectionId =
  | 'party'
  | 'encounters'
  | 'sessions'
  | 'loot'
  | 'settings';

export interface CampaignManagerLootItem {
  id: string;
  name: string;
  kind: 'item' | 'gem' | 'gold' | 'other';
  quantity: number;
  notes?: string;
  assignedCharacterId?: string | null;
}

export interface CampaignManagerEncounterEnemy {
  id: string;
  libraryEnemyId?: string | null;
  label: string;
  classification: string;
  maxHp: number;
  currentHp: number;
  resistanceMod: number;
  weight: number;
  /** Snapshot when added from library */
  statSnapshot?: {
    name: string;
    attacks?: { name: string; damage_dice: string; damage_type: string }[];
    traits?: { name: string; description: string }[];
    power: number;
    agility: number;
    focus: number;
    presence: number;
  };
}

export interface CampaignManagerEncounter {
  id: string;
  name: string;
  difficulty: EncounterDifficulty;
  enemies: CampaignManagerEncounterEnemy[];
  poolTotal: number;
  poolRemaining: number;
  completed: boolean;
  notes?: string;
  loot: CampaignManagerLootItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CampaignManagerSession {
  id: string;
  title: string;
  plans: string;
  notes: string;
  completedEncounterIds: string[];
  status: 'planned' | 'played' | 'archived';
  playedAt?: string | null;
  createdAt: string;
}

export interface CampaignManagerState {
  version: 1;
  sessions: CampaignManagerSession[];
  encounters: CampaignManagerEncounter[];
  /** Campaign-wide plans (separate from dm_notes) */
  campaignPlans: string;
  activeEncounterId: string | null;
}

const EMPTY: CampaignManagerState = {
  version: 1,
  sessions: [],
  encounters: [],
  campaignPlans: '',
  activeEncounterId: null,
};

export function parseCampaignManager(settings: Record<string, unknown> | undefined): CampaignManagerState {
  const raw = settings?.campaignManager;
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const m = raw as Partial<CampaignManagerState>;
  return {
    version: 1,
    sessions: Array.isArray(m.sessions) ? m.sessions : [],
    encounters: Array.isArray(m.encounters) ? m.encounters : [],
    campaignPlans: typeof m.campaignPlans === 'string' ? m.campaignPlans : '',
    activeEncounterId: typeof m.activeEncounterId === 'string' ? m.activeEncounterId : null,
  };
}

export function mergeCampaignManagerSettings(
  settings: Record<string, unknown> | undefined,
  manager: CampaignManagerState,
): Record<string, unknown> {
  return { ...(settings ?? {}), campaignManager: manager };
}

export function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const MANAGER_SECTIONS: { id: ManagerSectionId; label: string }[] = [
  { id: 'party',      label: 'Party Overview' },
  { id: 'encounters', label: 'Enemies & Encounters' },
  { id: 'sessions',   label: 'Sessions' },
  { id: 'loot',       label: 'Loot & Rewards' },
  { id: 'settings',   label: 'Campaign Settings' },
];
