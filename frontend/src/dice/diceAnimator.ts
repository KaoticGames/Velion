/**
 * diceAnimator.ts — Three.js host + Rapier rigid-body dice.
 *
 * - Seed only sets initial poses and velocities (see diceSpawn / createRapierDiceWorld).
 * - Fixed Rapier timestep matches headless `simulateDiceRoll` so all clients stay in lockstep.
 * - Results are read from the rigid body’s final orientation and FaceMap (no forced faces).
 */

import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { getFaceMap, getLoadedDie } from './diceLoader';
import { TABLE_Y, CAMERA_HEIGHT, computeOverlayFrustum } from './diceSpawn';
import { determineLandingFaceKey } from './diceFaceRead';
import {
  createRapierDiceWorld,
  ensureRapierPhysics,
  RAPIER_SIM_STEP_MS,
  syncMeshFromRigidBody,
  type RapierDiceWorldContext,
} from './rapierDiceSim';
import {
  animationSpecToInstructions,
  faceKeyToRollValue,
  type DiceAnimationFace,
  type DieType,
  type FaceMap,
} from './types';

export { simulateDiceRoll } from './rapierDiceSim';

const PHASE_MS_LINGER = 1000;
const PHASE_MS_DISMISS = 350;
const SIM_MAX_STEPS = 120 * 30;
const MIN_STEPS_BEFORE_SETTLE = 120 * 2;

type Phase = 'roll' | 'landed' | 'dismiss';

interface ActiveDie {
  mesh: THREE.Group;
  dieType: DieType;
  rigidBody: RigidBody;
  faceMap: FaceMap | undefined;
  faceUp: boolean;
  phase: Phase;
  phaseEndsAtMs: number;
  opacity: number;
  landedFace: number | null;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function dieTypeToSides(dieType: DieType): number {
  return dieType === 'd100' ? 100 : Number.parseInt(dieType.slice(1), 10);
}

function bodySettledForVisual(body: RigidBody, step: number): boolean {
  if (step < MIN_STEPS_BEFORE_SETTLE) return false;
  const lv = body.linvel();
  const av = body.angvel();
  const v = Math.hypot(lv.x, lv.y, lv.z);
  const w = Math.hypot(av.x, av.y, av.z);
  return body.isSleeping() || (v < 0.035 && w < 0.035);
}

function readLandingRollValue(
  mesh: THREE.Object3D,
  dieType: DieType,
  faceMap: FaceMap | undefined,
  faceUp: boolean,
): number {
  if (!faceMap || !Object.keys(faceMap).length) return 1;
  const key = determineLandingFaceKey(mesh.quaternion, faceMap, faceUp);
  return faceKeyToRollValue(dieType, key);
}

// ── Scene controller ──────────────────────────────────────────────────────────
export class DiceSceneController {
  private host: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  /** Fixed screen-facing overlay (orthographic top-down); physics arena unchanged. */
  private camera: THREE.OrthographicCamera | null = null;
  /** Aspect used for overlay frustum during an active roll (matches server sim). */
  private rollViewportAspect: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId = 0;
  private lastFrame = 0;
  private activeDice: ActiveDie[] = [];
  private onComplete: ((results: DiceAnimationFace[]) => void) | null = null;
  private pointerEventsActive = false;
  private renderLoopActive = false;
  private aspectRatio = 16 / 9;
  private accumulator = 0;
  private simMs = 0;
  private rapierCtx: RapierDiceWorldContext | null = null;
  private rapierPhysicsSteps = 0;
  private rollOutcomeHandled = false;

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    host.innerHTML = '';
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const aspect = width / height;
    const { halfW, halfH } = computeOverlayFrustum(aspect);
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200);
    this.applyOverlayCameraPose(camera);

    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xfff2d0, 1.05);
    key.position.set(3, 14, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8899cc, 0.4);
    fill.position.set(-5, 12, -4);
    scene.add(fill);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.aspectRatio = width / height;
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(host);
    this.handleResize();
    await ensureRapierPhysics();
  }

  /** Bird's-eye overlay: camera faces the play plane; dice move in screen X/Z. */
  private applyOverlayCameraPose(camera: THREE.OrthographicCamera): void {
    camera.position.set(0, CAMERA_HEIGHT, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, TABLE_Y, 0);
  }

  private updateOverlayCamera(): void {
    const camera = this.camera;
    if (!camera) return;
    const aspect = this.rollViewportAspect ?? this.aspectRatio;
    const { halfW, halfH } = computeOverlayFrustum(aspect);
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    this.applyOverlayCameraPose(camera);
  }

  private startRenderLoop(): void {
    if (this.renderLoopActive) return;
    this.renderLoopActive = true;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.tick();
  }

  private stopRenderLoop(): void {
    if (!this.renderLoopActive) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.renderLoopActive = false;
  }

  private handleResize(): void {
    if (!this.host || !this.renderer || !this.camera) return;
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.aspectRatio = w / h;
    this.updateOverlayCamera();
  }

  private disposeRapier(): void {
    this.rapierCtx?.world.free();
    this.rapierCtx = null;
    this.rapierPhysicsSteps = 0;
    this.rollOutcomeHandled = false;
  }

  /**
   * Seeded Rapier roll — same seed + die order as `simulateDiceRoll` / other tabs.
   */
  async playRollSeeded(
    seed: number,
    dieTypes: DieType[],
    onComplete: (results: DiceAnimationFace[]) => void,
    physicsViewportAspect?: number,
  ): Promise<boolean> {
    if (!this.scene || !dieTypes.length) return false;
    await ensureRapierPhysics();

    this.onComplete = null;
    this.stopRenderLoop();
    this.clearMeshesInternal();
    this.setPointerEvents(false);
    this.simMs = 0;
    this.accumulator = 0;

    const aspect = physicsViewportAspect ?? this.aspectRatio;
    this.rollViewportAspect = aspect;
    this.updateOverlayCamera();
    this.rapierCtx = createRapierDiceWorld(seed, dieTypes, aspect);
    const { bodies } = this.rapierCtx;

    for (let i = 0; i < dieTypes.length; i++) {
      const dieType = dieTypes[i]!;
      const template = getLoadedDie(dieType);
      const body = bodies[i];
      if (!template || !body) continue;

      const mesh = template;
      mesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          (obj as THREE.Mesh).castShadow = false;
          (obj as THREE.Mesh).receiveShadow = false;
        }
      });
      syncMeshFromRigidBody(mesh, body);
      this.scene.add(mesh);

      this.activeDice.push({
        mesh,
        dieType,
        rigidBody: body,
        faceMap: getFaceMap(dieType),
        faceUp: dieType !== 'd4',
        phase: 'roll',
        phaseEndsAtMs: 0,
        opacity: 1,
        landedFace: null,
      });
    }

    if (!this.activeDice.length) {
      this.disposeRapier();
      return false;
    }

    this.onComplete = onComplete;
    this.lastFrame = performance.now();
    this.startRenderLoop();
    return true;
  }

  async playRoll(
    spec: DiceAnimationFace[],
    onComplete: () => void,
    seed?: number,
  ): Promise<boolean> {
    const instructions = animationSpecToInstructions(spec);
    if (!instructions.length || !this.scene) return false;
    const dieTypes = instructions.map((i) => i.dieType);
    return this.playRollSeeded(
      seed ?? ((Math.random() * 0xffffffff) >>> 0),
      dieTypes,
      () => onComplete(),
      undefined,
    );
  }

  clear(): void {
    this.clearMeshesInternal();
    this.onComplete = null;
    this.setPointerEvents(false);
    this.stopRenderLoop();
    this.flushCanvas();
  }

  /** Wipe the last dice frame so the canvas does not ghost after meshes are removed. */
  private flushCanvas(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);
  }

  private clearMeshesInternal(): void {
    if (!this.scene) return;
    for (const die of this.activeDice) this.scene.remove(die.mesh);
    this.activeDice = [];
    this.rollViewportAspect = null;
    this.disposeRapier();
  }

  dispose(): void {
    this.stopRenderLoop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearMeshesInternal();
    this.renderer?.dispose();
    if (this.host) this.host.innerHTML = '';
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.host = null;
    this.onComplete = null;
  }

  private setPointerEvents(active: boolean): void {
    if (!this.renderer || this.pointerEventsActive === active) return;
    this.pointerEventsActive = active;
    this.renderer.domElement.style.pointerEvents = 'none';
  }

  private tick = (): void => {
    if (!this.renderLoopActive) return;
    const now = performance.now();
    const elapsed = Math.min(now - this.lastFrame, 50);
    this.lastFrame = now;
    this.accumulator += elapsed;

    if (!this.renderer || !this.scene || !this.camera || !this.rapierCtx) {
      this.stopRenderLoop();
      return;
    }
    if (!this.activeDice.length) {
      this.stopRenderLoop();
      return;
    }

    const ctx = this.rapierCtx;

    while (this.accumulator >= RAPIER_SIM_STEP_MS) {
      ctx.world.step();
      this.rapierPhysicsSteps++;
      this.simMs += RAPIER_SIM_STEP_MS;
      this.accumulator -= RAPIER_SIM_STEP_MS;

      for (const die of this.activeDice) {
        if (die.phase === 'roll') syncMeshFromRigidBody(die.mesh, die.rigidBody);
      }

      if (!this.rollOutcomeHandled) {
        const allSettled = ctx.bodies.every((b) =>
          bodySettledForVisual(b, this.rapierPhysicsSteps),
        );
        const forceEnd = this.rapierPhysicsSteps >= SIM_MAX_STEPS;
        if (allSettled || forceEnd) {
          this.rollOutcomeHandled = true;
          for (const die of this.activeDice) {
            syncMeshFromRigidBody(die.mesh, die.rigidBody);
            die.landedFace = readLandingRollValue(die.mesh, die.dieType, die.faceMap, die.faceUp);
            die.phase = 'landed';
            die.phaseEndsAtMs = this.simMs + PHASE_MS_LINGER;
          }
        }
      }
    }

    for (const die of this.activeDice) {
      if (die.phase === 'landed' && this.simMs >= die.phaseEndsAtMs) {
        die.phase = 'dismiss';
        die.phaseEndsAtMs = this.simMs + PHASE_MS_DISMISS;
      }
      if (die.phase === 'dismiss') {
        const t = 1 - Math.max(0, (die.phaseEndsAtMs - this.simMs) / PHASE_MS_DISMISS);
        die.opacity = 1 - smoothstep(t);
        this.applyOpacity(die.mesh, die.opacity);
      }
    }

    this.updateOverlayCamera();
    this.renderer.render(this.scene, this.camera);

    const allDone = this.activeDice.every((d) => d.phase === 'dismiss' && d.opacity <= 0.02);
    if (allDone && this.onComplete) {
      const results = this.activeDice.map((d) => ({
        sides: dieTypeToSides(d.dieType),
        value: d.landedFace ?? 1,
      }));
      const done = this.onComplete;
      this.onComplete = null;
      this.clear();
      done(results);
      return;
    }

    if (this.renderLoopActive) this.rafId = requestAnimationFrame(this.tick);
  };

  private applyOpacity(root: THREE.Object3D, opacity: number): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat) => {
        if (!mat) return;
        mat.transparent = opacity < 1;
        mat.opacity = opacity;
      });
    });
  }
}
