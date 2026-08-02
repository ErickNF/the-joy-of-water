// One-time asset build for the locator map: state outlines, Bernalillo County,
// and the major river centerlines, all clipped to the New Mexico region and
// simplified hard (the map renders about 140 px wide).
//
//   node scripts/build-basemap.mjs

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCES = {
  states: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
  counties: 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json',
  // Natural Earth splits rivers across two files: the global set carries the
  // major rivers (Rio Grande, Pecos, Gila), the North America set the rest.
  rivers:
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson',
  riversNA:
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_north_america.geojson',
};

const WANT_STATES = { 'New Mexico': 'NM', Colorado: 'CO' };
const BERNALILLO_FIPS = '35001';

// Rivers that read at thumbnail size. Natural Earth names vary slightly, so
// these are matched as case-insensitive substrings.
const WANT_RIVERS = [
  'Rio Grande',
  'Pecos',
  'Canadian',
  'San Juan',
  'Animas',
  'Gila',
  'Chama',
  'Conejos',
  'Puerco',
  'San Francisco',
];

const REGION = { minLon: -109.4, maxLon: -102.6, minLat: 31.0, maxLat: 41.3 };
const TOL_BOUNDARY = 0.008; // ~800 m
const TOL_RIVER = 0.02; // ~2 km

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'basemap.json');

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
const inRegion = ([lon, lat]) =>
  lon >= REGION.minLon && lon <= REGION.maxLon && lat >= REGION.minLat && lat <= REGION.maxLat;

// Keep only the stretches of a line that fall inside the region, carrying one
// point past each edge so segments still reach the border instead of stopping short.
function clipToRegion(line) {
  const runs = [];
  let run = [];
  for (let i = 0; i < line.length; i++) {
    if (inRegion(line[i])) {
      if (!run.length && i > 0) run.push(line[i - 1]);
      run.push(line[i]);
    } else if (run.length) {
      run.push(line[i]);
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

const getJSON = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json();
};

const linesOf = (geometry) =>
  geometry?.type === 'LineString' ? [geometry.coordinates]
  : geometry?.type === 'MultiLineString' ? geometry.coordinates
  : [];

const ringsOf = (geometry) =>
  (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flat();

// --- states ---------------------------------------------------------------
const stateGeo = await getJSON(SOURCES.states);
const states = {};
for (const f of stateGeo.features) {
  const code = WANT_STATES[f.properties?.name];
  if (!code) continue;
  states[code] = ringsOf(f.geometry)
    .map((r) => round(simplify(r, TOL_BOUNDARY)))
    .filter((r) => r.length > 3);
  console.log(`${code}: ${states[code].reduce((a, r) => a + r.length, 0)} points`);
}

// --- Bernalillo County ----------------------------------------------------
const countyGeo = await getJSON(SOURCES.counties);
const bern = countyGeo.features.find((f) => f.id === BERNALILLO_FIPS);
if (!bern) throw new Error('Bernalillo County (FIPS 35001) not found');
const counties = {
  bernalillo: ringsOf(bern.geometry)
    .map((r) => round(simplify(r, TOL_BOUNDARY)))
    .filter((r) => r.length > 3),
};
console.log(`Bernalillo: ${counties.bernalillo.reduce((a, r) => a + r.length, 0)} points`);

// --- rivers ---------------------------------------------------------------
const riverFiles = await Promise.all([getJSON(SOURCES.rivers), getJSON(SOURCES.riversNA)]);
const riverFeatures = riverFiles.flatMap((g) => g.features);

// Report every named river that touches the region, so the allowlist below
// can be curated against what the source actually offers.
const available = new Set();
for (const f of riverFeatures) {
  const name = f.properties?.name ?? f.properties?.name_en ?? '';
  if (!name) continue;
  if (linesOf(f.geometry).some((line) => line.some(inRegion))) available.add(name);
}
console.log(`named rivers touching the region: ${[...available].sort().join(', ')}`);

const rivers = [];
const kept = new Set();
for (const f of riverFeatures) {
  const name = f.properties?.name ?? f.properties?.name_en ?? '';
  if (!WANT_RIVERS.some((w) => name.toLowerCase().includes(w.toLowerCase()))) continue;
  for (const line of linesOf(f.geometry)) {
    for (const run of clipToRegion(line)) {
      const simplified = round(simplify(run, TOL_RIVER));
      if (simplified.length >= 2) {
        rivers.push(simplified);
        kept.add(name);
      }
    }
  }
}
console.log(`rivers: ${rivers.length} segments, ${rivers.reduce((a, r) => a + r.length, 0)} points`);
console.log(`  names: ${[...kept].sort().join(', ')}`);

await writeFile(
  OUT,
  JSON.stringify({
    note: 'Locator map geometry. Rebuild with scripts/build-basemap.mjs',
    sources: SOURCES,
    states,
    counties,
    rivers,
  })
);
console.log(`wrote ${OUT}`);
