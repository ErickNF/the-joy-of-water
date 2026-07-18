// Joy Division Water — data snapshot fetcher
// Pulls NM water data from USGS, Reclamation RISE, and NRCS AWDB into data/*.json.
// Zero dependencies; requires Node 18+ (built-in fetch).
//
// Usage: node scripts/fetch-data.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const USGS = 'https://api.waterdata.usgs.gov/ogcapi/v0';
const RISE = 'https://data.usbr.gov/rise/api';
const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1';
const NCEI = 'https://www.ncei.noaa.gov/access/services/data/v1';

// ---------------------------------------------------------------- config

// Watershed slugs: san-juan | rio-grande | pecos | canadian | arkansas | gila.
// (No active Arkansas-basin data exists — the last Dry Cimarron gage was
// discontinued in 2024 — so that group currently appears in no view.)

// NOAA GHCN-Daily stations (NCEI daily-summaries), verified live 2026-07,
// ordered north -> south.
const GHCN_STATIONS = [
  { id: 'USC00291664', label: 'Chama', watershed: 'rio-grande' },
  { id: 'USW00023090', label: 'Farmington', watershed: 'san-juan' },
  { id: 'USW00023051', label: 'Clayton', watershed: 'canadian' },
  { id: 'USW00023054', label: 'Las Vegas', watershed: 'pecos' },
  { id: 'USW00023049', label: 'Santa Fe', watershed: 'rio-grande' },
  { id: 'USW00023048', label: 'Tucumcari', watershed: 'canadian' },
  { id: 'USW00023050', label: 'Albuquerque', watershed: 'rio-grande' },
  { id: 'USW00023009', label: 'Roswell', watershed: 'pecos' },
  { id: 'USW00093045', label: 'Truth or Consequences', watershed: 'rio-grande' },
  { id: 'USC00290600', label: 'Artesia', watershed: 'pecos' },
  { id: 'USW00093033', label: 'Carlsbad', watershed: 'pecos' },
  { id: 'USC00298535', label: 'Las Cruces', watershed: 'rio-grande' },
];

// USGS stream gages, ordered roughly north -> south within each basin.
const STREAM_GAGES = [
  { id: 'USGS-08279500', label: 'Rio Grande at Embudo', watershed: 'rio-grande' },
  { id: 'USGS-08290000', label: 'Rio Chama near Chamita', watershed: 'rio-grande' },
  { id: 'USGS-08313000', label: 'Rio Grande at Otowi Bridge', watershed: 'rio-grande' },
  { id: 'USGS-08317400', label: 'Rio Grande below Cochiti Dam', watershed: 'rio-grande' },
  { id: 'USGS-08330000', label: 'Rio Grande at Albuquerque', watershed: 'rio-grande' },
  { id: 'USGS-08354900', label: 'Rio Grande Floodway at San Acacia', watershed: 'rio-grande' },
  { id: 'USGS-08358400', label: 'Rio Grande Floodway at San Marcial', watershed: 'rio-grande' },
  { id: 'USGS-08361000', label: 'Rio Grande below Elephant Butte Dam', watershed: 'rio-grande' },
  { id: 'USGS-08378500', label: 'Pecos River near Pecos', watershed: 'pecos' },
  { id: 'USGS-08383500', label: 'Pecos River near Puerto de Luna', watershed: 'pecos' },
  { id: 'USGS-08396500', label: 'Pecos River near Artesia', watershed: 'pecos' },
  { id: 'USGS-09355500', label: 'San Juan River near Archuleta', watershed: 'san-juan' },
  { id: 'USGS-09365000', label: 'San Juan River at Farmington', watershed: 'san-juan' },
  { id: 'USGS-09368000', label: 'San Juan River at Shiprock', watershed: 'san-juan' },
  { id: 'USGS-07221500', label: 'Canadian River near Sanchez', watershed: 'canadian' },
  { id: 'USGS-07227000', label: 'Canadian River at Logan', watershed: 'canadian' },
  { id: 'USGS-09430500', label: 'Gila River near Gila', watershed: 'gila' },
];

// RISE daily Lake/Reservoir Storage catalog items (af). Capacities are
// approximate active capacities from Reclamation; omitted where uncertain.
// (Conchas and Ute on the Canadian are USACE/state reservoirs — not in RISE.)
const RESERVOIRS = [
  { itemId: 420, label: 'Heron', capacityAf: 199113, watershed: 'rio-grande' },
  { itemId: 335, label: 'El Vado', capacityAf: 186250, watershed: 'rio-grande' },
  { itemId: 613, label: 'Navajo', capacityAf: 1708600, watershed: 'san-juan' },
  { itemId: 329, label: 'Elephant Butte', capacityAf: 1973878, watershed: 'rio-grande' },
  { itemId: 209, label: 'Caballo', capacityAf: 224933, watershed: 'rio-grande' },
  { itemId: 784, label: 'Sumner', capacityAf: null, watershed: 'pecos' },
  { itemId: 203, label: 'Brantley', capacityAf: null, watershed: 'pecos' },
];

// SNOTEL: HUC subregion prefix -> watershed, for every NM and CO station
// that drains to a New Mexico river (CO headwaters of the Rio Grande and
// San Juan count; CO's Arkansas headwaters never reach NM and don't).
const SNOTEL_HUC_WATERSHEDS = {
  1408: 'san-juan',
  1301: 'rio-grande',
  1302: 'rio-grande',
  1306: 'pecos',
  1307: 'pecos',
  1108: 'canadian',
  1109: 'canadian',
  1110: 'canadian',
  1504: 'gila',
};

const GW_BBOX = '-107.2,34.85,-106.2,35.25'; // Albuquerque Basin
const GW_MAX_WELLS = 14;

const NOW_DAYS = 366; // window for the "Now" view
const CENTURY_SITE = { id: 'USGS-08313000', label: 'Rio Grande at Otowi Bridge' };
const CENTURY_START = '1895-01-01';

// ---------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);

const today = new Date();
const nowEnd = iso(today);
const nowStart = iso(new Date(today.getTime() - NOW_DAYS * 86400e3));

const failures = [];

async function fetchJSON(url, { headers = {}, tries = 4 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return await res.json();
    } catch (err) {
      if (err.fatal || attempt >= tries) throw err;
      await sleep(1500 * attempt);
    }
  }
}

// Continuous daily axis from start..end; dates absent from `map` become null.
function padDaily(map, start, end) {
  const points = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400e3) {
    const d = iso(new Date(t));
    points.push([d, map.has(d) ? map.get(d) : null]);
  }
  return points;
}

const round4 = (v) => (v === null ? null : Number(v.toPrecision(4)));

// Collapse daily points into 3-day buckets (mean or sum), keeping spikes small files.
function downsample(points, mode = 'mean') {
  const out = [];
  for (let i = 0; i < points.length; i += 3) {
    const bucket = points.slice(i, i + 3);
    const vals = bucket.map((p) => p[1]).filter((v) => v !== null);
    const date = bucket[0][0];
    if (!vals.length) {
      out.push([date, null]);
    } else if (mode === 'sum') {
      out.push([date, round4(vals.reduce((a, b) => a + b, 0))]);
    } else {
      out.push([date, round4(vals.reduce((a, b) => a + b, 0) / vals.length)]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- USGS

// All daily values for one site/parameter, following OGC pagination.
async function usgsDaily(siteId, parameterCode, start, end) {
  const map = new Map();
  let url =
    `${USGS}/collections/daily/items?monitoring_location_id=${siteId}` +
    `&parameter_code=${parameterCode}&statistic_id=00003` +
    `&datetime=${start}/${end}&f=json&limit=10000`;
  while (url) {
    const page = await fetchJSON(url);
    for (const f of page.features ?? []) {
      const p = f.properties;
      if (p.value !== null && p.value !== undefined && p.value !== '') {
        map.set(p.time, Number(p.value));
      }
    }
    url = (page.links ?? []).find((l) => l.rel === 'next')?.href ?? null;
    if (url) await sleep(400);
  }
  return map;
}

async function fetchStreamflow() {
  const series = [];
  for (const g of STREAM_GAGES) {
    try {
      const map = await usgsDaily(g.id, '00060', nowStart, nowEnd);
      if (!map.size) throw new Error('no data returned');
      series.push({
        id: g.id,
        label: g.label,
        unit: 'cfs',
        watershed: g.watershed,
        points: downsample(padDaily(map, nowStart, nowEnd)),
      });
      console.log(`  streamflow ${g.label}: ${map.size} days`);
    } catch (err) {
      failures.push(`streamflow ${g.id} (${g.label}): ${err.message}`);
      console.warn(`  !! streamflow ${g.label}: ${err.message}`);
    }
    await sleep(400);
  }
  return { fetched: nowEnd, series };
}

async function fetchGroundwater() {
  // Discover Albuquerque Basin wells with current daily-mean depth-to-water
  // records (the USGS/ABCWUA cooperative monitoring network stores its
  // continuous recorders in NWIS). Nested piezometers share a 13-digit
  // lat-lon site prefix; keep one per nest (longest record).
  const meta = await fetchJSON(
    `${USGS}/collections/time-series-metadata/items?parameter_code=72019&bbox=${GW_BBOX}&f=json&limit=500`
  );
  const cutoff = iso(new Date(today.getTime() - 120 * 86400e3));
  const byNest = new Map();
  for (const f of meta.features ?? []) {
    const p = f.properties;
    if (p.parameter_code !== '72019' || p.computation_identifier !== 'Mean') continue;
    if (!p.end || p.end.slice(0, 10) < cutoff) continue;
    const nest = p.monitoring_location_id.replace('USGS-', '').slice(0, 13);
    const cur = byNest.get(nest);
    if (!cur || p.begin < cur.begin) byNest.set(nest, { id: p.monitoring_location_id, begin: p.begin });
  }
  const wells = [...byNest.values()].sort((a, b) => a.begin.localeCompare(b.begin)).slice(0, GW_MAX_WELLS);
  console.log(`  groundwater: ${wells.length} wells selected from ${byNest.size} nests`);

  const series = [];
  for (const w of wells) {
    try {
      const locPage = await fetchJSON(`${USGS}/collections/monitoring-locations/items/${w.id}?f=json`);
      const name = locPage.properties?.monitoring_location_name ?? w.id;
      await sleep(400);
      const map = await usgsDaily(w.id, '72019', nowStart, nowEnd);
      if (!map.size) throw new Error('no data returned');
      series.push({
        id: w.id,
        label: name,
        unit: 'ft below surface',
        watershed: 'rio-grande',
        points: downsample(padDaily(map, nowStart, nowEnd)),
      });
      console.log(`  groundwater ${name}: ${map.size} days`);
    } catch (err) {
      failures.push(`groundwater ${w.id}: ${err.message}`);
      console.warn(`  !! groundwater ${w.id}: ${err.message}`);
    }
    await sleep(400);
  }
  return { fetched: nowEnd, series };
}

async function fetchCentury() {
  console.log(`  century: fetching ${CENTURY_SITE.label} ${CENTURY_START}..${nowEnd} (takes a minute)`);
  const map = await usgsDaily(CENTURY_SITE.id, '00060', CENTURY_START, nowEnd);
  console.log(`  century: ${map.size} daily values`);
  // Reshape to {year: [365 values]}, day-of-year indexed; Feb 29 dropped.
  const years = {};
  for (const [date, value] of map) {
    const [y, m, d] = date.split('-').map(Number);
    if (m === 2 && d === 29) continue;
    const key = String(y);
    if (!years[key]) years[key] = new Array(365).fill(null);
    const DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    years[key][DAYS[m - 1] + d - 1] = round4(value);
  }
  // Drop years with almost no record (partial first/last years are kept if >60 days).
  for (const y of Object.keys(years)) {
    if (years[y].filter((v) => v !== null).length < 60) delete years[y];
  }
  return { site: CENTURY_SITE.id, label: CENTURY_SITE.label, unit: 'cfs', fetched: nowEnd, years };
}

// ---------------------------------------------------------------- RISE

async function fetchReservoirs() {
  const series = [];
  for (const r of RESERVOIRS) {
    try {
      const map = new Map();
      let url =
        `${RISE}/result?itemId=${r.itemId}&dateTime%5Bafter%5D=${nowStart}` +
        `&dateTime%5Bbefore%5D=${nowEnd}&itemsPerPage=400`;
      while (url) {
        const page = await fetchJSON(url, { headers: { Accept: 'application/vnd.api+json' } });
        for (const row of page.data ?? []) {
          const a = row.attributes;
          if (a.result !== null) map.set(a.dateTime.slice(0, 10), Number(a.result));
        }
        const next = page.links?.next;
        url = next ? (next.startsWith('http') ? next : `https://data.usbr.gov${next}`) : null;
        if (url) await sleep(400);
      }
      if (!map.size) throw new Error('no data returned');
      series.push({
        id: `RISE-${r.itemId}`,
        label: r.label,
        unit: 'af',
        capacityAf: r.capacityAf,
        watershed: r.watershed,
        points: downsample(padDaily(map, nowStart, nowEnd)),
      });
      console.log(`  reservoir ${r.label}: ${map.size} days`);
    } catch (err) {
      failures.push(`reservoir ${r.label} (item ${r.itemId}): ${err.message}`);
      console.warn(`  !! reservoir ${r.label}: ${err.message}`);
    }
    await sleep(400);
  }
  return { fetched: nowEnd, series };
}

// ---------------------------------------------------------------- AWDB

async function fetchSnowpack() {
  const stations = await fetchJSON(`${AWDB}/stations?stationTriplets=*:NM:SNTL,*:CO:SNTL`);
  // Keep every active NM/CO station whose HUC drains to a NM watershed,
  // ordered by watershed then north -> south.
  const order = ['san-juan', 'rio-grande', 'pecos', 'canadian', 'arkansas', 'gila'];
  const picked = stations
    .filter((s) => s.endDate > nowEnd && SNOTEL_HUC_WATERSHEDS[(s.huc ?? '').slice(0, 4)])
    .map((s) => ({ ...s, watershed: SNOTEL_HUC_WATERSHEDS[s.huc.slice(0, 4)] }))
    .sort((a, b) =>
      order.indexOf(a.watershed) - order.indexOf(b.watershed) || b.latitude - a.latitude
    );
  console.log(`  snowpack: ${picked.length} SNOTEL stations (of ${stations.length} in NM+CO)`);

  // Batch the WTEQ request in chunks to keep URLs comfortable.
  const byTriplet = new Map();
  for (let i = 0; i < picked.length; i += 35) {
    const triplets = picked.slice(i, i + 35).map((s) => s.stationTriplet).join(',');
    const data = await fetchJSON(
      `${AWDB}/data?stationTriplets=${encodeURIComponent(triplets)}&elements=WTEQ&duration=DAILY` +
        `&beginDate=${nowStart}&endDate=${nowEnd}`
    );
    for (const rec of data ?? []) byTriplet.set(rec.stationTriplet, rec);
    await sleep(400);
  }

  const series = [];
  for (const st of picked) {
    const values = byTriplet.get(st.stationTriplet)?.data?.[0]?.values ?? [];
    if (!values.length) {
      failures.push(`snowpack ${st.stationTriplet} (${st.name}): no data returned`);
      console.warn(`  !! snowpack ${st.name}: no data returned`);
      continue;
    }
    const map = new Map(values.filter((v) => v.value !== null).map((v) => [v.date, v.value]));
    series.push({
      id: st.stationTriplet,
      label: st.stateCode === 'CO' ? `${st.name} SNOTEL (CO)` : `${st.name} SNOTEL`,
      unit: 'in SWE',
      elevationFt: st.elevation,
      watershed: st.watershed,
      points: downsample(padDaily(map, nowStart, nowEnd)),
    });
  }
  console.log(`  snowpack: ${series.length} stations fetched`);
  return { fetched: nowEnd, series };
}

// ---------------------------------------------------------------- NCEI

async function fetchPrecipitation() {
  const series = [];
  for (const st of GHCN_STATIONS) {
    try {
      const rows = await fetchJSON(
        `${NCEI}?dataset=daily-summaries&stations=${st.id}&dataTypes=PRCP` +
          `&startDate=${nowStart}&endDate=${nowEnd}&format=json&units=standard`
      );
      const map = new Map();
      for (const row of rows ?? []) {
        const v = Number(row.PRCP);
        if (row.DATE && Number.isFinite(v)) map.set(row.DATE, v);
      }
      if (!map.size) throw new Error('no data returned');
      series.push({
        id: st.id,
        label: st.label,
        unit: 'in',
        watershed: st.watershed,
        points: downsample(padDaily(map, nowStart, nowEnd), 'sum'),
      });
      console.log(`  precipitation ${st.label}: ${map.size} days`);
    } catch (err) {
      failures.push(`precipitation ${st.id} (${st.label}): ${err.message}`);
      console.warn(`  !! precipitation ${st.label}: ${err.message}`);
    }
    await sleep(400);
  }
  return { fetched: nowEnd, series };
}

// ---------------------------------------------------------------- main

console.log(`Fetching snapshots for ${nowStart}..${nowEnd}`);
await mkdir(DATA_DIR, { recursive: true });

const precipitation = await fetchPrecipitation();
const snowpack = await fetchSnowpack();
const streamflow = await fetchStreamflow();
const reservoirs = await fetchReservoirs();
const groundwater = await fetchGroundwater();
const century = await fetchCentury();

const write = (name, obj) => writeFile(path.join(DATA_DIR, name), JSON.stringify(obj));
await write('precipitation.json', precipitation);
await write('snowpack.json', snowpack);
await write('streamflow.json', streamflow);
await write('reservoirs.json', reservoirs);
await write('groundwater.json', groundwater);
await write('century.json', century);

const counts = {
  precipitation: precipitation.series.length,
  snowpack: snowpack.series.length,
  streamflow: streamflow.series.length,
  reservoirs: reservoirs.series.length,
  groundwater: groundwater.series.length,
  centuryYears: Object.keys(century.years).length,
};
await write('manifest.json', { generated: new Date().toISOString(), window: [nowStart, nowEnd], counts, failures });

console.log('\nDone.', JSON.stringify(counts));
if (failures.length) {
  console.warn(`${failures.length} failure(s):`);
  for (const f of failures) console.warn(`  - ${f}`);
}
