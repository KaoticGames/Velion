import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildFaceMap, clearFaceMapCache } from './faceQuaternions';
import {
  extractBodyVerticesLocal,
  extractConvexHullPointsFromMarkers,
  normalizeDieMesh,
} from './diceMesh';
import { DICE_ASSET_BASE, DIE_TYPES, type DieType, type DiceQuaternionMap, type FaceMap } from './types';

export { normalizeDieMesh, TARGET_DIE_MAX_DIM } from './diceMesh';

const loader = new GLTFLoader();
const loadedDice: Partial<Record<DieType, THREE.Group>> = {};
const faceMaps: Partial<DiceQuaternionMap> = {};
/** Solid-body vertex samples (root-local XYZ interleaved) for mesh-accurate floor contact. */
const bodyVertices: Partial<Record<DieType, Float32Array>> = {};
/** Convex-hull point cloud — face markers only (avoids bevel/edge phantom facets). */
const hullVertices: Partial<Record<DieType, Float32Array>> = {};
let preloadPromise: Promise<void> | null = null;

function cloneDieInstance(template: THREE.Group): THREE.Group {
  const mesh = template.clone(true);
  mesh.traverse((obj) => {
    const child = obj as THREE.Mesh;
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material)
      ? child.material.map((mat) => mat.clone())
      : child.material
        ? [child.material.clone()]
        : [];
    child.material = mats.length === 1 ? mats[0] : mats;
    mats.forEach((mat) => {
      mat.transparent = false;
      mat.opacity = 1;
    });
  });
  return mesh;
}

export function getLoadedDie(dieType: DieType): THREE.Group | undefined {
  const template = loadedDice[dieType];
  return template ? cloneDieInstance(template) : undefined;
}

export function getFaceMap(dieType: DieType): FaceMap | undefined {
  return faceMaps[dieType];
}

/** Body mesh vertices for floor contact (see diceMesh.ts). */
export function getBodyVertices(dieType: DieType): Float32Array {
  return bodyVertices[dieType] ?? new Float32Array(0);
}

/** Points used to build the Rapier convex hull collider. */
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
          loader.load(
            `${DICE_ASSET_BASE}/${dieType}.glb`,
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
            undefined,
            (err) => reject(err),
          );
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

export { getLabelMeshName } from './faceQuaternions';
