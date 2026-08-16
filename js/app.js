import { renderJoyplot } from './ridgeline.js';
import { renderLocatorMap } from './statemap.js';
import { buildCategoryViews, buildCenturyView, buildMonthTicks, bucketRange } from './views.js';

const svg = document.getElementById('plot');
const infoEl = document.getElementById('info');
const footerEl = document.getElementById('sources');
const viewButtons = document.querySelectorAll('#toggle button[data-view]');
const labelsButton = document.getElementById('labels-toggle');
const mapButton = document.getElementById('map-toggle');
const locatorEl = document.getElementById('locator');
const locatorSvg = document.getElementById('locator-map');

async function loadJSON(name) {
  const res = await fetch(`data/${name}.json`);
  if (!res.ok) throw new Error(`failed to load data/${name}.json (${res.status})`);
  return res.json();
}

// Filled in by init() at the bottom. Kept module-scoped (rather than loaded
// with a top-level await) so the file parses on older engines — the office
// display runs an iPad stuck on iOS 12, whose Safari predates that syntax.
let precipitation, snowpack, streamflow, reservoirs, groundwater, century, manifest, basemap;
let views, restingInfo;

// Which outline the locator draws for each view.
const MAP_SHAPE = {
  // Draw southern Colorado too, but frame on New Mexico plus the stations.
  snowpack: { codes: ['CO', 'NM'], frameCodes: ['NM'] },
  groundwater: { county: 'bernalillo' },
};
const shapeFor = (viewName) => MAP_SHAPE[viewName] || { codes: ['NM'] };

const VIEW_ORDER = ['precipitation', 'snowpack', 'streamflow', 'storage', 'groundwater', 'otowi'];

function buildViews() {
  const categoryViews = buildCategoryViews({
    precipitation,
    snowpack,
    streamflow,
    reservoirs,
    groundwater,
  });

  // All category views share the same bucket-date axis; Otowi keeps the
  // full-height layout the century view was tuned on.
  const monthTicks = buildMonthTicks(categoryViews.streamflow[0].series[0].dates);
  const catOpts = (extra) =>
    Object.assign({ plotTop: 70, maxRowGap: 26, fitHeight: true, monthTicks }, extra || {});

  views = {
    precipitation: { groups: categoryViews.precipitation, opts: catOpts() },
    snowpack: { groups: categoryViews.snowpack, opts: catOpts() },
    streamflow: { groups: categoryViews.streamflow, opts: catOpts() },
    // Reservoir curves are smooth and slow; give them room so they stop
    // tangling into each other.
    storage: { groups: categoryViews.storage, opts: catOpts({ maxRowGap: 48 }) },
    groundwater: { groups: categoryViews.groundwater, opts: catOpts({ maxRowGap: 34 }) },
    // 126 rows in one block, so a little extra height goes a long way toward
    // keeping the year labels off each other.
    otowi: { groups: buildCenturyView(century), opts: { plotBottom: 1265 } },
  };

  restingInfo = {
    precipitation: 'NOAA daily precipitation, inches, past 12 months',
    snowpack: 'NRCS SNOTEL snow water equivalent, inches, past 12 months',
    streamflow: 'USGS daily streamflow, cubic feet per second, past 12 months',
    storage: 'Reclamation reservoir storage, acre-feet, past 12 months',
    groundwater: 'USGS–ABCWUA depth to groundwater, feet, past 12 months',
    otowi: `${century.label}`,
  };
}

// --- iframe embedding -----------------------------------------------------
// When embedded (e.g. in a Squarespace page), drop the full-viewport minimum
// height and report our content height to the parent so it can size the frame
// to the current view — Storage is short, Otowi is nearly three times taller.

const embedded = window.parent !== window;
if (embedded) document.documentElement.classList.add('embedded');

let heightFrame = null;
function postHeight() {
  if (!embedded) return;
  cancelAnimationFrame(heightFrame);
  heightFrame = requestAnimationFrame(() => {
    // Measure the body box, not documentElement.scrollHeight — the latter
    // never reports less than the viewport, so the frame could only grow.
    window.parent.postMessage(
      { type: 'joy-of-water:height', height: Math.ceil(document.body.getBoundingClientRect().height) },
      '*'
    );
  });
}

if (embedded) {
  // ResizeObserver arrived after the oldest browser we support; without it the
  // frame simply sizes on load and view switches instead of continuously.
  if (typeof ResizeObserver === 'function') new ResizeObserver(postHeight).observe(document.body);
  window.addEventListener('resize', postHeight);
  window.addEventListener('load', postHeight);
}

let controller = null;
let mapControl = null;
let currentView = 'precipitation';
let mapEnabled = true;

const sitesOf = (viewName) => views[viewName].groups.flatMap((g) => g.series);

// The locator lives in its own pinned <svg>, not in the plot, so it stays on
// screen while you hover ridges far down a tall view.
function drawLocator(viewName) {
  mapControl = null;
  locatorSvg.innerHTML = '';
  // Otowi is a single site across 126 years — a locator map says nothing.
  const wanted = viewName !== 'otowi' && mapEnabled;
  locatorEl.style.display = wanted ? '' : 'none';
  if (!wanted) return;
  mapControl = renderLocatorMap(locatorSvg, {
    basemap,
    ...shapeFor(viewName),
    sites: sitesOf(viewName),
    yTop: 3,
    centerX: 78,
    maxWidth: 150,
    maxHeight: viewName === 'snowpack' ? 200 : 155,
  });
  locatorSvg.setAttribute('viewBox', `0 0 156 ${Math.ceil(mapControl.height + 6)}`);
}

function show(viewName) {
  currentView = viewName;
  const v = views[viewName];
  // Century rows sit far closer together than any category view, so its
  // labels take a smaller size.
  svg.classList.toggle('century', viewName === 'otowi');
  controller = renderJoyplot(svg, v.groups, v.opts);
  drawLocator(viewName);
  infoEl.textContent = restingInfo[viewName];
  infoEl.classList.remove('active');
  for (const b of viewButtons) b.classList.toggle('on', b.dataset.view === viewName);
  postHeight();
}

for (const b of viewButtons) b.addEventListener('click', () => show(b.dataset.view));

labelsButton.addEventListener('click', () => {
  const on = svg.classList.toggle('labels');
  labelsButton.classList.toggle('on', on);
});

mapButton.addEventListener('click', () => {
  mapEnabled = !mapEnabled;
  mapButton.classList.toggle('on', mapEnabled);
  drawLocator(currentView);
  postHeight();
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
    .map-outline { fill: none; stroke: #414141; stroke-width: 0.8; }
    .river { fill: none; stroke: #565656; stroke-width: 0.7; stroke-linejoin: round; stroke-linecap: round; }
    .site-dot { fill: #7d7d7d; }
    .site-label { display: ${svg.classList.contains('labels') ? 'block' : 'none'}; }
    .site-name { fill: #6a6a6a; font-size: 10px; letter-spacing: 0.05em; }
    .century .site-name { font-size: 7.5px; letter-spacing: 0.04em; }
    .site-stats { fill: #4d4d4d; font-size: 9px; letter-spacing: 0.03em; }`;
  clone.insertBefore(style, field);

  // The on-screen locator is pinned to the window, so draw a fresh one into
  // the exported file — a printed sheet has no viewport to follow.
  if (currentView !== 'otowi' && mapEnabled) {
    const yTop = h + 18;
    const map = renderLocatorMap(clone, {
      basemap,
      ...shapeFor(currentView),
      sites: sitesOf(currentView),
      yTop,
      centerX: w / 2,
      maxWidth: 300,
      maxHeight: currentView === 'snowpack' ? 215 : 165,
    });
    const tall = Math.ceil(yTop + map.height + 34);
    clone.setAttribute('viewBox', `0 0 ${w} ${tall}`);
    clone.setAttribute('height', tall);
    field.setAttribute('height', tall);
  }

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
  if (!controller) return;
  const hit = controller.hitTest(pt.x, pt.y) || null;
  const ref = hit ? hit.ref : null;
  controller.setActive(ref);
  if (currentView !== 'otowi') controller.setDot(ref, hit ? hit.index : undefined);
  if (mapControl) mapControl.setActive(ref ? ref.series.id : null);
  if (hit) {
    const s = hit.ref.series;
    const bucketMissing = !s.raw || s.raw[hit.index] === null;
    infoEl.textContent =
      currentView === 'otowi' || bucketMissing
        ? `${s.label} · ${s.info}`
        : `${s.label} · ${bucketRange(s.dates[hit.index])} · ${s.fmtValue(s.raw[hit.index])}`;
    infoEl.classList.add('active');
  } else {
    infoEl.textContent = restingInfo[currentView];
    infoEl.classList.remove('active');
  }
});
svg.addEventListener('mouseleave', () => {
  if (controller) {
    controller.setActive(null);
    controller.setDot(null);
  }
  if (mapControl) mapControl.setActive(null);
  infoEl.textContent = restingInfo[currentView];
  infoEl.classList.remove('active');
});

// --- kiosk mode -----------------------------------------------------------
// ?kiosk turns the page into an unattended display: no controls, labels
// always on, views cycling on a timer, and the whole plot scaled to fit the
// screen so nothing needs scrolling. Reloads periodically to pick up the
// daily data refresh.

const KIOSK_VIEW_MS = 25000;
const KIOSK_RELOAD_MS = 6 * 60 * 60 * 1000;

function startKiosk() {
  document.body.classList.add('kiosk');
  // No pointer to hover with, so the labels are the only way to read the plot.
  svg.classList.add('labels');
  labelsButton.classList.add('on');

  let index = 0;
  show(VIEW_ORDER[index]);
  setInterval(() => {
    index = (index + 1) % VIEW_ORDER.length;
    show(VIEW_ORDER[index]);
  }, KIOSK_VIEW_MS);

  // The data bot commits a fresh snapshot every morning; pick it up without
  // anyone touching the iPad.
  setTimeout(() => window.location.reload(), KIOSK_RELOAD_MS);

  // Tapping the screen brings the controls back for a minute.
  document.body.addEventListener('click', () => {
    document.body.classList.remove('kiosk');
    setTimeout(() => document.body.classList.add('kiosk'), 60000);
  });
}

async function init() {
  const files = [
    'precipitation',
    'snowpack',
    'streamflow',
    'reservoirs',
    'groundwater',
    'century',
    'manifest',
    'basemap',
  ];
  const loaded = await Promise.all(files.map(loadJSON));
  precipitation = loaded[0];
  snowpack = loaded[1];
  streamflow = loaded[2];
  reservoirs = loaded[3];
  groundwater = loaded[4];
  century = loaded[5];
  manifest = loaded[6];
  basemap = loaded[7];

  buildViews();

  const snapshot = manifest.generated ? manifest.generated.slice(0, 10) : 'unknown';
  footerEl.textContent =
    `NOAA GHCN · NRCS SNOTEL · USGS Water Data · Bureau of Reclamation RISE · ` +
    `USGS–ABCWUA cooperative groundwater network — snapshot ${snapshot}`;

  if (/[?&]kiosk\b/.test(window.location.search)) startKiosk();
  else show('precipitation');
}

init();
