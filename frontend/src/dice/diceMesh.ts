import * as THREE from 'three';
import type { DieType } from './types';

/** Every die is scaled so its solid body largest axis matches this (world units). */
export const TARGET_DIE_MAX_DIM = 1.75;

/**
 * Fine-tune after bbox normalize. d6 fills its bounding box (cube) while polyhedra
 * leave more empty space at the same max-dim, so it reads larger on screen.
 */
const DIE_VISUAL_SCALE: Partial<Record<DieType, number>> = {
  d6: 0.65,
};

const scratchVertex = new THREE.Vector3();
const scratchSize = new THREE.Vector3();

function isNonBodyMesh(name: string, dieType: DieType): boolean {
  if (name.startsWith('Text')) return true;
  if (name.startsWith('Curve') || name.startsWith('SVG')) return true;
  if (name.startsWith(`${dieType}_face`)) return true;
  return false;
}

function isFaceMarkerMesh(dieType: DieType, name: string): boolean {
  return name.startsWith(`${dieType}_face_`) || name.startsWith(`${dieType}_face`);
}

/** Bounding box of visible body meshes only (excludes face frames, labels, curves). */
function computeBodyBounds(mesh: THREE.Group, dieType: DieType): THREE.Box3 {
  const box = new THREE.Box3();
  let any = false;
  mesh.updateMatrixWorld(true);
  mesh.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    if (isNonBodyMesh(child.name ?? '', dieType)) return;
    const childBox = new THREE.Box3().setFromObject(child);
    if (any) box.union(childBox);
    else {
      box.copy(childBox);
      any = true;
    }
  });
  if (!any) box.setFromObject(mesh);
  return box;
}

/**
 * Center geometry on the group origin and scale to a common size.
 * Must run before buildFaceMap() so marker normals match runtime meshes.
 */
export function normalizeDieMesh(mesh: THREE.Group, dieType: DieType): number {
  mesh.scale.set(1, 1, 1);
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.updateMatrixWorld(true);

  const center = computeBodyBounds(mesh, dieType).getCenter(scratchVertex);
  for (const child of mesh.children) {
    child.position.sub(center);
  }

  mesh.updateMatrixWorld(true);
  const size = computeBodyBounds(mesh, dieType).getSize(scratchSize);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const visualScale = DIE_VISUAL_SCALE[dieType] ?? 1;
  mesh.scale.setScalar((TARGET_DIE_MAX_DIM / maxDim) * visualScale);

  mesh.updateMatrixWorld(true);
  const scaled = computeBodyBounds(mesh, dieType).getSize(scratchSize);
  return Math.max(scaled.x, scaled.z) * 0.5 + 0.05;
}

/**
 * Solid-body vertices in die-root local space (bind pose after normalizeDieMesh).
 * Used for floor contact: the lowest rotated vertex defines what touches TABLE_Y.
 * Excludes inset `{dieType}_face_n` markers, Text labels, and decoration.
 */
export function extractBodyVerticesLocal(root: THREE.Group, dieType: DieType): Float32Array {
  let body: THREE.Mesh | null = null;
  let maxVerts = 0;

  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    if (isNonBodyMesh(mesh.name ?? '', dieType)) return;
    const count = mesh.geometry?.attributes?.position?.count ?? 0;
    if (count > maxVerts) {
      maxVerts = count;
      body = mesh;
    }
  });

  if (!body) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    return new Float32Array([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]);
  }

  const bodyMesh = body as THREE.Mesh;
  const posAttr = bodyMesh.geometry.attributes.position;
  if (!posAttr) return new Float32Array(0);

  const stride = Math.max(1, Math.ceil(posAttr.count / 1200));
  const out: number[] = [];
  root.updateMatrixWorld(true);

  for (let i = 0; i < posAttr.count; i += stride) {
    scratchVertex.fromBufferAttribute(posAttr, i);
    bodyMesh.localToWorld(scratchVertex);
    root.worldToLocal(scratchVertex);
    out.push(scratchVertex.x, scratchVertex.y, scratchVertex.z);
  }

  return new Float32Array(out);
}

/**
 * Points for Rapier `convexHull` — sampled from `{dieType}_face_n` markers only.
 * Beveled body meshes add extra hull facets along visual edges; markers define the
 * true face planes so the collider is a clean polyhedron (only real faces rest flat).
 */
export function extractConvexHullPointsFromMarkers(root: THREE.Group, dieType: DieType): Float32Array {
  const out: number[] = [];
  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    if (!isFaceMarkerMesh(dieType, mesh.name ?? '')) return;
    const pos = mesh.geometry?.attributes?.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      scratchVertex.fromBufferAttribute(pos, i);
      mesh.localToWorld(scratchVertex);
      root.worldToLocal(scratchVertex);
      out.push(scratchVertex.x, scratchVertex.y, scratchVertex.z);
    }
  });

  return new Float32Array(out);
}

/** Lowest Y among body vertices after applying `quat` (die origin at world y = 0). */
export function lowestLocalYUnderQuaternion(quat: THREE.Quaternion, vertsXYZ: Float32Array): number {
  if (vertsXYZ.length < 3) return 0;

  let minY = Infinity;
  for (let i = 0; i < vertsXYZ.length; i += 3) {
    scratchVertex.set(vertsXYZ[i]!, vertsXYZ[i + 1]!, vertsXYZ[i + 2]!);
    scratchVertex.applyQuaternion(quat);
    if (scratchVertex.y < minY) minY = scratchVertex.y;
  }
  return Number.isFinite(minY) ? minY : 0;
}

/** Origin Y so the lowest point of the solid mesh sits on the table plane. */
export function originYForMeshOnTable(
  quat: THREE.Quaternion,
  vertsXYZ: Float32Array,
  tableY: number,
): number {
  return tableY - lowestLocalYUnderQuaternion(quat, vertsXYZ);
}
