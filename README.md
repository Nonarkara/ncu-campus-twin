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
