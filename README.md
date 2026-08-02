# The Joy of Water

New Mexico water data rendered in the style of Joy Division's *Unknown Pleasures* —
stacked ridgelines ("joyplots", a term coined after that very album cover), white
lines on black, each ridge occluding the ones behind it.

Six views, switched from the nav. All but Otowi are grouped by major
watershed — San Juan (Colorado tributary), Rio Grande, Pecos, Canadian,
Arkansas, Gila — though nothing currently reports from New Mexico's sliver
of the Arkansas basin (the last Dry Cimarron gage was discontinued in 2024).

- **PRECIPITATION** — NOAA GHCN daily precipitation at 12 weather stations
  spanning the state north to south (Chama to Las Cruces), past 12 months.
- **SNOWPACK** — NRCS SNOTEL snow water equivalent at 14 mountain stations
  that drain to New Mexico's rivers, including the Colorado headwaters of
  the Rio Grande and San Juan. Each basin keeps the stations holding the most
  water, ranked on observed peak SWE.
- **STREAMFLOW** — the Rio Grande mainstem from the Colorado line to below
  Elephant Butte: Cerro, Otowi Bridge, Albuquerque, San Marcial, and the dam
  release. There is no El Paso ridge because USGS has no active gage below
  Elephant Butte — Caballo, Leasburg and El Paso are all discontinued and
  that reach is gaged by the IBWC, outside the USGS API.
- **STORAGE** — Bureau of Reclamation reservoir storage. Each reservoir is
  scaled to its own 12-month range so the drawdown-and-refill cycle is
  visible; how full it actually is lives in the label and hover readout.
- **GROUNDWATER** — USGS/ABCWUA cooperative-network well levels in the
  Albuquerque Basin, past 12 months.
- **OTOWI** — one ridge per year of Rio Grande at Otowi Bridge daily flow,
  1895 to present, on a single shared scale, so wet years tower and dry
  years flatten.

**LABELS** toggles site names beside each ridge, each with a summary pair
suited to the data — 12-month totals for the flux views (precipitation,
streamflow), peaks and current levels for the level views (snowpack, storage,
groundwater). **MAP** toggles a locator map pinned to the corner of the window — New Mexico
(plus Colorado in the snowpack view) with a dot per site that lights up when
its ridge is hovered. It is pinned rather than placed below the plot so it
stays visible while hovering ridges far down a tall view; inside an iframe,
where the page has no scrollport of its own, it falls back into the flow
beneath the plot. **EXPORT as SVG** downloads the current view as a
self-contained vector file — map, labels and all — ready for Inkscape,
Illustrator, or printing at any size.

State outlines come from `data/states.json`, built once by
`scripts/build-states.mjs` from a public US states GeoJSON and simplified to
a few dozen vertices.

## Running

Serve the directory with any static file server (the page fetches `data/*.json`,
so `file://` won't work):

```
node scripts/serve.mjs   # zero-dep, http://localhost:4173
```

(or `npx serve` / `python -m http.server` if you prefer)

## Embedding in another site

The page detects when it is loaded inside an iframe and posts its content
height to the parent window, so the frame can be sized to whichever view is
showing (Storage is short, Otowi is nearly three times taller). Host page:

```html
<iframe
  id="joy-of-water"
  src="https://ericknf.github.io/the-joy-of-water/"
  title="The Joy of Water"
  scrolling="no"
  style="width:100%; height:700px; border:0; display:block; background:#000;">
</iframe>
<script>
  window.addEventListener('message', function (e) {
    if (e.origin !== 'https://ericknf.github.io') return;
    if (e.data && e.data.type === 'joy-of-water:height' && e.data.height > 0) {
      document.getElementById('joy-of-water').style.height = e.data.height + 'px';
    }
  });
</script>
```

## Refreshing the data

```
node scripts/fetch-data.mjs
```

Requires Node 18+. The script pulls from:

- NOAA NCEI daily-summaries API (`ncei.noaa.gov/access/services/data/v1`) —
  GHCN-Daily precipitation (tokenless)
- NRCS AWDB (`wcc.sc.egov.usda.gov/awdbRestApi`) — SNOTEL daily snow water
  equivalent
- USGS Water Data OGC API (`api.waterdata.usgs.gov/ogcapi/v0`) — streamflow
  (parameter 00060), groundwater depth-to-water (72019), and the Otowi Bridge
  period of record
- Bureau of Reclamation RISE (`data.usbr.gov/rise/api`) — daily reservoir
  storage (acre-feet)
- USACE CWMS Data API (`cwms-data.usace.army.mil`) — Abiquiu, a Corps lake
  that RISE does not carry (its RISE catalog item exists but is empty)

Snapshots land in `data/` alongside a `manifest.json` recording the fetch
window and any per-site failures. Groundwater wells and SNOTEL stations are
rediscovered on each run (SNOTEL by HUC-to-watershed mapping); NOAA stations,
stream gages, and RISE catalog item IDs are pinned in the config block at the
top of the script.

## Credit

The visual form is lifted from Peter Saville's cover for Joy Division's
*Unknown Pleasures* (Factory Records, 1979) — white stacked ridgelines on a
black field.

That cover is itself a data visualization, which is why the borrowing feels
apt. The image is a plot of 80 successive radio pulses from CP 1919, the first
pulsar ever identified — discovered by Jocelyn Bell Burnell in 1967. Harold
Craft produced the stacked plot for his 1970 Cornell PhD thesis using Arecibo
data; it was reprinted in *The Cambridge Encyclopaedia of Astronomy* (1977),
where Saville found it and inverted it to white-on-black. Craft only learned
his figure had become an album cover when he walked into a record store and
saw it.

The chart type now carries the name: stacked ridgelines are widely called
"joyplots" after this very cover.

This project replaces the pulsar's radio pulses with New Mexico's water — the
same stacked form, different signal. No artwork from the album is reproduced
here; every ridge is drawn from public agency data.
