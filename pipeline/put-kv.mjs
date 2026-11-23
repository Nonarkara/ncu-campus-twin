import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function putKv(root, namespace, key, valueArgs) {
  // Call Wrangler's exported CLI directly so timeout terminates the command, including its network request.
  const result = spawnSync(process.execPath, [
    require.resolve('wrangler'), 'kv', 'key', 'put', key, ...valueArgs,
    '--namespace-id', namespace, '--remote',
  ], { cwd: root, stdio: 'pipe', timeout: 45000, killSignal: 'SIGKILL' });
  if (result.error) throw new Error(`KV upload for ${key}: ${result.error.code ?? result.error.message}`);
  if (result.status !== 0) throw new Error(`KV upload for ${key}: Wrangler exited ${result.status ?? result.signal}`);
}
