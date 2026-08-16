// The locator map: an outline (states, or Bernalillo County for the
// groundwater view), the major rivers clipped to it, and a dot per site that
// lights up when its ridge is hovered.

const NS = 'http://www.w3.org/2000/svg';

let clipSeq = 0;

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const ringPath = (ring, project) =>
  ring
    .map((p, i) => {
      const [x, y] = project(p[0], p[1]);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('');

/**
 * @param svg      target <svg>
 * @param basemap  parsed data/basemap.json
 * @param codes    state codes for the outline, e.g. ['CO', 'NM']
 * @param county   county key instead of states, e.g. 'bernalillo'
 * @param sites    [{ id, lat, lon }]
 * @param yTop / centerX / maxWidth / maxHeight — box to fit into
 * @returns { width, height, setActive(id|null) }
 */
export function renderLocatorMap(
  svg,
  { basemap, codes = [], county = null, frameCodes = null, sites = [], yTop, centerX, maxWidth, maxHeight }
) {
  const counties = basemap.counties || {};
  const states = basemap.states || {};
  const outline = county
    ? counties[county] || []
    : codes.flatMap((c) => states[c] || []);
  if (!outline.length) return { width: 0, height: 0, setActive() {} };

  // Frame on the home shape plus wherever the sites actually are, rather than
  // on every outline drawn: the snowpack view reaches into Colorado, but only
  // its southern edge, and framing on all of Colorado leaves a dead rectangle.
  const frameRings = county
    ? outline
    : (frameCodes || codes).flatMap((c) => states[c] || []);
  const framePoints = [
    ...frameRings.flat(),
    ...sites.filter((s) => s.lat != null && s.lon != null).map((s) => [s.lon, s.lat]),
  ];
  const lons = framePoints.map((p) => p[0]);
  const lats = framePoints.map((p) => p[1]);
  const padLon = (Math.max(...lons) - Math.min(...lons)) * 0.03;
  const padLat = (Math.max(...lats) - Math.min(...lats)) * 0.03;
  const minLon = Math.min(...lons) - padLon, maxLon = Math.max(...lons) + padLon;
  const minLat = Math.min(...lats) - padLat, maxLat = Math.max(...lats) + padLat;

  // Equirectangular with longitude squeezed by cos(latitude) — at this size
  // the distortion of a proper conic projection isn't visible.
  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * cosLat, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min(maxWidth / spanX, maxHeight / spanY);
  const width = spanX * scale;
  const height = spanY * scale;
  const originX = centerX - width / 2;

  const project = (lon, lat) => [
    originX + (lon - minLon) * cosLat * scale,
    yTop + (maxLat - lat) * scale,
  ];

  const group = el('g', { class: 'locator-map' });
  const outlineData = outline.map((ring) => `${ringPath(ring, project)}Z`).join('');

  // Two clips: rivers stop at the outline, and everything stops at the frame
  // so an outline running past the framed area is cut off cleanly.
  const seq = ++clipSeq;
  const riverClipId = `jw-river-clip-${seq}`;
  const frameClipId = `jw-frame-clip-${seq}`;

  const riverClip = el('clipPath', { id: riverClipId });
  riverClip.appendChild(el('path', { d: outlineData }));
  group.appendChild(riverClip);

  const frameClip = el('clipPath', { id: frameClipId });
  frameClip.appendChild(
    el('rect', { x: originX, y: yTop, width, height })
  );
  group.appendChild(frameClip);

  const framed = el('g', { 'clip-path': `url(#${frameClipId})` });

  const riverGroup = el('g', { 'clip-path': `url(#${riverClipId})` });
  for (const line of basemap.rivers || []) {
    riverGroup.appendChild(el('path', { d: ringPath(line, project), class: 'river' }));
  }
  framed.appendChild(riverGroup);
  framed.appendChild(el('path', { d: outlineData, class: 'map-outline' }));
  group.appendChild(framed);

  const dots = new Map();
  for (const site of sites) {
    if (site.lat == null || site.lon == null) continue;
    const [x, y] = project(site.lon, site.lat);
    const dot = el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 1.9, class: 'site-dot' });
    group.appendChild(dot);
    dots.set(site.id, dot);
  }

  svg.appendChild(group);

  let activeDot = null;
  function setActive(id) {
    if (activeDot) {
      activeDot.classList.remove('active');
      activeDot.setAttribute('r', 1.9);
    }
    activeDot = id == null ? null : dots.get(id) || null;
    if (activeDot) {
      activeDot.classList.add('active');
      activeDot.setAttribute('r', 3.4);
      activeDot.parentNode.appendChild(activeDot); // draw on top
    }
  }

  return { width, height, setActive };
}
