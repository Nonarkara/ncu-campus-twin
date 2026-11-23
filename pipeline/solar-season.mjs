import { readFile, writeFile } from 'node:fs/promises';
import { monthlyIrradiation } from './solar.mjs';

const year = 2025;
const archive = JSON.parse(await readFile(new URL(`../var/raw/openmeteo-ghi-${year}.json`, import.meta.url), 'utf8'));
const months = monthlyIrradiation(archive, year);
const data = {
  meta: {
    source: 'Open-Meteo Historical Weather',
    sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
    tier: 'modeled',
    asOf: String(year),
    latitude: archive.latitude,
    longitude: archive.longitude,
    timezone: archive.timezone,
  },
  months,
};
await writeFile(new URL('../public/data/solar-season.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
