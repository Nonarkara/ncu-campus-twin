// Freeway relay, run every 5 min by launchd on Dr Non's Mac (com.drnon.ncu-road-relay).
// Cloudflare's network gets 522 from tisvcloud.freeway.gov.tw; a Taiwanese ISP does not.
// So this Mac fetches the detector file, keeps only the 4 Zhongli-exit detectors, and writes them to KV `road`.
// The Worker serves KV and hides anything older than 30 min, so a sleeping Mac shows nothing rather than stale speeds.
import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVDLive } from '../src/shared/live.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NS = '2ce57fb11c484cc0b302fc6e36b1ba22';
const WRANGLER = join(ROOT, 'node_modules/.bin/wrangler');
mkdirSync(join(ROOT, 'var'), { recursive: true });
const log = m => appendFileSync(join(ROOT, 'var/relay.log'), `${new Date().toISOString()} ${m}\n`);

try {
  const r = await fetch('https://tisvcloud.freeway.gov.tw/history/motc20/VDLive.xml', { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'ncu-campus-twin-relay/0.3' } });
  if (!r.ok) throw new Error(`source ${r.status}`);
  const data = parseVDLive(await r.text());
  if (!data.length) throw new Error('no detectors in normal status');
  const file = join(ROOT, 'var/road.json');
  writeFileSync(file, JSON.stringify(data));
  execFileSync(WRANGLER, ['kv', 'key', 'put', 'road', '--namespace-id', NS, '--remote', '--path', file], { cwd: ROOT, stdio: 'pipe', timeout: 60000 });
  try { execFileSync(WRANGLER, ['kv', 'key', 'delete', 'road_err', '--namespace-id', NS, '--remote'], { cwd: ROOT, stdio: 'pipe', timeout: 60000 }); } catch { /* already gone */ }
  log(`ok ${data.length} detectors at ${data[0].at}`);
} catch (e) {
  log(`fail ${e.message}`);
  process.exitCode = 1;
}
