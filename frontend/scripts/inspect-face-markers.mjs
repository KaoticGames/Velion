import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';
import path from 'path';

const DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

function parseFace(dieType, name) {
  const prefix = `${dieType}_face`;
  if (!name?.startsWith(prefix)) return null;
  const suffix = name.slice(prefix.length).replace(/^_/, '');
  const n = Number.parseInt(suffix, 10);
  return Number.isFinite(n) ? n : null;
}

function normalize(mesh) {
  mesh.scale.set(1, 1, 1);
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const c = box.getCenter(new THREE.Vector3());
  for (const ch of mesh.children) ch.position.sub(c);
  mesh.updateMatrixWorld(true);
  const size = box.setFromObject(mesh).getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z, 1e-6);
  mesh.scale.setScalar(1.75 / max);
}

function dieCenter(gltf, dieType) {
  const c = new THREE.Vector3();
  let body = null;
  let maxV = 0;
  gltf.scene.traverse((ch) => {
    if (!ch.isMesh) return;
    const n = ch.name ?? '';
    if (n.startsWith('Text') || parseFace(dieType, n) != null || n.startsWith('Curve')) return;
    const cnt = ch.geometry?.attributes?.position?.count ?? 0;
    if (cnt > maxV) {
      maxV = cnt;
      body = ch;
    }
  });
  new THREE.Box3().setFromObject(body ?? gltf.scene).getCenter(c);
  return c;
}

function markerNormal(mesh, dieCenter) {
  const pos = mesh.geometry.attributes.position;
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  v0.fromBufferAttribute(pos, 0);
  v1.fromBufferAttribute(pos, 1);
  v2.fromBufferAttribute(pos, 2);
  mesh.localToWorld(v0);
  mesh.localToWorld(v1);
  mesh.localToWorld(v2);
  const n = new THREE.Vector3()
    .copy(v2)
    .sub(v1)
    .cross(v0.clone().sub(v1))
    .normalize();
  const cen = v0.clone().add(v1).add(v2).divideScalar(3);
  if (n.dot(cen.clone().sub(dieCenter)) < 0) n.negate();
  return n;
}

function meshCentroid(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const c = new THREE.Vector3();
  mesh.geometry.boundingBox.getCenter(c);
  return mesh.localToWorld(c);
}

for (const dieType of DICE) {
  const buf = fs.readFileSync(path.join('public/assets/dice', `${dieType}.glb`));
  const gltf = await new Promise((res, rej) =>
    new GLTFLoader().parse(buf.buffer, '', res, rej),
  );
  normalize(gltf.scene);
  const center = dieCenter(gltf, dieType);
  const bodyR =
    new THREE.Box3()
      .setFromObject(gltf.scene)
      .getSize(new THREE.Vector3())
      .length() * 0.5;

  const labels = [];
  const markers = [];
  gltf.scene.traverse((ch) => {
    if (!ch.isMesh) return;
    if (ch.name?.startsWith('Text')) labels.push(ch);
    const f = parseFace(dieType, ch.name);
    if (f != null) markers.push({ face: f, mesh: ch });
  });

  let maxInset = 0;
  let maxNormalLabelAngle = 0;
  let selfMapOk = 0;

  for (const { face, mesh } of markers) {
    const cen = meshCentroid(mesh);
    const inset = bodyR > 0 ? center.distanceTo(cen) / bodyR : 0;
    maxInset = Math.max(maxInset, inset);

    const mNorm = markerNormal(mesh, center);
    let bestLabel = null;
    let bestDot = -1;
    for (const label of labels) {
      const lCen = meshCentroid(label);
      const lDir = lCen.clone().sub(center).normalize();
      const dot = lDir.dot(mNorm);
      if (dot > bestDot) {
        bestDot = dot;
        bestLabel = lDir;
      }
    }
    if (bestLabel) {
      const ang = (Math.acos(THREE.MathUtils.clamp(mNorm.dot(bestLabel), -1, 1)) * 180) / Math.PI;
      maxNormalLabelAngle = Math.max(maxNormalLabelAngle, ang);
    }

    const q = new THREE.Quaternion().setFromUnitVectors(
      mNorm.clone().transformDirection(gltf.scene.matrixWorld.clone().invert()),
      dieType === 'd4' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0),
    );
    // quick self check in world
    const up = dieType === 'd4' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
    const worldN = mNorm.clone(); // at identity root
    if (worldN.dot(up) > 0.99) selfMapOk++;
  }

  console.log(
    `${dieType}: markers=${markers.length} labels=${labels.length} maxInsetRatio=${maxInset.toFixed(3)} maxMarker-LabelAngle°=${maxNormalLabelAngle.toFixed(2)} identitySelfFlat=${selfMapOk}/${markers.length}`,
  );
}
