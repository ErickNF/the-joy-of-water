import { renderJoyplot } from './ridgeline.js';
import { buildCategoryViews, buildCenturyView, buildMonthTicks, bucketRange } from './views.js';

const svg = document.getElementById('plot');
const infoEl = document.getElementById('info');
const footerEl = document.getElementById('sources');
const viewButtons = document.querySelectorAll('#toggle button[data-view]');
const labelsButton = document.getElementById('labels-toggle');

async function loadJSON(name) {
  const res = await fetch(`data/${name}.json`);
  if (!res.ok) throw new Error(`failed to load data/${name}.json (${res.status})`);
  return res.json();
}

const [precipitation, snowpack, streamflow, reservoirs, groundwater, century, manifest] =
  await Promise.all(
    ['precipitation', 'snowpack', 'streamflow', 'reservoirs', 'groundwater', 'century', 'manifest'].map(loadJSON)
  );

const categoryViews = buildCategoryViews({ precipitation, snowpack, streamflow, reservoirs, groundwater });

// All category views share the same bucket-date axis; Otowi keeps the
// full-height layout the century view was tuned on.
const monthTicks = buildMonthTicks(categoryViews.streamflow[0].series[0].dates);
const catOpts = { plotTop: 70, maxRowGap: 26, fitHeight: true, monthTicks };

const views = {
  precipitation: { groups: categoryViews.precipitation, opts: catOpts },
  snowpack: { groups: categoryViews.snowpack, opts: catOpts },
  streamflow: { groups: categoryViews.streamflow, opts: catOpts },
  storage: { groups: categoryViews.storage, opts: catOpts },
  groundwater: { groups: categoryViews.groundwater, opts: catOpts },
  otowi: { groups: buildCenturyView(century), opts: {} },
};

const restingInfo = {
  precipitation: 'NOAA daily precipitation, inches, past 12 months',
  snowpack: 'NRCS SNOTEL snow water equivalent, inches, past 12 months',
  streamflow: 'USGS daily streamflow, cubic feet per second, past 12 months',
  storage: 'Reclamation reservoir storage, acre-feet, past 12 months',
  groundwater: 'USGS–ABCWUA depth to groundwater, feet, past 12 months',
  otowi: `${century.label}`,
};

let controller = null;
let currentView = 'precipitation';

function show(viewName) {
  currentView = viewName;
  const v = views[viewName];
  controller = renderJoyplot(svg, v.groups, v.opts);
  infoEl.textContent = restingInfo[viewName];
  infoEl.classList.remove('active');
  for (const b of viewButtons) b.classList.toggle('on', b.dataset.view === viewName);
}

for (const b of viewButtons) b.addEventListener('click', () => show(b.dataset.view));

labelsButton.addEventListener('click', () => {
  const on = svg.classList.toggle('labels');
  labelsButton.classList.toggle('on', on);
});

// Download the current view as a self-contained vector file: styles inlined,
// black field included, current LABELS state respected.
document.getElementById('svg-export').addEventListener('click', () => {
  const NS = 'http://www.w3.org/2000/svg';
  const clone = svg.cloneNode(true);
  const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
  clone.setAttribute('xmlns', NS);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.classList.remove('hovering');
  for (const n of clone.querySelectorAll('.active')) n.classList.remove('active');

  const field = document.createElementNS(NS, 'rect');
  field.setAttribute('width', w);
  field.setAttribute('height', h);
  field.setAttribute('fill', '#000');
  clone.insertBefore(field, clone.firstChild);

  const style = document.createElementNS(NS, 'style');
  style.textContent = `
    text { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
    .ridge-fill { fill: #000; }
    .ridge-stroke { stroke: #f2f2f2; stroke-width: 1.1; stroke-linejoin: round; stroke-linecap: round; fill: none; }
    .group-title { fill: #555; font-size: 10px; letter-spacing: 0.25em; }
    .row-tick { fill: #444; font-size: 10px; letter-spacing: 0.1em; }
    .month-tick { fill: #3d3d3d; font-size: 9px; letter-spacing: 0.18em; }
    .hover-dot { display: none; }
    .site-label { fill: #555; font-size: 8.5px; letter-spacing: 0.06em; display: ${svg.classList.contains('labels') ? 'block' : 'none'}; }`;
  clone.insertBefore(style, field);

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `the-joy-of-water-${currentView}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// hover: map mouse to viewBox coords, hit-test ridges, read out the value
svg.addEventListener('mousemove', (e) => {
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const hit = controller?.hitTest(pt.x, pt.y) ?? null;
  controller?.setActive(hit?.ref ?? null);
  if (currentView !== 'otowi') controller?.setDot(hit?.ref ?? null, hit?.index);
  if (hit) {
    const s = hit.ref.series;
    infoEl.textContent =
      currentView === 'otowi' || s.raw?.[hit.index] === null
        ? `${s.label} · ${s.info}`
        : `${s.label} · ${bucketRange(s.dates[hit.index])} · ${s.fmtValue(s.raw[hit.index])}`;
    infoEl.classList.add('active');
  } else {
    infoEl.textContent = restingInfo[currentView];
    infoEl.classList.remove('active');
  }
});
svg.addEventListener('mouseleave', () => {
  controller?.setActive(null);
  controller?.setDot(null);
  infoEl.textContent = restingInfo[currentView];
  infoEl.classList.remove('active');
});

const snapshot = manifest.generated?.slice(0, 10) ?? 'unknown';
footerEl.textContent =
  `NOAA GHCN · NRCS SNOTEL · USGS Water Data · Bureau of Reclamation RISE · ` +
  `USGS–ABCWUA cooperative groundwater network — snapshot ${snapshot}`;

show('precipitation');
