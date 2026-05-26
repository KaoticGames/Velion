/**
 * Read which `{dieType}_face_n` is toward +Y (standard) or −Y (d4) from orientation + FaceMap.
 */

import * as THREE from 'three';
import type { FaceMap } from './types';

const _invQuat = new THREE.Quaternion();
const _localUp = new THREE.Vector3();
const _faceInv = new THREE.Quaternion();
const _faceNorm = new THREE.Vector3();

/**
 * @param faceUp — `true` for d6–d100 (result faces +Y); `false` for d4 (result faces −Y / toward floor).
 */
export function determineLandingFaceKey(
  spinQuat: THREE.Quaternion,
  faceMap: FaceMap,
  faceUp: boolean,
): number {
  const targetDir = faceUp ? 1 : -1;
  _invQuat.copy(spinQuat).invert();
  _localUp.set(0, targetDir, 0).applyQuaternion(_invQuat);

  let bestFace = -1;
  let bestDot = -Infinity;
  for (const [key, faceQ] of Object.entries(faceMap)) {
    _faceInv.copy(faceQ).invert();
    _faceNorm.set(0, targetDir, 0).applyQuaternion(_faceInv);
    const dot = _localUp.dot(_faceNorm);
    if (dot > bestDot) {
      bestDot = dot;
      bestFace = Number(key);
    }
  }
  return bestFace >= 0 ? bestFace : Number(Object.keys(faceMap)[0] ?? 1);
}
