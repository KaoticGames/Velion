/**
 * Full audit via Three GLTFLoader + same logic as diceLoader.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICE_DIR = path.resolve(__dirname, '../public/assets/dice');
const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

function parseFaceNumber(dieType, name) {
  const underscorePrefix = `${dieType}_face_`;
  const directPrefix = `${dieType}_face`;
  let raw;
  if (name.startsWith(underscorePrefix)) raw = name.slice(underscorePrefix.length);
  else if (name.startsWith(directPrefix)) raw = name.slice(directPrefix.length);
  else return null;
  const blenderMatch = raw.match(/^(\d+)\.(\d{3})$/);
  if (blenderMatch) {
    const suffixIndex = Number.parseInt(blenderMatch[2], 10);
    if (dieType === 'd100') return suffixIndex % 10 === 0 ? suffixIndex : suffixIndex * 10;
    return suffixIndex + 1;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  if (dieType === 'd10' && n === 0) return 10;
  if (dieType === 'd100' && n === 0) return 0;
  return n >= 0 ? n : null;
}

function isFaceMarkerMesh(dieType, name) {
  return name.startsWith(`${dieType}_face_`) || name.startsWith(`${dieType}_face`);
}

function countMarkerHullVerts(scene, dieType) {
  let n = 0;
  scene.traverse((c) => {
    if (!c.isMesh || !isFaceMarkerMesh(dieType, c.name ?? '')) return;
    n += c.geometry?.attributes?.position?.count ?? 0;
  });
  return n;
}

const loader = new GLTFLoader();

for (const dieType of DIE_TYPES) {
  const buf = fs.readFileSync(path.join(DICE_DIR, `${dieType}.glb`));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(ab, DICE_DIR, resolve, reject);
  });

  const markers = [];
  const bodyMeshes = [];
  gltf.scene.traverse((c) => {
    if (!c.isMesh) return;
    const name = c.name ?? '';
    const key = parseFaceNumber(dieType, name);
    if (key != null) {
      const pos = c.geometry?.attributes?.position;
      markers.push({
        name,
        key,
        verts: pos?.count ?? 0,
        bbox: pos ? (() => {
          c.geometry.computeBoundingBox();
          const b = c.geometry.boundingBox;
          return b ? { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z } : null;
        })() : null,
      });
    } else if (!name.startsWith('Text') && !name.startsWith('Curve') && !name.startsWith('SVG')) {
      bodyMeshes.push({ name, verts: c.geometry?.attributes?.position?.count ?? 0 });
    }
  });

  const byKey = new Map();
  markers.forEach((m) => {
    if (!byKey.has(m.key)) byKey.set(m.key, []);
    byKey.get(m.key).push(m);
  });

  console.log(`\n=== ${dieType} ===`);
  console.log(`  Markers: ${markers.length} meshes, ${[...byKey.keys()].length} keys, ${countMarkerHullVerts(gltf.scene, dieType)} hull verts`);
  console.log(`  Body-ish meshes: ${bodyMeshes.map((b) => `${b.name}(${b.verts}v)`).join(', ') || 'none'}`);

  for (const [key, list] of [...byKey.entries()].sort((a, b) => a[0] - b[0])) {
    if (list.length > 1) {
      console.log(`  ⚠ key ${key}: ${list.map((m) => `${m.name}(${m.verts}v)`).join(', ')}`);
    }
    const thin = list.every((m) => m.bbox && Math.min(m.bbox.x, m.bbox.y, m.bbox.z) < 0.05);
    const flat = list.every((m) => m.bbox && Math.max(m.bbox.x, m.bbox.y, m.bbox.z) < 0.15);
    if (thin || flat) {
      console.log(`  ℹ key ${key} thin/flat bbox: ${list.map((m) => JSON.stringify(m.bbox)).join(' ')}`);
    }
  }

  if (dieType === 'd10') {
    if (!byKey.has(5)) console.log('  ⚠ No d10_face_5 — result 5 cannot map');
    if (byKey.has(2) && byKey.get(2).length > 1) {
      console.log('  ⚠ d10_face_6.001 parses as key 2 (Blender suffix rule) — rename to d10_face_6');
    }
  }
}
