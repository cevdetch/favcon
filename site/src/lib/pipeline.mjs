// A small page-side adapter. All SVG/raster/compression/archive work lives in the worker.
import { normaliseOptions } from '../../../lib/config.mjs';
import { createWorkerClient } from './worker-client.mjs';

const client = createWorkerClient({
  createWorker: () => new Worker(new URL('./engine-worker.mjs', import.meta.url), { type: 'module' }),
  checkCapabilities() {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      throw new Error('This browser needs cross-origin isolation to build icons. Reload on HTTPS or use the favseed CLI.');
    }
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser needs DecompressionStream support. Update your browser or use the favseed CLI.');
    }
  },
});

export const warm = () => client.warm();
export const dispose = () => client.dispose();

export async function buildInBrowser(source, options = {}, controls = {}) {
  const normalized = normaliseOptions({ ...options, manifest: options.manifest ?? true });
  const { archiveBytes, ...result } = await client.build(source, normalized, controls);
  return { ...result, archive: () => new Uint8Array(archiveBytes) };
}
