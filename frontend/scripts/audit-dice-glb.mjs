/**
 * One-off audit: list GLB mesh names, parsed face keys, hull points, duplicates.
 * Run: node frontend/scripts/audit-dice-glb.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICE_DIR = path.resolve(__dirname, '../public/assets/dice');

const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

const EXPECTED = {
  d4: { min: 1, max: 4, count: 4 },
  d6: { min: 1, max: 6, count: 6 },
  d8: { min: 1, max: 8, count: 8 },
  d10: { min: 0, max: 10, count: 10, zeroIsTen: true },
  d12: { min: 1, max: 12, count: 12 },
  d20: { min: 1, max: 20, count: 20 },
  d100: { min: 0, max: 90, count: 10, step: 10, zeroIsHundred: true },
};

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

/** Minimal GLB JSON chunk parse for mesh/node names only */
function readGlbNames(filePath) {
  const buf = fs.readFileSync(filePath);
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('Not JSON chunk');
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const meshNames = (json.meshes ?? []).map((m, i) => m.name ?? `mesh_${i}`);
  const nodeNames = (json.nodes ?? []).map((n) => n.name ?? '').filter(Boolean);
  return { meshNames, nodeNames, json };
}

for (const dieType of DIE_TYPES) {
  const filePath = path.join(DICE_DIR, `${dieType}.glb`);
  const { meshNames, nodeNames } = readGlbNames(filePath);
  const allNames = [...new Set([...meshNames, ...nodeNames])].sort();

  const faceMeshes = [];
  const insetLike = [];
  const other = [];

  for (const name of allNames) {
    const key = parseFaceNumber(dieType, name);
    if (key != null) {
      faceMeshes.push({ name, key });
      continue;
    }
    if (name.includes('face') || name.includes('Face')) insetLike.push(name);
    else other.push(name);
  }

  const byKey = new Map();
  for (const { name, key } of faceMeshes) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(name);
  }

  const exp = EXPECTED[dieType];
  const keys = [...byKey.keys()].sort((a, b) => a - b);
  const missing = [];
  const duplicates = [...byKey.entries()].filter(([, names]) => names.length > 1);

  if (dieType === 'd100') {
    for (let v = 0; v <= 90; v += 10) {
      if (!byKey.has(v) && !(v === 0 && byKey.has(0))) missing.push(v === 0 ? '0 (→100)' : v);
    }
  } else if (dieType === 'd10') {
    for (let v = 1; v <= 9; v++) if (!byKey.has(v)) missing.push(v);
    if (!byKey.has(10) && !byKey.has(0)) missing.push('10 (need face_0 or face_10)');
  } else {
    for (let v = exp.min; v <= exp.max; v++) if (!byKey.has(v)) missing.push(v);
  }

  const extra = keys.filter((k) => {
    if (dieType === 'd100') return k < 0 || k > 90 || k % 10 !== 0;
    if (dieType === 'd10') return k < 1 || k > 10;
    return k < exp.min || k > exp.max;
  });

  console.log(`\n=== ${dieType}.glb ===`);
  console.log(`  Parsed face markers: ${faceMeshes.length} mesh/node names → ${byKey.size} unique keys`);
  if (duplicates.length) {
    console.log('  ⚠ DUPLICATE keys (multiple meshes per face):');
    duplicates.forEach(([k, names]) => console.log(`    key ${k}: ${names.join(', ')}`));
  }
  if (missing.length) console.log(`  ⚠ Missing keys: ${missing.join(', ')}`);
  if (extra.length) console.log(`  ⚠ Unexpected keys: ${extra.join(', ')}`);

  const insetStillNamed = faceMeshes.filter((f) => {
    const n = f.name.toLowerCase();
    return n.includes('inset') || (n.includes('inner') && !n.includes('frame'));
  });
  if (insetStillNamed.length) {
    console.log('  ⚠ Face-pattern names that look like inset (should rename):');
    insetStillNamed.forEach((f) => console.log(`    ${f.name} → key ${f.key}`));
  }

  const nonFaceWithFaceInName = insetLike.filter((n) => parseFaceNumber(dieType, n) == null);
  if (nonFaceWithFaceInName.length) {
    console.log('  ℹ "face" in name but not parsed (good if inset):');
    nonFaceWithFaceInName.slice(0, 15).forEach((n) => console.log(`    ${n}`));
    if (nonFaceWithFaceInName.length > 15) console.log(`    ... +${nonFaceWithFaceInName.length - 15} more`);
  }

  console.log('  Face keys found:', keys.join(', '));
  console.log('  All objects:', allNames.join(', ') || '(none)');
}
