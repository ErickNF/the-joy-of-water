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

// --- per-source normalizations (see plan): -------------------------------
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
  };
}

function snowpackSeries(s) {
  const max = Math.max(...s.points.map(([, v]) => v ?? 0), 0.1);
  const values = s.points.map(([, v]) => (v === null ? null : Math.max(v, 0) / max));
  return {
    label: s.label,
    info: `${fmt(s.elevationFt)} ft · peak ${fmt(max, 1)} in SWE`,
    values,
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
  };
}

function reservoirSeries(s) {
  const max = Math.max(...s.points.map(([, v]) => v ?? 0), 1);
  const denom = s.capacityAf ?? max;
  const values = s.points.map(([, v]) => (v === null ? null : Math.min(v / denom, 1)));
  const now = latest(s.points);
  let info = now === null ? 'no recent data' : `${fmt(now)} acre-feet`;
  if (now !== null && s.capacityAf) info += ` · ${((100 * now) / s.capacityAf).toFixed(1)}% of capacity`;
  return { label: `${s.label} Reservoir`, info, values };
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
  };
}

export function buildCategoryViews({ precipitation, snowpack, streamflow, reservoirs, groundwater }) {
  return {
    precipitation: [{ title: null, amplitude: 1.0, series: precipitation.series.map(precipSeries) }],
    snowpack: [{ title: null, amplitude: 1.0, series: snowpack.series.map(snowpackSeries) }],
    streamflow: [{ title: null, amplitude: 1.0, series: streamflow.series.map(streamSeries) }],
    storage: [{ title: null, amplitude: 0.85, series: reservoirs.series.map(reservoirSeries) }],
    groundwater: [{ title: null, amplitude: 0.55, series: groundwater.series.map(groundwaterSeries) }],
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

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
