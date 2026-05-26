/**
 * Seeded spawn layout shared by Rapier headless sim and visual roll.
 * Same seed + same aspect → same initial positions, velocities, and spins.
 */

import * as THREE from 'three';
import type { DieType } from './types';

export const TABLE_Y = 0.15;
export const CAMERA_HEIGHT = 17;
export const CAMERA_AHEAD = 0.75;
/** Horizontal inset for invisible arena walls (matches legacy dice animator). */
export const WALL_INSET = 1.3;

export function getDiceViewportAspect(): number {
  if (typeof document !== 'undefined') {
    const host = document.getElementById('global-dice-canvas-host');
    if (host && host.clientHeight > 0) return host.clientWidth / host.clientHeight;
  }
  if (typeof window !== 'undefined' && window.innerHeight > 0) {
    return window.innerWidth / window.innerHeight;
  }
  return 16 / 9;
}

export const DIE_RNG_SALT = 0x9e3779b9;

export interface PlayBounds {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export interface DieSpawnState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  initialRotation: THREE.Quaternion;
}

export function createPRNG(seed: number): () => number {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngBetween(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function insetPlayBounds(b: PlayBounds, inset: number): PlayBounds {
  return {
    xMin: b.xMin + inset,
    xMax: b.xMax - inset,
    zMin: b.zMin + inset,
    zMax: b.zMax - inset,
  };
}

function randomEdgePoint(rng: () => number, b: PlayBounds): { x: number; z: number } {
  switch (Math.floor(rng() * 4)) {
    case 0: return { x: b.xMin, z: rngBetween(rng, b.zMin, b.zMax) };
    case 1: return { x: b.xMax, z: rngBetween(rng, b.zMin, b.zMax) };
    case 2: return { x: rngBetween(rng, b.xMin, b.xMax), z: b.zMin };
    default: return { x: rngBetween(rng, b.xMin, b.xMax), z: b.zMax };
  }
}

/**
 * Orthographic frustum half-extents for the visual overlay camera.
 * Fits the Rapier play rectangle (XZ) into the viewport with padding.
 */
export function computeOverlayFrustum(aspectRatio = 16 / 9): { halfW: number; halfH: number } {
  const b = insetPlayBounds(computePlayBounds(aspectRatio), WALL_INSET);
  const pad = 0.85;
  let halfW = (b.xMax - b.xMin) * 0.5 + pad;
  let halfH = (b.zMax - b.zMin) * 0.5 + pad;
  if (halfW / halfH > aspectRatio) {
    halfH = halfW / aspectRatio;
  } else {
    halfW = halfH * aspectRatio;
  }
  return { halfW, halfH };
}

/** Viewport-projected play rectangle (XZ), same framing as the legacy perspective camera. */
export function computePlayBounds(aspectRatio = 16 / 9): PlayBounds {
  const height = CAMERA_HEIGHT - TABLE_Y;
  const vHalf = height * Math.tan(((38 / 2) * Math.PI) / 180);
  const hHalf = vHalf * aspectRatio;
  const inset = 0.5;
  return {
    xMin: -(hHalf - inset),
    xMax: hHalf - inset,
    zMin: -(vHalf - inset),
    zMax: vHalf - inset,
  };
}

/** Extra launch spin for sharp-edged dice that otherwise skid instead of tumbling. */
const LAUNCH_TUMBLE: Partial<
  Record<DieType, { angularMult: number; angularMin: number; angularMax: number; velocityMult: number }>
> = {
  d4: { angularMult: 1.65, angularMin: 11, angularMax: 22, velocityMult: 1.06 },
  d6: { angularMult: 1.35, angularMin: 9, angularMax: 19, velocityMult: 1.04 },
  d8: { angularMult: 1.22, angularMin: 9, angularMax: 18, velocityMult: 1.03 },
};

function launchTumbleFor(dieType: DieType) {
  return LAUNCH_TUMBLE[dieType] ?? { angularMult: 1, angularMin: 8, angularMax: 15, velocityMult: 1 };
}

export function layoutSpawn(
  index: number,
  total: number,
  bounds: PlayBounds,
  rng: () => number,
): { position: THREE.Vector3; velocity: THREE.Vector3; horizDist: number } {
  const widthX = bounds.xMax - bounds.xMin;
  const depthZ = bounds.zMax - bounds.zMin;
  const tableSpan = Math.min(widthX, depthZ);
  const spread = total <= 1 ? 0 : (index - (total - 1) / 2) * tableSpan * 0.1;

  const landX = THREE.MathUtils.clamp(
    rngBetween(rng, bounds.xMin, bounds.xMax) + spread,
    bounds.xMin,
    bounds.xMax,
  );
  const landZ = THREE.MathUtils.clamp(
    rngBetween(rng, bounds.zMin, bounds.zMax),
    bounds.zMin,
    bounds.zMax,
  );

  let spawn = rng() < 0.78
    ? randomEdgePoint(rng, bounds)
    : { x: rngBetween(rng, bounds.xMin, bounds.xMax), z: rngBetween(rng, bounds.zMin, bounds.zMax) };

  let dx = landX - spawn.x;
  let dz = landZ - spawn.z;
  let horizDist = Math.hypot(dx, dz);

  if (horizDist < tableSpan * 0.52) {
    const cx = (bounds.xMin + bounds.xMax) / 2;
    const cz = (bounds.zMin + bounds.zMax) / 2;
    spawn = { x: landX >= cx ? bounds.xMin : bounds.xMax, z: landZ >= cz ? bounds.zMin : bounds.zMax };
    dx = landX - spawn.x;
    dz = landZ - spawn.z;
    horizDist = Math.hypot(dx, dz) || tableSpan * 0.52;
  }
  horizDist = Math.max(horizDist, 1);
  const horizScale = THREE.MathUtils.clamp(horizDist * 0.85, 8, 18);

  return {
    position: new THREE.Vector3(spawn.x, rngBetween(rng, 3.0, 5.0), spawn.z),
    velocity: new THREE.Vector3(
      (dx / horizDist) * horizScale * rngBetween(rng, 0.9, 1.1) + rngBetween(rng, -1.5, 1.5),
      rngBetween(rng, -4, -7),
      (dz / horizDist) * horizScale * rngBetween(rng, 0.9, 1.1) + rngBetween(rng, -1.5, 1.5),
    ),
    horizDist,
  };
}

export function createDieSpawnStates(
  seed: number,
  dieTypes: DieType[],
  aspectRatio: number,
): DieSpawnState[] {
  const masterRng = createPRNG(seed);
  const bounds = insetPlayBounds(computePlayBounds(aspectRatio), WALL_INSET);

  return dieTypes.map((dieType, index) => {
    const tumble = launchTumbleFor(dieType);
    const { position, velocity, horizDist } = layoutSpawn(index, dieTypes.length, bounds, masterRng);
    velocity.multiplyScalar(tumble.velocityMult);
    const angularSpeed =
      THREE.MathUtils.clamp(horizDist * 0.9, tumble.angularMin, tumble.angularMax) *
      rngBetween(masterRng, 0.85, 1.15) *
      tumble.angularMult;
    const angularVelocity = new THREE.Vector3(
      rngBetween(masterRng, -1, 1),
      rngBetween(masterRng, -1, 1) * (dieType === 'd4' ? 1.35 : dieType === 'd6' || dieType === 'd8' ? 1.2 : 1),
      rngBetween(masterRng, -1, 1),
    )
      .normalize()
      .multiplyScalar(angularSpeed);
    const euler = new THREE.Euler(
      rngBetween(masterRng, 0, Math.PI * 2),
      rngBetween(masterRng, 0, Math.PI * 2),
      rngBetween(masterRng, 0, Math.PI * 2),
    );
    const initialRotation = new THREE.Quaternion().setFromEuler(euler);
    return { position, velocity, angularVelocity, initialRotation };
  });
}
