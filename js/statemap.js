// A small state-outline locator map drawn inside the plot SVG, below the
// ridges: New Mexico (plus Colorado where the snowpack originates), with a
// dot per site that lights up when its ridge is hovered.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * @param svg    target <svg> (the plot itself, so the map exports with it)
 * @param states {NM: [ring, ...], CO: [...]} of [lon, lat] rings
 * @param codes  which states to draw, e.g. ['NM'] or ['CO', 'NM']
 * @param sites  [{ id, lat, lon }]
 * @param yTop   top edge in viewBox units
 * @param centerX / maxWidth / maxHeight — box to fit the outline into
 * @returns { height, setActive(id|null) }
 */
export function renderStateMap(svg, { states, codes, sites, yTop, centerX, maxWidth, maxHeight }) {
  const rings = codes.flatMap((c) => states[c] ?? []);
  if (!rings.length) return { height: 0, setActive() {} };

  const lons = rings.flatMap((r) => r.map((p) => p[0]));
  const lats = rings.flatMap((r) => r.map((p) => p[1]));
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);

  // Equirectangular with longitude squeezed by cos(latitude) — at this size
  // and latitude the distortion of a proper conic projection isn't visible.
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

  const group = el('g', { class: 'state-map' });

  for (const ring of rings) {
    const d =
      ring
        .map((p, i) => {
          const [x, y] = project(p[0], p[1]);
          return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join('') + 'Z';
    group.appendChild(el('path', { d, class: 'state-outline' }));
  }

  const dots = new Map();
  for (const site of sites) {
    if (site.lat == null || site.lon == null) continue;
    const [x, y] = project(site.lon, site.lat);
    const dot = el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 1.7, class: 'site-dot' });
    group.appendChild(dot);
    dots.set(site.id, dot);
  }

  svg.appendChild(group);

  let activeDot = null;
  function setActive(id) {
    if (activeDot) {
      activeDot.classList.remove('active');
      activeDot.setAttribute('r', 1.7);
    }
    activeDot = id == null ? null : dots.get(id) ?? null;
    if (activeDot) {
      activeDot.classList.add('active');
      activeDot.setAttribute('r', 3.2);
      activeDot.parentNode.appendChild(activeDot); // draw on top
    }
  }

  return { height, setActive };
}
