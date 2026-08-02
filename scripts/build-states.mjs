// One-time asset build: extract New Mexico and Colorado outlines from a public
// US states GeoJSON, simplify them, and write data/states.json for the map.
//
// Re-run only if the outlines ever need rebuilding:
//   node scripts/build-states.mjs

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCE =
  'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/main/data/geojson/us-states.json';
const FALLBACK =
  'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';
const WANT = { 'New Mexico': 'NM', Colorado: 'CO' };
const TOLERANCE = 0.008; // degrees, ~800 m — plenty for a thumbnail outline

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'states.json');

function perpDistance(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const cx = ax + Math.max(0, Math.min(1, t)) * dx;
  const cy = ay + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(px - cx, py - cy);
}

// Ramer–Douglas–Peucker
function simplify(points, tol) {
  if (points.length < 3) return points;
  let maxDist = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist <= tol) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, index + 1), tol).slice(0, -1),
    ...simplify(points.slice(index), tol),
  ];
}

const round = (ring) => ring.map(([lon, lat]) => [Number(lon.toFixed(3)), Number(lat.toFixed(3))]);

async function getSource() {
  for (const url of [SOURCE, FALLBACK]) {
    const res = await fetch(url);
    if (res.ok) return res.json();
  }
  throw new Error('could not fetch the source GeoJSON');
}

const geo = await getSource();
const states = {};
let before = 0, after = 0;

for (const feature of geo.features) {
  const code = WANT[feature.properties?.name];
  if (!code) continue;
  const g = feature.geometry;
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const rings = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      before += ring.length;
      const simplified = round(simplify(ring, TOLERANCE));
      after += simplified.length;
      if (simplified.length > 3) rings.push(simplified);
    }
  }
  states[code] = rings;
  console.log(`${code}: ${rings.length} ring(s), ${rings.reduce((a, r) => a + r.length, 0)} points`);
}

for (const code of Object.values(WANT)) {
  if (!states[code]) throw new Error(`missing ${code} in source data`);
}

await writeFile(
  OUT,
  JSON.stringify({
    note: 'State outlines for the site map. Rebuild with scripts/build-states.mjs',
    source: SOURCE,
    simplifiedToleranceDegrees: TOLERANCE,
    states,
  })
);
console.log(`vertices ${before} -> ${after}; wrote ${OUT}`);
