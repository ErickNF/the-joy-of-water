// Joyplot SVG renderer: stacked ridgelines, white stroke on black,
// each ridge filled black to its baseline so lower (nearer) ridges
// occlude the ones above — the Unknown Pleasures effect.

const NS = 'http://www.w3.org/2000/svg';

export const VIEWBOX = { width: 900, height: 1180 };

const LAYOUT = {
  plotLeft: 250,
  plotRight: 650,
  plotTop: 130,
  plotBottom: 1065,
  amplitudeRows: 2.7, // peak height as a multiple of row spacing
  groupGapRows: 2.4, // blank rows between groups
};

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Monotone cubic interpolation (Fritsch–Carlson), like d3.curveMonotoneX.
// pts: [[x,y],...] with length >= 1. Returns an SVG path fragment starting with L/C
// (caller supplies the leading M).
function monotonePath(pts) {
  const n = pts.length;
  if (n === 1) return '';
  if (n === 2) return `L${pts[1][0]},${pts[1][1]}`;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    dy[i] = pts[i + 1][1] - pts[i][1];
    m[i] = dy[i] / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  t[n - 1] = m[n - 2];
  let d = '';
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i][0], y0 = pts[i][1], x1 = pts[i + 1][0], y1 = pts[i + 1][1];
    const h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(2)},${(y0 + t[i] * h).toFixed(2)} ${(x1 - h).toFixed(2)},${(y1 - t[i + 1] * h).toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return d;
}

/**
 * Render stacked ridgeline groups into an <svg>.
 *
 * groups: [{ title, amplitude, series: [{ label, info, tick, values: [0..1|null, ...] }] }]
 * opts: { maxRowGap, centerBlock } — cap row spacing and vertically center the
 *       ridge block so sparse views stay dense instead of stretching.
 * Returns a controller: { hitTest(x, y) -> seriesRef|null, setActive(seriesRef|null) }
 */
export function renderJoyplot(svg, groups, { maxRowGap = Infinity, centerBlock = false } = {}) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`);

  const allSeries = groups.flatMap((g) => g.series);
  const nRows = allSeries.length + (groups.length - 1) * LAYOUT.groupGapRows;
  const plotH = LAYOUT.plotBottom - LAYOUT.plotTop;
  const rowGap = Math.min(plotH / Math.max(nRows, 1), maxRowGap);
  const blockTop = centerBlock
    ? LAYOUT.plotTop + Math.max(0, (plotH - rowGap * (nRows - 1)) / 2)
    : LAYOUT.plotTop;
  const plotW = LAYOUT.plotRight - LAYOUT.plotLeft;

  const rendered = []; // {series, group, baseline, amplitude, node, labelNode}
  let row = 0;

  for (const group of groups) {
    if (group.title && group.series.length) {
      svg.appendChild(
        Object.assign(el('text', {
          x: LAYOUT.plotLeft - 28,
          y: blockTop + row * rowGap,
          class: 'group-title',
          'text-anchor': 'end',
        }), { textContent: group.title })
      );
    }
    for (const series of group.series) {
      const baseline = blockTop + row * rowGap;
      const amplitude = LAYOUT.amplitudeRows * rowGap * (group.amplitude ?? 1);
      const values = series.values;
      const n = values.length;
      const x = (i) => LAYOUT.plotLeft + (plotW * i) / (n - 1);
      const y = (v) => baseline - v * amplitude;

      // Fill: continuous area under the curve (nulls treated as 0 so the
      // fill sits at baseline through gaps), closed along the baseline.
      const fillPts = [];
      for (let i = 0; i < n; i++) fillPts.push([x(i), y(values[i] ?? 0)]);
      let dFill = `M${LAYOUT.plotLeft.toFixed(2)},${baseline.toFixed(2)}L${fillPts[0][0].toFixed(2)},${fillPts[0][1].toFixed(2)}`;
      dFill += monotonePath(fillPts);
      dFill += `L${LAYOUT.plotRight.toFixed(2)},${baseline.toFixed(2)}Z`;

      // Stroke: only over non-null runs, so data gaps break the line.
      let dStroke = '';
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          dStroke += `M${run[0][0].toFixed(2)},${run[0][1].toFixed(2)}` + monotonePath(run);
        }
        run = [];
      };
      for (let i = 0; i < n; i++) {
        if (values[i] === null) flush();
        else run.push([x(i), y(values[i])]);
      }
      flush();

      const g = el('g', { class: 'ridge' });
      g.appendChild(el('path', { d: dFill, class: 'ridge-fill' }));
      if (dStroke) g.appendChild(el('path', { d: dStroke, class: 'ridge-stroke', fill: 'none' }));
      svg.appendChild(g);

      if (series.tick) {
        svg.appendChild(
          Object.assign(el('text', {
            x: LAYOUT.plotLeft - 28,
            y: baseline + 3,
            class: 'row-tick',
            'text-anchor': 'end',
          }), { textContent: series.tick })
        );
      }

      const labelNode = Object.assign(el('text', {
        x: LAYOUT.plotRight + 28,
        y: baseline + 3,
        class: 'site-label',
      }), { textContent: series.label.toUpperCase() });
      svg.appendChild(labelNode);

      rendered.push({ series, baseline, amplitude, node: g, labelNode });
      row += 1;
    }
    row += LAYOUT.groupGapRows;
  }

  function hitTest(vx, vy) {
    if (vx < LAYOUT.plotLeft - 10 || vx > LAYOUT.plotRight + 10) return null;
    let inside = null; // front-most ridge whose fill contains the point
    let nearest = null;
    let nearestDist = 14;
    for (const r of rendered) {
      const n = r.series.values.length;
      const i = Math.round(((vx - LAYOUT.plotLeft) / plotW) * (n - 1));
      const v = r.series.values[Math.max(0, Math.min(n - 1, i))];
      if (v === null) continue;
      const yCurve = r.baseline - v * r.amplitude;
      if (vy >= yCurve && vy <= r.baseline) inside = r; // later = nearer = front
      const dist = Math.abs(vy - yCurve);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = r;
      }
    }
    return inside ?? nearest;
  }

  let active = null;
  function setActive(ref) {
    if (active) {
      active.node.classList.remove('active');
      active.labelNode.classList.remove('active');
    }
    svg.classList.toggle('hovering', !!ref);
    active = ref ?? null;
    if (active) {
      active.node.classList.add('active');
      active.labelNode.classList.add('active');
    }
  }

  return { hitTest, setActive };
}
