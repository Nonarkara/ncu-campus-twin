# 國立中央大學校園數位孿生 · NCU Campus Twin

**線上版本 / Live site:** <https://ncu.nonarkara.org>

一個以開放資料建構、零邊際營運成本的國立中央大學（桃園中壢）校園數位孿生系統，整合 3D 實測建物高度、校園導覽、通勤公車與國道一號中壢交流道即時車流、微電網太陽能試算、衛星植生變化（Sentinel-2 NDVI）、校園自然解方（NbS）實景紀錄與中大／桃園新聞語料庫。前端採用 React、TypeScript 與 MapLibre GL JS，邊緣服務與 API 運行於 Cloudflare Workers 與 KV。

An open-data, zero-cost campus digital twin for National Central University (Zhongli, Taoyuan, Taiwan). It brings together measured 3D building heights, campus directory search, bus schedules and Freeway 1 Zhongli IC live traffic, rooftop microgrid solar modeling, Sentinel-2 NDVI vegetation change, Nature-based Solutions (NbS) field photography, and an NCU/Taoyuan news corpus. Built with React, TypeScript, MapLibre GL JS, Cloudflare Workers, and KV.

---

## 文件索引 / Documentation

詳細設計、資料來源與變更紀錄皆保留於既有文件，不在此重複：

Detailed provenance, architecture, and visual rules live in the existing docs:

- [`DOSSIER.md`](./DOSSIER.md) — 資料來源清單、資料層級（live / forecast / modeled / static）與來源查核（Source registry, data tiers, and provenance）
- [`context.md`](./context.md) — 系統架構、維運迴圈與版本變更紀錄（Architecture, operational loops, and change log）
- [`STYLE.md`](./STYLE.md) — 視覺規範、Palette Plate 002 配色與版面原則（Visual tokens, Palette Plate 002, and layout rules）

---

## 本機執行 / Local Development

需求 / Requirements: Node.js 22+ 與 npm。

```bash
# 1. 安裝相依套件 / Install dependencies
npm ci

# 2. 執行測試 / Run unit & worker tests
npm test

# 3. 建置前端靜態檔 / Type-check and build dist/
npm run build

# 4. 啟動前端開發伺服器（將 /api 代理至 localhost:8787）
#    Start Vite dev server (proxies /api to http://localhost:8787)
npm run dev

# 5. 啟動 Cloudflare Worker 本機環境（服務 dist/ 與 /api/*）
#    Start local Cloudflare Worker (serves dist/ and /api/*)
npm run worker:dev
```

> **提示 / Tip:** `npm run worker:dev` 會透過 Wrangler 提供 `dist/` 靜態資產與 `/api/health`、`/api/today`、`/api/live`、`/api/news`；若先執行 `npm run build`，即可直接透過 Worker 網址預覽完整應用。若同時使用 `npm run dev`，請讓 Worker 監聽在 `8787` 埠（例如 `npx wrangler dev --port 8787 --var DEV:1`）。

---

## 資料管線 / Data Pipelines (`pipeline/*.mjs`)

管線腳本分為**離線處理**（僅讀取本機 `var/raw/` 或 `public/data/`）與**需要網路**（向公開端點抓取資料；部分腳本會透過 Wrangler 寫入 Cloudflare KV）。日常前端開發與測試不需重跑管線。

Pipeline scripts are split into **offline** (local files only) and **network** (fetches public endpoints; KV relays require Cloudflare Wrangler authentication). Routine frontend development and tests do not require re-running pipelines.

### 離線腳本 / Offline (no network)

| 腳本 / Script | 指令 / Command | 說明 / Purpose |
| --- | --- | --- |
| `pipeline/cook.mjs` | `npm run cook` | 將 `var/raw/`（OSM、Open-Meteo 歷史檔）轉製為 `public/data/*.json` / Cooks local raw files into `public/data/*.json` |
| `pipeline/solar-season.mjs` | `npm run solar-season` | 由 `var/raw/openmeteo-ghi-2025.json` 計算 12 個月日照曲線 / Computes 12-month solar curve into `public/data/solar-season.json` |
| `pipeline/directory.mjs` | `node pipeline/directory.mjs` | 轉製校園單位名錄並對照 OSM 建物輪廓 / Cooks `var/raw/directory/directory.json` + `data/campus-crosswalk.json` into `public/data/directory.json` |
| `pipeline/eco.mjs` | `node pipeline/eco.mjs` | 轉製校園生態與 GBIF 觀測資料 / Cooks `var/raw/eco/` and `var/raw/gbif/` into `public/data/eco.json` |

### 需要網路的腳本 / Network Required

| 腳本 / Script | 指令 / Command | 說明 / Purpose |
| --- | --- | --- |
| `pipeline/heights.mjs` | `npm run heights` | 向國土測繪中心 3D Tiles（`3dtiles.nlsc.gov.tw`）擷取實測建物高度並對應至 `public/data/campus.json` / Fetches NLSC measured 3D building heights |
| `pipeline/surroundings.mjs` | `npm run surroundings` | 向 Overpass API 擷取中壢周邊主要道路、水系與建物至 `public/data/surroundings.json` / Fetches surrounding Zhongli roads, waterways, and buildings |
| `pipeline/ndvi.mjs` | `node pipeline/ndvi.mjs` | 擷取 Sentinel-2 L2A COG 計算 20 m NDVI 網格至 `public/data/ndvi.json` / Computes 20 m Sentinel-2 NDVI change grid |
| `pipeline/news.mjs` | `npm run news` | 抓取 Google News RSS（中大／桃園）寫入 `var/news/ncu-taoyuan-news.jsonl`，並同步至 Cloudflare KV `news_db`（需 Wrangler 登入）/ Archives RSS corpus & syncs to KV |
| `pipeline/push-road.mjs` | `node pipeline/push-road.mjs` | 抓取高公局 `VDLive.xml`（中壢交流道偵測器）並寫入 Cloudflare KV `road`（需 Wrangler 登入）/ Relays Freeway 1 VD readings to KV |
| `pipeline/archive-civiliot.mjs` | `node pipeline/archive-civiliot.mjs` | 追加保存民生公共物聯網感測原始紀錄至 `var/civiliot/` / Appends raw Civil IoT Taiwan observations locally |

### 共用模組與建置輔助 / Shared Modules & Build Helpers

`pipeline/solar.mjs`、`pipeline/tels.mjs`、`pipeline/utm.mjs`、`pipeline/put-kv.mjs` 為上述管線匯入之共用函式；`pipeline/build-info.mjs` 於建置與測試前自動產生 gitignored 的 `src/shared/build-info.generated.ts`（注入 `/api/health` 的 `build` git SHA）。

---

## 部署與 CI / Deployment & CI

- **部署為手動且僅限專案擁有者（Non）執行 / Deployment is manual and owner-only (Non):** 正式環境透過 `npm run deploy`（`npm test && npm run build && wrangler deploy`）手動發佈至 Cloudflare Workers。
- **GitHub Actions CI（[`.github/workflows/ci.yml`](./.github/workflows/ci.yml)）** 僅於 PR 與 `main` 推送時執行 `npm ci`、`npm test` 與 `npm run build`，不會自動部署或寫入 KV。
