# NCU Campus Twin — context

- **What:** an independent open-data campus intelligence console for National Central University (Zhongli, Taoyuan). Lead screen **Today** (admin decisions + 24 h live Open-Meteo solar/weather strip + key OSM campus nodes), **Microgrid** (Taipower 1 MW / 3 MWh / 250 kWp 4-hour islanding simulator driven by live hourly GHI + interactive roof siting portfolio + HV substation radial screening + CO₂e avoided), **Move** (9025A/HSR/Zhongli headway strip, countdowns, transfer advice, clickable 300 m walk catchments), and cross-lens **Building Inspector** + instant building search. Research is in `DOSSIER.md`.
- **Repo:** https://github.com/Nonarkara/ncu-campus-twin (public, GitHub Actions CI).
- **Live:** https://ncu.nonarkara.org (Cloudflare Worker `ncu-campus-twin`, static assets + `/api/today` with hourly GHI, edge-cached 5 min).
- **Tier:** T0 demo. Public read-only, no keys, no personal data.
- **Pipeline:** raw in `var/raw` (gitignored), `npm run cook` writes `public/data/{campus,solar}.json`. Re-harvest OSM with the Overpass queries in the 2026-11-22 session; overpass.kumi.systems and overpass-api.de both worked after retries.
- **Conservation laws (tests):** campus kWp equals the sum over buildings and stays within roof × density. Every Today item and steady row carries `{source, tier, asOf}`; a missing feed means no row.
- **Thresholds** live in `src/shared/today.ts` `RULES`, each with its source (CWA, MOENV, Beaufort, house rule).
- **Dead source:** Civil IoT `sta.colife.org.tw`. Its TLS certificate expired 2026-11-21 23:59 UTC. The archive is in `var/civiliot/` (14 h, 10,941 rows). The worker still tries it, then falls back to the CAMS model, labelled.
- **Needs Dr Non:** free keys for TDX (live buses), CWA (warnings, quakes) and MOENV (official AQI). Store them with `wrangler secret put`, never in the repo. An NCU contact is needed before anything public uses NCU marks.
- **Next:** a Ground lens (Sentinel-2 NDVI year on year), a TDX live bus layer, CWA warnings in Today.

## v0.3 — Twin + Find (2026-11-22)
- **Twin lens** (3D camera, drag to rotate):
  - Sentinel-2 NDVI 20 m grid. Run `node pipeline/ndvi.mjs`. The pair 2026-11-17 vs 2025-11-15 was chosen by scoring every 2025 and 2026 autumn scene for SCL-clear sky over campus. The 2025-10-13 scene was hazy and faked a +18 pt "gain".
  - Water network and wildlife from OSM and GBIF. Run `node pipeline/eco.mjs`. Only GBIF records with position ≤ 50 m and unrounded coordinates are pinned (11); eBird hotspot and moth-network records are counted, not pinned.
  - Live YouBike docks, fetched by the browser: the feed allows CORS but returns 403 to Cloudflare servers. Do not spoof headers.
  - Live Freeway 1 detectors at the Zhongli exit. A cron (*/5) pulls `VDLive.xml` into KV `LIVE` (id 2ce57fb11c484cc0b302fc6e36b1ba22, key `road`). Some edge locations get 522 from the source, so requests never fetch it directly.
- **Find lens**: `public/data/directory.json` from `var/raw/directory/directory.json`, cooked by `pipeline/directory.mjs`.
  - 169 official entries, each linked to its page.
  - Entries link to an OSM footprint only by exact name or the hand-checked ALIAS table (44 linked).
- **Heights (upgraded 2026-11-22):** Harvested **97 / 109** official measured building heights (`BUILD_H`, `BUILD_NO`, `MDATE`) directly from Taiwan NLSC's public Taoyuan Individual Building 3D Tiles (`https://3dtiles.nlsc.gov.tw/building/tiles3d/37/tileset.json`, no login required) via `npm run heights` (`pipeline/heights.mjs`). 1 additional building uses OSM `building:levels × 3.5 m` (modeled); 11 unmeasured small structures remain honestly flat (`height_m: null`), never guessed. Max measured campus height: Female Dorm 14 (`女十四舍`) at `42.6 m (12F)`.
- Not published anywhere: dorm bed counts, current car/scooter capacity, restaurant count.
- **Freeway feed status (2026-11-22 13:15):** the */5 cron runs, but every pull from Cloudflare returns 522: Cloudflare's network cannot reach tisvcloud.freeway.gov.tw. Requests from a Taiwanese ISP work fine. `/api/live` hides readings older than 30 min and exposes `lastError`. Two ways to make it live:
  - (a) a TDX key (official API), or
  - (b) a 5-min relay on Dr Non's always-on Mac that runs `wrangler kv key put road`.
- **Freeway relay (live since 2026-11-22 13:18):** the launchd job `com.drnon.ncu-road-relay` (~/Library/LaunchAgents) runs `pipeline/relay-road.mjs` every 300 s on this Mac and writes KV `road`. Log: `var/relay.log`. When the Mac sleeps, the site hides the data after 30 min. The Worker cron still tries and records its 522 in `road_err`.
