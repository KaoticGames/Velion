import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildFaceMap, clearFaceMapCache } from './faceQuaternions';
import {
  extractBodyVerticesLocal,
  extractConvexHullPointsFromMarkers,
  normalizeDieMesh,
} from './diceMesh';
import { DIE_TYPES, type DieType, type DiceQuaternionMap, type FaceMap } from './types';

export { normalizeDieMesh, TARGET_DIE_MAX_DIM } from './diceMesh';

function resolveDiceAssetsDir(): string {
  if (process.env.DICE_ASSETS_DIR) return process.env.DICE_ASSETS_DIR;
  const fromBackend = path.resolve(process.cwd(), '..', 'frontend', 'public', 'assets', 'dice');
  const fromRepo = path.resolve(process.cwd(), 'frontend', 'public', 'assets', 'dice');
  return fromBackend;
}

const DICE_DIR = resolveDiceAssetsDir();
const loader = new GLTFLoader();
const loadedDice: Partial<Record<DieType, THREE.Group>> = {};
const faceMaps: Partial<DiceQuaternionMap> = {};
const bodyVertices: Partial<Record<DieType, Float32Array>> = {};
const hullVertices: Partial<Record<DieType, Float32Array>> = {};
let preloadPromise: Promise<void> | null = null;

export function getFaceMap(dieType: DieType): FaceMap | undefined {
  return faceMaps[dieType];
}

export function getBodyVertices(dieType: DieType): Float32Array {
  return bodyVertices[dieType] ?? new Float32Array(0);
}

export function getHullVertices(dieType: DieType): Float32Array {
  return hullVertices[dieType] ?? bodyVertices[dieType] ?? new Float32Array(0);
}

export function areDicePreloaded(): boolean {
  return DIE_TYPES.every((t) => loadedDice[t] != null);
}

export function preloadAllDice(): Promise<void> {
  if (preloadPromise) return preloadPromise;

  preloadPromise = Promise.all(
    DIE_TYPES.map(
      (dieType) =>
        new Promise<void>((resolve, reject) => {
          const filePath = path.join(DICE_DIR, `${dieType}.glb`);
          try {
            const buf = fs.readFileSync(filePath);
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            loader.parse(
              arrayBuffer,
              DICE_DIR,
              (gltf) => {
                normalizeDieMesh(gltf.scene, dieType);
                bodyVertices[dieType] = extractBodyVerticesLocal(gltf.scene, dieType);
                const markerHull = extractConvexHullPointsFromMarkers(gltf.scene, dieType);
                hullVertices[dieType] =
                  markerHull.length >= 12 ? markerHull : bodyVertices[dieType]!;
                faceMaps[dieType] = buildFaceMap(dieType, gltf);
                loadedDice[dieType] = gltf.scene;
                resolve();
              },
              (err) => reject(err),
            );
          } catch (err) {
            reject(err);
          }
        }),
    ),
  ).then(() => undefined);

  return preloadPromise;
}

export function resetDiceLoader(): void {
  preloadPromise = null;
  clearFaceMapCache();
  DIE_TYPES.forEach((t) => {
    delete loadedDice[t];
    delete faceMaps[t];
    delete bodyVertices[t];
    delete hullVertices[t];
  });
}
