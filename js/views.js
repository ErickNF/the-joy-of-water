// Builds render-ready view configs (normalized 0..1 ridge values + hover
// info strings) from the data/*.json snapshots.

const fmt = (v, digits = 0) =>
  v.toLocaleString('en-US', { maximumFractionDigits: digits });

const latest = (points) => {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i][1] !== null) return points[i][1];
  }
  return null;
};

const percentile = (values, p) => {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  if (!sorted.length) return 1;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

// --- per-source normalizations: ------------------------------------------
// precip: clamp to per-station p99 so one storm doesn't flatten the ridge
// snowpack: per-station max SWE -> seasonal accumulation curves
// streamflow: sqrt so monsoon/runoff spikes don't erase base flow
// reservoirs: fraction of capacity where known (Elephant Butte's flat line
//             IS the story), else fraction of period max
// groundwater: negated depth, min-max scaled, gentle amplitude

function precipSeries(s) {
  const cap = Math.max(percentile(s.points.map((p) => p[1]), 0.99), 0.01);
  const values = s.points.map(([, v]) => (v === null ? null : Math.min(v / cap, 1)));
  const total = s.points.reduce((a, [, v]) => a + (v ?? 0), 0);
  return {
    label: s.label,
    info: `${fmt(total, 1)} in over 12 months`,
    values,
    dates: s.points.map((p) => p[0]),
    raw: s.points.map((p) => p[1]),
    fmtValue: (v) => `${fmt(v, 2)} in`,
  };
}

function snowpackSeries(s) {
  const max = Math.max(...s.points.map(([, v]) => v ?? 0), 0.1);
  const values = s.points.map(([, v]) => (v === null ? null : Math.max(v, 0) / max));
  return {
    label: s.label,
    info: `${fmt(s.elevationFt)} ft · peak ${fmt(max, 1)} in SWE`,
    values,
    dates: s.points.map((p) => p[0]),
    raw: s.points.map((p) => p[1]),
    fmtValue: (v) => `${fmt(v, 1)} in SWE`,
  };
}

function streamSeries(s) {
  const max = Math.max(...s.points.map(([, v]) => v ?? 0), 1);
  const values = s.points.map(([, v]) =>
    v === null ? null : Math.sqrt(Math.max(v, 0)) / Math.sqrt(max)
  );
  const now = latest(s.points);
  return {
    label: s.label,
    info: now === null ? 'no recent data' : `latest ${fmt(now)} cfs`,
    values,
    dates: s.points.map((p) => p[0]),
    raw: s.points.map((p) => p[1]),
    fmtValue: (v) => `${fmt(v)} cfs`,
  };
}

function reservoirSeries(s) {
  const max = Math.max(...s.points.map(([, v]) => v ?? 0), 1);
  const denom = s.capacityAf ?? max;
  const values = s.points.map(([, v]) => (v === null ? null : Math.min(v / denom, 1)));
  const now = latest(s.points);
  let info = now === null ? 'no recent data' : `${fmt(now)} acre-feet`;
  if (now !== null && s.capacityAf) info += ` · ${((100 * now) / s.capacityAf).toFixed(1)}% of capacity`;
  return {
    label: `${s.label} Reservoir`,
    info,
    values,
    dates: s.points.map((p) => p[0]),
    raw: s.points.map((p) => p[1]),
    fmtValue: s.capacityAf
      ? (v) => `${fmt(v)} acre-feet · ${((100 * v) / s.capacityAf).toFixed(1)}% of capacity`
      : (v) => `${fmt(v)} acre-feet`,
  };
}

function groundwaterSeries(s) {
  const vals = s.points.map(([, v]) => v).filter((v) => v !== null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(max - min, 0.01);
  // negate depth-to-water so up = more water
  const values = s.points.map(([, v]) => (v === null ? null : (max - v) / span));
  const now = latest(s.points);
  return {
    label: /^\d/.test(s.label) ? s.label.replace(/^\S+\s+/, '') : s.label, // trim township-range prefix
    info: now === null ? 'no recent data' : `depth to water ${fmt(now, 1)} ft`,
    values,
    dates: s.points.map((p) => p[0]),
    raw: s.points.map((p) => p[1]),
    fmtValue: (v) => `${fmt(v, 1)} ft bgs`,
  };
}

// --- watershed grouping ---------------------------------------------------

const WATERSHEDS = [
  ['san-juan', 'SAN JUAN'],
  ['rio-grande', 'RIO GRANDE'],
  ['pecos', 'PECOS'],
  ['canadian', 'CANADIAN'],
  ['arkansas', 'ARKANSAS'],
  ['gila', 'GILA'],
];

function groupByWatershed(seriesList, build, amplitude) {
  return WATERSHEDS.map(([slug, title]) => ({
    title,
    amplitude,
    series: seriesList.filter((s) => s.watershed === slug).map(build),
  })).filter((g) => g.series.length);
}

export function buildCategoryViews({ precipitation, snowpack, streamflow, reservoirs, groundwater }) {
  return {
    precipitation: groupByWatershed(precipitation.series, precipSeries, 1.0),
    snowpack: groupByWatershed(snowpack.series, snowpackSeries, 1.0),
    streamflow: groupByWatershed(streamflow.series, streamSeries, 1.0),
    storage: groupByWatershed(reservoirs.series, reservoirSeries, 0.85),
    groundwater: groupByWatershed(groundwater.series, groundwaterSeries, 0.55),
  };
}

// --- shared x axis --------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

// Subtle month labels at month boundaries along the bucket-date axis.
export function buildMonthTicks(dates) {
  const ticks = [];
  for (let i = 1; i < dates.length; i++) {
    const m = Number(dates[i].slice(5, 7));
    if (m !== Number(dates[i - 1].slice(5, 7))) {
      ticks.push({ frac: i / (dates.length - 1), label: MONTHS[m - 1].toUpperCase() });
    }
  }
  return ticks;
}

// "Jun 23–25" (or "Jun 30 – Jul 2") for the 3-day bucket starting at dateISO.
export function bucketRange(dateISO) {
  const start = new Date(`${dateISO}T00:00:00Z`);
  const end = new Date(start.getTime() + 2 * 86400e3);
  const sM = MONTHS[start.getUTCMonth()], eM = MONTHS[end.getUTCMonth()];
  return sM === eM
    ? `${sM} ${start.getUTCDate()}–${end.getUTCDate()}`
    : `${sM} ${start.getUTCDate()} – ${eM} ${end.getUTCDate()}`;
}

function dayOfYearToDate(i) {
  let m = 11;
  while (MONTH_STARTS[m] > i) m--;
  return `${MONTHS[m]} ${i - MONTH_STARTS[m] + 1}`;
}

export function buildCenturyView(century) {
  const years = Object.keys(century.years).sort();
  const all = years.flatMap((y) => century.years[y]).filter((v) => v !== null);
  const cap = Math.max(percentile(all, 0.998), 1);
  const sqrtCap = Math.sqrt(cap);

  const series = years.map((year) => {
    const raw = century.years[year];
    const values = raw.map((v) =>
      v === null ? null : Math.sqrt(Math.max(Math.min(v, cap), 0)) / sqrtCap
    );
    let peak = -1, peakIdx = -1;
    raw.forEach((v, i) => {
      if (v !== null && v > peak) {
        peak = v;
        peakIdx = i;
      }
    });
    return {
      label: year,
      info: peak >= 0 ? `peak ${fmt(peak)} cfs · ${dayOfYearToDate(peakIdx)}` : 'no data',
      tick: Number(year) % 10 === 0 ? year : null,
      values,
    };
  });

  return [{ title: null, amplitude: 1.3, series }];
}
