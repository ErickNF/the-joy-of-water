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
- **SNOWPACK** — NRCS SNOTEL snow water equivalent at ~56 mountain stations
  that drain to New Mexico's rivers, including the Colorado headwaters of
  the Rio Grande and San Juan, past 12 months.
- **STREAMFLOW** — USGS daily flow at 17 gages (San Juan, Rio Grande, Chama,
  Pecos, Canadian, Gila), past 12 months.
- **STORAGE** — Bureau of Reclamation reservoir storage, drawn as a fraction
  of capacity where known — Elephant Butte's flat line is not a rendering bug.
- **GROUNDWATER** — USGS/ABCWUA cooperative-network well levels in the
  Albuquerque Basin, past 12 months.
- **OTOWI** — one ridge per year of Rio Grande at Otowi Bridge daily flow,
  1895 to present, on a single shared scale, so wet years tower and dry
  years flatten.

**LABELS** toggles discreet site names beside each ridge; hovering any ridge
highlights it and reads out the plotted value at the cursor.

## Running

Serve the directory with any static file server (the page fetches `data/*.json`,
so `file://` won't work):

```
node scripts/serve.mjs   # zero-dep, http://localhost:4173
```

(or `npx serve` / `python -m http.server` if you prefer)

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

Snapshots land in `data/` alongside a `manifest.json` recording the fetch
window and any per-site failures. Groundwater wells and SNOTEL stations are
rediscovered on each run (SNOTEL by HUC-to-watershed mapping); NOAA stations,
stream gages, and RISE catalog item IDs are pinned in the config block at the
top of the script.
