import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DieType, FaceMap } from './types';

const worldUp = new THREE.Vector3(0, 1, 0);
const worldDown = new THREE.Vector3(0, -1, 0);

/** Face key → Text mesh name that displays that result on the die body. */
const labelMeshByFace: Partial<Record<DieType, Record<number, string>>> = {};

const scratchV0 = new THREE.Vector3();
const scratchV1 = new THREE.Vector3();
const scratchV2 = new THREE.Vector3();
const scratchCentroid = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();

/**
 * Parse a face number from a mesh name.
 *
 * Handles two naming conventions:
 *  1. d8_face_1  (underscore before digit — original/preferred)
 *  2. d8_face1   (no underscore — Blender sometimes drops it)
 *
 * Also handles Blender's auto-suffix for duplicated objects:
 *  d8_face1.001 → face 2, d8_face1.002 → face 3, etc.
 *  The base object (no suffix) = face 1; each .001 increment adds 1.
 *
 * Special case — d100: faces are multiples of 10 (10, 20 … 100).
 *  d100_face_00      → face 100 (the "00" face = 100 in most conventions)
 *  d100_face_00.001  → face 10, .002 → 20, etc.
 */
function parseFaceNumber(dieType: DieType, name: string): number | null {
  const underscorePrefix = `${dieType}_face_`;
  const directPrefix     = `${dieType}_face`;

  let raw: string;
  if (name.startsWith(underscorePrefix)) {
    raw = name.slice(underscorePrefix.length);
  } else if (name.startsWith(directPrefix)) {
    raw = name.slice(directPrefix.length);
  } else {
    return null;
  }

  // Blender auto-suffix pattern: "1.001", "1.002", "00.001", etc.
  const blenderMatch = raw.match(/^(\d+)\.(\d{3})$/);
  if (blenderMatch) {
    const suffixIndex = Number.parseInt(blenderMatch[2], 10); // 001 → 1
    if (!Number.isFinite(suffixIndex)) return null;
    if (dieType === 'd100') {
      // Suffix .001=10, .002=20, ..., .009=90
      return (suffixIndex % 10) === 0
        ? suffixIndex
        : suffixIndex * 10;
    }
    // Generic: base mesh = face 1; each .001 increment = next face
    return suffixIndex + 1;
  }

  // No Blender suffix — direct numeric parse
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;

  // d10: the "0" face = value 10 (standard D&D convention)
  if (dieType === 'd10' && n === 0) return 10;
  // d100: the "00" face = value 0 (tens digit is 0; game combines with d10)
  // Include it in the face map so the die can land on it correctly.
  if (dieType === 'd100' && n === 0) return 0;

  return n >= 0 ? n : null;
}

function isLabelMesh(name: string): boolean {
  return name.startsWith('Text');
}

function isFaceMarkerMesh(dieType: DieType, name: string): boolean {
  return name.startsWith(`${dieType}_face_`);
}

function isDecorativeMesh(name: string): boolean {
  return name.startsWith('Curve') || name.startsWith('SVG');
}

/**
 * Compute the die's geometric center as the average of all face marker centroids.
 *
 * Using the body mesh bounding box is unreliable — body mesh vertex data can be
 * slightly offset even when the model is "centered" in Blender. The face markers
 * are the authoritative source: for any regular die, their centroids are
 * symmetrically distributed around the true center, so their average is always
 * close to origin regardless of body mesh position.
 *
 * Falls back to (0,0,0) if no face markers are found.
 */
function computeDieCenter(gltf: GLTF, dieType: DieType): THREE.Vector3 {
  const sum    = new THREE.Vector3();
  let   count  = 0;
  const marker = new THREE.Vector3();

  gltf.scene.traverse((child) => {
    if (!isFaceMarkerMesh(dieType, child.name ?? '')) return;
    const mesh = child as THREE.Mesh;
    if (!(mesh as THREE.Mesh).isMesh || !mesh.geometry) return;
    meshWorldCentroid(mesh, marker);
    sum.add(marker);
    count++;
  });

  if (count > 0) return sum.divideScalar(count);

  // Fallback — models should always have face markers
  return new THREE.Vector3(0, 0, 0);
}

function meshWorldCentroid(mesh: THREE.Mesh, target: THREE.Vector3): THREE.Vector3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return target.set(0, 0, 0);
  box.getCenter(target);
  return mesh.localToWorld(target);
}

/**
 * Outward unit normal of a `{dieType}_face_{N}` marker triangle in world space.
 *
 * Markers may be inset (parallel to but below the outer surface) or flush — in both cases
 * the triangle normal is the face definition and matches the exterior orientation.
 */
export function markerTriangleNormal(mesh: THREE.Mesh, dieCenter: THREE.Vector3): THREE.Vector3 {
  const pos = mesh.geometry.attributes.position;
  if (!pos || pos.count < 3) {
    return meshWorldCentroid(mesh, scratchCentroid).sub(dieCenter).normalize();
  }

  scratchV0.fromBufferAttribute(pos, 0);
  scratchV1.fromBufferAttribute(pos, 1);
  scratchV2.fromBufferAttribute(pos, 2);
  mesh.localToWorld(scratchV0);
  mesh.localToWorld(scratchV1);
  mesh.localToWorld(scratchV2);

  scratchNormal
    .copy(scratchV2)
    .sub(scratchV1)
    .cross(scratchV0.clone().sub(scratchV1))
    .normalize();

  scratchCentroid.copy(scratchV0).add(scratchV1).add(scratchV2).divideScalar(3);
  if (scratchNormal.dot(scratchCentroid.clone().sub(dieCenter)) < 0) {
    scratchNormal.negate();
  }
  return scratchNormal.clone();
}

function associateLabelMeshes(dieType: DieType, gltf: GLTF, dieCenter: THREE.Vector3): Record<number, string> {
  const faceNormals: Record<number, THREE.Vector3> = {};
  const labels: THREE.Mesh[] = [];

  gltf.scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && isLabelMesh(child.name)) {
      labels.push(child as THREE.Mesh);
    }
    const faceNumber = parseFaceNumber(dieType, child.name);
    if (faceNumber == null || !(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    if (!mesh.geometry) return;
    faceNormals[faceNumber] = markerTriangleNormal(mesh, dieCenter);
  });

  const map: Record<number, string> = {};
  for (const [key, normal] of Object.entries(faceNormals)) {
    const faceNumber = Number(key);
    let best: { name: string; dot: number } | null = null;
    for (const label of labels) {
      const labelDir = meshWorldCentroid(label, new THREE.Vector3()).sub(dieCenter).normalize();
      const dot = labelDir.dot(normal);
      if (!best || dot > best.dot) best = { name: label.name, dot };
    }
    if (best) map[faceNumber] = best.name;
  }
  return map;
}

export function getLabelMeshName(dieType: DieType, faceKey: number): string | undefined {
  return labelMeshByFace[dieType]?.[faceKey];
}

/**
 * Builds result face keys → root quaternions from `{dieType}_face_{N}` marker normals.
 * Inset markers are intentional: their normals are parallel to the outer surface.
 */
export function buildFaceMap(dieType: DieType, gltf: GLTF): FaceMap {
  const faceMap: FaceMap = {};
  const targetVector = dieType === 'd4' ? worldDown : worldUp;
  const dieCenter = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();

  gltf.scene.updateMatrixWorld(true);
  dieCenter.copy(computeDieCenter(gltf, dieType));

  labelMeshByFace[dieType] = associateLabelMeshes(dieType, gltf, dieCenter);

  gltf.scene.traverse((child) => {
    const faceNumber = parseFaceNumber(dieType, child.name);
    if (faceNumber == null || !(child as THREE.Mesh).isMesh) return;

    const marker = child as THREE.Mesh;
    if (!marker.geometry) return;

    const outwardNormal = markerTriangleNormal(marker, dieCenter);
    // markerTriangleNormal already guarantees outward direction.
    // setFromUnitVectors(outward → target) rotates the die so this face points
    // at targetVector: worldUp for standard dice, worldDown for d4.
    scratchQuat.setFromUnitVectors(outwardNormal, targetVector);
    faceMap[faceNumber] = scratchQuat.clone();
  });

  return faceMap;
}

export function clearFaceMapCache(): void {
  for (const key of Object.keys(labelMeshByFace) as DieType[]) {
    delete labelMeshByFace[key];
  }
}