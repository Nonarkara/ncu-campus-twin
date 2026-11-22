# National Central University (國立中央大學): dossier for a campus intelligence pitch

Checked 2026-11-21/22. Every claim has a source or is marked UNVERIFIED. Some claims in the two AI briefs we started from were wrong; corrections are at the end.

## 1. The university

| | |
|---|---|
| Founded | 1915 in Nanjing (NCU counts 2026 as its 111th year). Re-established in Taiwan in 1962 (Miaoli), moved to Shuanglianpo, Zhongli in 1968, NCU name restored in 1979 |
| President | Hsiau Shu-san (蕭述三), since Feb 2025 |
| Students | ~6,200 undergraduate, ~6,000 graduate, ~700 international (Aug 2025 brochure) |
| Staff | 746 full-time faculty (Wikipedia). 556 staff (FY111 financial plan) |
| Units | 8–9 colleges (sources disagree; the Graduate College of Sustainability and Green Energy, 2023, is likely the ninth) |
| Strengths | Space science and remote sensing (CSRSR, Taiwan's first earth-resources satellite receiving station, 1994). Small satellites and payloads, including Taiwan's first lunar mission. FORMOSAT-7/COSMIC-2 ionosphere work. Atmospheric and earth sciences. Lulin Observatory (in Nantou, not on campus). Hydrogen Energy Research Center (White Energy House microgrid demo) |
| Rankings | QS World 587 (2026), QS Asia 112 (2025), THE 1001–1200, ARWU 901–1000 |
| Campus | No. 300 Zhongda Rd., Zhongli, Taoyuan 320317. About 64 ha (sources give 62, 64 and 66). Centre 24.9683N, 121.1955E (NCU) / OSM relation 18727079 bbox 24.9651–24.9717N, 121.1849–121.1968E |
| On-campus buildings | 109 OSM footprints inside the campus polygon, 69 named, none with height, 5 with floor counts |

Sources: NCU English brochure (Aug 2025), Wikipedia, FY111/FY115 financial plans, OSM.

## 2. Where the demand is (who would pay, and why now)

1. **Microgrid with Taipower.** Letter of intent signed 2026-03-13 by President Hsiau and Taipower chairman Tseng Wen-sheng. Specs: 1 MW / 3 MWh storage and 250 kWp solar. It must island and keep precision labs powered for at least 4 h. Led by EE Prof. Chen Cheng-yi (陳正一). The article gives no budget or schedule; a "mid-2027" completion date is UNVERIFIED. Siblings: NCHU (NT$100 M), NSYSU, NCUE. *This is the strongest hook: a dated commitment with a named owner.*
2. **Carbon targets.** 50% carbon neutral by 2030, 100% by 2050. MOU with the Ministry of Environment, May 2025.
3. **USR "mbhoyaw: Fuxing" (復興).** Phase 4, led by the president, won the 2025 Taiwan Sustainability Action gold award. One of its four pillars is smart disaster prevention.
4. **Daily mobility.** Six bus routes. The 9025A to Taipei detours to NCU only 4 times each way on weekdays. NCU's own advice at rush hour is to take bus 132/133 to Youmin Hospital and transfer. Parking rose from NT$20 to 30/h (2024 → 2026 campus map).
5. **Housing.** Undergraduate dorm lottery with waitlists. Female Dorm 14 renovation from Jul 2026 decants graduate students.
6. **Not found:** news on campus flooding, heat, air quality, safety incidents or electricity bills. Do not pitch these as known pains.

**Who to approach:** 總務處 (General Affairs; owns transport, parking and energy rules), 永續發展暨社會責任辦公室 (Sustainability and USR), the EE microgrid team, the Hydrogen Energy Research Center, and the Office of Institutional Research (ir.ncu.edu.tw). Searches found no existing NCU digital twin or campus dashboard; this does not prove there is none, so check what the Taipower microgrid's own monitoring layer will include before pitching.

## 3. Open data: what is actually usable

| Source | Access | Status | Gives |
|---|---|---|---|
| OSM via Overpass | none | **live** | 109 campus buildings, roads, water, 31 bus stops |
| NLSC WMTS (PHOTO2, EMAP) | none | **live** | Government orthophoto and base map tiles |
| Sentinel-2 L2A via Element84 STAC | none | **live** | 10 m imagery. Scene 2026-11-17 is 5% cloud |
| Open-Meteo forecast, archive, CAMS air | none | **live** | Hourly weather, 2025 sunlight (1,612 kWh/m²), PM2.5 model |
| NCU CSRSR satellite platform (opendata.csrsr.ncu.edu.tw) | registration, NSTC projects | live | Orthoimagery, NDVI; a tile service was announced 2026-04-02 |
| NCU transport PDF (2026-02-26) | none | **live** | Timetables for 132/133/133A/172/173/9025A |
| TDX (live bus, YouBike, rail) | free key | key-gated | Real-time bus positions and ETAs |
| CWA (weather, warnings, earthquakes) | free key | key-gated | Official station data. NCU's own station C0C520 was decommissioned 2017-12-20; nearest is C0C700 about 6 km east |
| MOENV AQI | free key | key-gated | Official AQI at 中壢 / 平鎮 / 龍潭 |
| Civil IoT SensorThings | none | **dead** | TLS certificate expired 2026-11-21 23:59 UTC; service end was announced for 2026-12-01. We archived 14 h (10,941 rows) |
| Taipower per-campus data | — | not found | — |
| NCU meters, BMS, room bookings, parking gates | internal | needs NCU | The other two-thirds of an admin system |

## 4. Corrections to the AI briefs

- **LINE Notify** shut down on 2025-03-31. Use the LINE Messaging API.
- **No "Use AI to Understand Energy" competition** and no NCU-hosted digital-twin competition could be found.
- **NCU has no live on-campus CWA station** (closed in 2017).
- **CSRSR open data is real**, but downloads are limited to NSTC-funded use.
- **Bus 5005** does not appear in NCU's transport guide. 172A was a pilot that ran to 2026-03-31.
- **Civil IoT** ended early in practice (certificate expiry), not on 1 December.

## 5. What we built (v0.1)

**NCU Campus Twin**, an independent prototype from open data. Its lead screen, **Today**, lists the decisions that need making today, each with an owner, a deadline, the rule and its source. **Power** compares a rooftop-solar screening (5.8–11.6 MWp across 94 roofs, upper bound with stated assumptions) against the 250 kWp in the microgrid plan. **Move** shows the next 9025A, HSR and Zhongli buses from NCU's own timetable. The parts that need NCU's internal data appear as "not connected yet" and are never faked.
