// Shared by the production host, development/preview servers, and actual-browser tests.
export const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
export const productionHeaders = '/*\n' + Object.entries(isolationHeaders)
  .map(([key, value]) => `  ${key}: ${value}\n`).join('') +
  '/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n';
