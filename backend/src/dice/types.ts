import type * as THREE from 'three';

export type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export type FaceMap = Record<number, THREE.Quaternion>;

export type DiceQuaternionMap = Record<DieType, FaceMap>;

export interface DiceAnimationFace {
  sides: number;
  value: number;
}

export interface DieRollInstruction {
  dieType: DieType;
  result: number;
}

export interface DiceLogEntry {
  rollId: string;
  dieType: DieType;
  result: number;
  modifier: number;
  total: number;
  roller: string;
  label: string;
  timestamp: number;
}

export const DIE_TYPES: DieType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

export const DICE_ASSET_BASE = '/assets/dice';

export function sidesToDieType(sides: number): DieType | null {
  switch (sides) {
    case 4: return 'd4';
    case 6: return 'd6';
    case 8: return 'd8';
    case 10: return 'd10';
    case 12: return 'd12';
    case 20: return 'd20';
    case 100: return 'd100';
    default: return null;
  }
}

/** Maps a server result value to the face-map key used in GLB naming. */
export function resultToFaceKey(dieType: DieType, result: number): number {
  if (dieType === 'd100') {
    if (result === 100) return 0;
    return Math.floor(result / 10) * 10;
  }
  if (dieType === 'd10') return result === 10 ? 0 : result;
  return result;
}

/** Maps a `{dieType}_face_n` marker key to the numeric roll shown to the player. */
export function faceKeyToRollValue(dieType: DieType, faceKey: number): number {
  if (dieType === 'd100') return faceKey === 0 ? 100 : faceKey;
  if (dieType === 'd10') return faceKey === 0 ? 10 : faceKey;
  return faceKey;
}

export function animationSpecToInstructions(spec: DiceAnimationFace[]): DieRollInstruction[] {
  const out: DieRollInstruction[] = [];
  for (const face of spec) {
    const dieType = sidesToDieType(face.sides);
    if (!dieType || !Number.isFinite(face.value)) continue;
    out.push({ dieType, result: face.value });
  }
  return out;
}
