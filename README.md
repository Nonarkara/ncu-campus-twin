# NCU Campus Twin · 中央大學校園孿生

An independent campus console for National Central University in Taoyuan. Today summarizes available conditions. Twin shows mapped buildings and dated observations. Move combines published schedules and available open feeds. Microgrid screens modeled scenarios. Find links to the official directory.

以開放資料建置的獨立校園工具。今日彙整現況，孿生呈現校園建物與有日期的觀測，交通提供公開班表與即時資料，微電網進行情境估算，查詢連結校方名錄。

[Live console · 校園工具](https://ncu.nonarkara.org/) · [Feed health · 資料狀態](https://ncu.nonarkara.org/api/health)

## Local development · 本機開發

```sh
npm ci
npm test
npm run build
npm run worker:dev
```

Run `npm run dev` for Vite interface development. Build before running the Worker to serve static assets with its API routes. Sensor, schedule and forecast age travel with each feed.

使用 `npm run dev` 開發介面。若需在本機測試 API，先建置再啟動 Worker。感測、班表與預報各自保留資料時間。

## Data and releases · 資料與版本

- Static outputs are under `public/data/`. The source and cooking notes are in [context.md](context.md) and [DOSSIER.md](DOSSIER.md). Interface tokens are in [STYLE.md](STYLE.md).
- `npm run deploy` runs tests and builds the static site before deploying to Cloudflare. It publishes the commit hash in `/api/health`. Use a clean, committed tree and verify the hash, map and data after deployment.
- If a release regresses, inspect `npx wrangler deployments list` and use `npx wrangler rollback <version-id>` for the last verified Worker version. Recheck the live map and health after rollback.
- 靜態資料位於 `public/data/`。部署前請先提交變更。部署後確認 `/api/health` 的版本、地圖和資料狀態。

## Twin map overlays · 孿生圖層

**Students · sim** runs 24 modeled figures along mapped campus pedestrian lines at 1.25 m/s. Figures are 1.7 m tall at close zoom. Overview dots mark the same positions. The figures reverse at the ends of the modeled lines. This example uses no counts or observations of real people. **Parking** draws mapped car, motorcycle and bicycle parking. P, M and B identify the type. Capacities and access appear only where tagged in OpenStreetMap.

**學生・模擬**依校內圖資步道，顯示 24 位高 1.7 公尺、每秒行走 1.25 公尺的模擬行人。無實測人數。**停車**圖層以 P、M、B 區分汽車、機車及自行車停車處，容量與通行資訊依 OpenStreetMap 標註。

To refresh the [ODbL source geometry](https://www.openstreetmap.org/copyright), record the retrieval date and use the campus bounding box. Keep the downloaded XML outside the public directory.

```sh
curl --fail --compressed 'https://api.openstreetmap.org/api/0.6/map?bbox=121.1845,24.9648,121.1971,24.972' -o /tmp/ncu-campus.osm
python3 pipeline/campus-layers.py /tmp/ncu-campus.osm --as-of "$(date +%F)"
```

## Zhongli air quality · 中壢空氣品質

Today shows the Ministry of Environment's published hourly AQI for Zhongli's traffic station, about 3.5 km from the campus centre. The monitoring website uses station ID 12. The open-data catalogue uses ID 68. The portal file is keyed to the Taiwan sampling hour. The reader checks the station name, county and separately embedded publication hour before accepting the value. The campus PM2.5 estimate is shown separately.

The five-minute Worker schedule checks whether a newly published hour is due, with a 15-minute publication allowance and failure retry interval. A station reading expires after 95 minutes. Health reports the observation time, most recent attempt, and most recent successful ingestion separately. The public monitoring JSON requires no project credential.

[MOENV monitoring network](https://airtw.moenv.gov.tw/ENG/default.aspx) · [MOENV station catalogue](https://data.moenv.gov.tw/dataset/detail/AQX_P_07)
