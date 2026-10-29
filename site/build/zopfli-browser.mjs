// 1.0.15's generated glue assigns module.exports only in its Node branch. Its JS API
// otherwise attaches onRuntimeInitialized to {}, leaving every browser compression queued.
// Export the same runtime in the browser too; the embedded WASM and settings are untouched.
export const zopfliBrowser = () => ({
  name: 'favseed-zopfli-browser',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/@gfx/zopfli/dist/libzopfli.js')) return;
    return { code: `${code}\nmodule.exports = Module;\n`, map: null };
  },
});
