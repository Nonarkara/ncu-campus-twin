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
