// Documents and workers have separate isolation policies. Validate both contexts before
// loading shared-memory WASM; WebKit can expose SharedArrayBuffer without isolation.
export function checkCapabilities() {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('This browser needs cross-origin isolation to build icons. Reload on HTTPS or use the favseed CLI.');
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser needs DecompressionStream support. Update your browser or use the favseed CLI.');
  }
}
