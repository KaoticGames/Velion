/**
 * Rapier-backed dice: rigid-body physics; seed only sets initial pose and velocities.
 * Same seed + same scene build + same fixed dt → same motion and readable face everywhere.
 */

import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import {
  computePlayBounds,
  createDieSpawnStates,
  insetPlayBounds,
  TABLE_Y,
  WALL_INSET as SPAWN_WALL_INSET,
} from './diceSpawn';
import { determineLandingFaceKey } from './diceFaceRead';
import { getFaceMap, getHullVertices } from './diceLoader';
import {
  faceKeyToRollValue,
  type DiceAnimationFace,
  type DieType,
} from './types';

const SIM_DT = 1 / 120;
const SIM_MAX_STEPS = 120 * 30;
const MIN_STEPS_BEFORE_SETTLE = 120 * 2;
const GRAVITY_Y = -28;

let rapierInitPromise: Promise<void> | null = null;

/** Must be awaited before any Rapier API (including `new World`). */
export function ensureRapierPhysics(): Promise<void> {
  if (!rapierInitPromise) rapierInitPromise = RAPIER.init();
  return rapierInitPromise;
}

function makeColliderForDie(verts: Float32Array): RAPIER.ColliderDesc {
  if (verts.length < 12) {
    return RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4)
      .setDensity(2.2)
      .setFriction(0.55)
      .setRestitution(0.28);
  }
  const copy = new Float32Array(verts);
  let desc = RAPIER.ColliderDesc.convexHull(copy);
  if (!desc) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i]!;
      const y = verts[i + 1]!;
      const z = verts[i + 2]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    const hx = Math.max(0.05, (maxX - minX) * 0.5);
    const hy = Math.max(0.05, (maxY - minY) * 0.5);
    const hz = Math.max(0.05, (maxZ - minZ) * 0.5);
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
  }
  return desc
    .setDensity(2.2)
    .setFriction(0.72)
    .setRestitution(0.18);
}

function addArena(world: RAPIER.World, xMin: number, xMax: number, zMin: number, zMax: number): void {
  const t = 0.35;
  const yCenter = TABLE_Y + 1.2;
  const hSpan = (xMax - xMin) * 0.5 + t;
  const dSpan = (zMax - zMin) * 0.5 + t;
  const cx = (xMin + xMax) * 0.5;
  const cz = (zMin + zMax) * 0.5;

  const ground = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, TABLE_Y - 0.12, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(80, 0.12, 80).setFriction(0.78).setRestitution(0.12),
    ground,
  );

  const mkWall = (x: number, z: number, hx: number, hz: number) => {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, yCenter, z));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, 2.2, hz).setFriction(0.45).setRestitution(0.35),
      b,
    );
  };

  mkWall(cx, zMax + t, hSpan, t);
  mkWall(cx, zMin - t, hSpan, t);
  mkWall(xMin - t, cz, t, dSpan);
  mkWall(xMax + t, cz, t, dSpan);
}

export interface RapierDiceWorldContext {
  world: RAPIER.World;
  bodies: RAPIER.RigidBody[];
  dieTypes: DieType[];
}

function arenaBoundsFromAspect(aspectRatio: number) {
  return insetPlayBounds(computePlayBounds(aspectRatio), SPAWN_WALL_INSET);
}

/**
 * Build a fresh Rapier world: floor, walls, one dynamic convex die per entry in `dieTypes`.
 */
export function createRapierDiceWorld(
  seed: number,
  dieTypes: DieType[],
  aspectRatio: number,
): RapierDiceWorldContext {
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  world.timestep = SIM_DT;
  world.numSolverIterations = 10;

  const wallBounds = arenaBoundsFromAspect(aspectRatio);
  addArena(world, wallBounds.xMin, wallBounds.xMax, wallBounds.zMin, wallBounds.zMax);

  const spawnStates = createDieSpawnStates(seed, dieTypes, aspectRatio);
  const bodies: RAPIER.RigidBody[] = [];

  for (let i = 0; i < dieTypes.length; i++) {
    const dieType = dieTypes[i]!;
    const spawn = spawnStates[i]!;
    const verts = getHullVertices(dieType);
    const colliderDesc = makeColliderForDie(verts);

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
      .setRotation({
        x: spawn.initialRotation.x,
        y: spawn.initialRotation.y,
        z: spawn.initialRotation.z,
        w: spawn.initialRotation.w,
      })
      .setLinvel(spawn.velocity.x, spawn.velocity.y, spawn.velocity.z)
      .setAngvel({
        x: spawn.angularVelocity.x,
        y: spawn.angularVelocity.y,
        z: spawn.angularVelocity.z,
      })
      .setLinearDamping(0.1)
      .setAngularDamping(0.48)
      .setCcdEnabled(true);

    const body = world.createRigidBody(rbDesc);
    world.createCollider(colliderDesc, body);
    bodies.push(body);
  }

  return { world, bodies, dieTypes };
}

function bodySettled(body: RAPIER.RigidBody, step: number): boolean {
  if (step < MIN_STEPS_BEFORE_SETTLE) return false;
  const lv = body.linvel();
  const av = body.angvel();
  const v = Math.hypot(lv.x, lv.y, lv.z);
  const w = Math.hypot(av.x, av.y, av.z);
  return body.isSleeping() || (v < 0.035 && w < 0.035);
}

function readResultsFromContext(ctx: RapierDiceWorldContext): DiceAnimationFace[] {
  const { bodies, dieTypes } = ctx;
  const q = new THREE.Quaternion();
  return dieTypes.map((dieType, i) => {
    const sides = dieType === 'd100' ? 100 : Number.parseInt(dieType.slice(1), 10);
    const body = bodies[i];
    const fm = getFaceMap(dieType);
    if (!body || !fm || !Object.keys(fm).length) {
      return { sides, value: 1 };
    }
    const r = body.rotation();
    q.set(r.x, r.y, r.z, r.w);
    const key = determineLandingFaceKey(q, fm, dieType !== 'd4');
    return { sides, value: faceKeyToRollValue(dieType, key) };
  });
}

/** Headless: step until all dice settle (or cap), then return roll values. Caller must have awaited `ensureRapierPhysics`. */
export function simulateDiceRollSync(
  seed: number,
  dieTypes: DieType[],
  aspectRatio = 16 / 9,
): DiceAnimationFace[] {
  if (!dieTypes.length) return [];
  const ctx = createRapierDiceWorld(seed, dieTypes, aspectRatio);
  try {
    let step = 0;
    while (step < SIM_MAX_STEPS) {
      ctx.world.step();
      step++;
      if (ctx.bodies.length && ctx.bodies.every((b) => bodySettled(b, step))) break;
    }
    return readResultsFromContext(ctx);
  } finally {
    ctx.world.free();
  }
}

/** Async entry used after WASM init (e.g. from `rollDiceLocal`). */
export async function simulateDiceRoll(
  seed: number,
  dieTypes: DieType[],
  aspectRatio = 16 / 9,
): Promise<DiceAnimationFace[]> {
  await ensureRapierPhysics();
  return simulateDiceRollSync(seed, dieTypes, aspectRatio);
}

export function syncMeshFromRigidBody(mesh: THREE.Object3D, body: RAPIER.RigidBody): void {
  const t = body.translation();
  const r = body.rotation();
  mesh.position.set(t.x, t.y, t.z);
  mesh.quaternion.set(r.x, r.y, r.z, r.w);
}

/** Fixed Rapier step in ms — visual loop must use this for sync with headless `simulateDiceRoll`. */
export const RAPIER_SIM_STEP_MS = 1000 / 120;
