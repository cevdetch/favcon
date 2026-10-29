// A small page-side adapter. All SVG/raster/compression/archive work lives in the worker.
import { normaliseOptions } from '../../../lib/config.mjs';
import { createWorkerClient } from './worker-client.mjs';
import { checkCapabilities } from './capabilities.mjs';

const client = createWorkerClient({
  createWorker: () => new Worker(new URL('./engine-worker.mjs', import.meta.url), { type: 'module' }),
  checkCapabilities,
});

export const warm = () => client.warm();
export const dispose = () => client.dispose();

export async function buildInBrowser(source, options = {}, controls = {}) {
  const normalized = normaliseOptions({ ...options, manifest: options.manifest ?? true });
  const { archiveBytes, ...result } = await client.build(source, normalized, controls);
  return { ...result, archive: () => new Uint8Array(archiveBytes) };
}
