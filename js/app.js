import { renderJoyplot } from './ridgeline.js';
import { buildCategoryViews, buildCenturyView } from './views.js';

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

// Sparse category views get capped, centered row spacing; Otowi keeps the
// full-height layout that the century view was tuned on.
const views = {
  precipitation: { groups: categoryViews.precipitation, opts: { maxRowGap: 26, centerBlock: true } },
  snowpack: { groups: categoryViews.snowpack, opts: { maxRowGap: 26, centerBlock: true } },
  streamflow: { groups: categoryViews.streamflow, opts: { maxRowGap: 26, centerBlock: true } },
  storage: { groups: categoryViews.storage, opts: { maxRowGap: 26, centerBlock: true } },
  groundwater: { groups: categoryViews.groundwater, opts: { maxRowGap: 26, centerBlock: true } },
  otowi: { groups: buildCenturyView(century), opts: {} },
};

const restingInfo = {
  precipitation: 'NOAA daily precipitation, 14 weather stations north to south — past 12 months',
  snowpack: 'NRCS SNOTEL snow water equivalent, 10 mountain stations — past 12 months',
  streamflow: 'USGS daily streamflow, 16 gauges — past 12 months',
  storage: 'Reclamation reservoir storage, drawn as fraction of capacity — past 12 months',
  groundwater: 'USGS–ABCWUA well levels, Albuquerque Basin — past 12 months',
  otowi: `${century.label} — one line per year, ${Object.keys(century.years).length} years`,
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

// hover: map mouse to viewBox coords, hit-test ridges
svg.addEventListener('mousemove', (e) => {
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const hit = controller?.hitTest(pt.x, pt.y) ?? null;
  controller?.setActive(hit);
  if (hit) {
    infoEl.textContent = `${hit.series.label} · ${hit.series.info}`;
    infoEl.classList.add('active');
  } else {
    infoEl.textContent = restingInfo[currentView];
    infoEl.classList.remove('active');
  }
});
svg.addEventListener('mouseleave', () => {
  controller?.setActive(null);
  infoEl.textContent = restingInfo[currentView];
  infoEl.classList.remove('active');
});

const snapshot = manifest.generated?.slice(0, 10) ?? 'unknown';
footerEl.textContent =
  `NOAA GHCN · NRCS SNOTEL · USGS Water Data · Bureau of Reclamation RISE · ` +
  `USGS–ABCWUA cooperative groundwater network — snapshot ${snapshot}`;

show('precipitation');
