# favseed, in the browser

The third of the three: the [CLI](../bin/favseed.mjs), the [Astro integration](../astro/), and
this. Drop an SVG, get the set, nothing leaves the tab.

```sh
pnpm install && pnpm --filter favseed-site dev   # from the repo root
```

Deployed to <https://favseed.cevdet.ch> by Cloudflare Pages from `main` (settings in
[RELEASING.md](../RELEASING.md)). `trailingSlash: 'never'` with `build.format: 'file'` serves
slash-free URLs without a redirect; `404.astro` must exist, or Pages answers every unknown path
with the home page and a 200.

The site's own icons in `public/` are favseed's output for `public/icon.svg`. The Open Graph
card is `src/og/og.svg`, rendered with the same three tools:

```sh
resvg src/og/og.svg /tmp/og.png
pngquant --force --speed 1 --nofs --colors 16 --output /tmp/og-q.png /tmp/og.png
oxipng -q -o max -s --zopfli -a --out public/og.png /tmp/og-q.png
```

## One engine and identical output

The browser imports the same `lib/core.mjs`, `lib/config.mjs`, `lib/engine.mjs`, and
`lib/pipeline.mjs` as the CLI. The host adapters inject native or WASI
`@napi-rs/image` 1.15.0, the shared rebuilt Google Zopfli WASM, SVGO, and a deflate decoder.
Matching source, normalized options, and mode produce identical files, links, and placement.
The browser includes a manifest by default; the CLI needs `--manifest` to match.

PNG quality defaults to 80. Choose 100 for the previous higher-fidelity output; lower values trade raster fidelity
for size using the same native target in both hosts. Set `--quality 80` or `quality: 80` to match
the form; explicit quality below 100 cannot combine with custom `colors`. Custom colors without
quality retain the quality-100 path. The form disables and preserves that field until quality
returns to 100. Quality is not a measured error percentage and smaller output is not guaranteed.
See [quality measurements](../bench/zopfli/QUALITY.md).

Standard builds skip Zopfli. Extra PNG compression is an explicit opt-in, matching `--zopfli`
or `zopfli: true` in the CLI/API; release effort uses 120 iterations and fast effort uses 15.
Both preserve pixels. One optimized `icon.svg` retains animation, styling and accessibility
and is reused by the site's header and favicon. Raster exports use a static base appearance.

Placement searches and raster outputs run in bounded batches, with serial fallback for large
custom sizes. Builds run in a dedicated worker; Cancel terminates it and its children. Previous
successful downloads remain usable after a failed or cancelled build. One completed set is
cached in memory with owned copies and a 16 MiB budget; no source/result is persisted or uploaded.

Opt-in compression includes the guarded lossless palette pass described in the
[competitor measurements](../bench/zopfli/COMPETITOR.md). Those historical measurements predate
the default-off compression and single-SVG output change. Current measurements are in
[the default-performance report](../bench/zopfli/DEFAULTS.md).

## Loading and hosting requirements

The image WASM asset is 10,322,976 bytes before transfer compression; production serves it
with Brotli (3,193,943 transferred bytes in the measured response). The loader starts with
64 MiB of growable shared memory. It preloads four async workers plus two to four spare workers,
and retains upstream fallback spawning. Loading starts after selecting an SVG.
Earlier release-mode compressor and palette measurements are retained in `bench/zopfli/`;
they describe historical opt-in work, rather than the new standard default.

Use HTTPS (or localhost), SharedArrayBuffer, DecompressionStream, and cross-origin isolation.
The build writes Cloudflare Pages `_headers` with COOP `same-origin`, COEP `require-corp`,
and CORP `same-origin` for documents and assets. Other hosts must supply equivalent response
headers, including worker responses. Astro dev and preview use the same headers.
Unsupported environments get a clear CLI alternative instead of a different encoder.

`build/wasi-runtime.mjs` tunes only the pinned image1.15.0 loader's initial memory and spare
worker preload. It rejects changed package versions or loader defaults, retaining the memory
maximum, growth synchronization and cleanup. Both hosts load `lib/zopfli.wasm` through the same
adapter; the rebuild recipe and licenses live in `bench/zopfli/` and `lib/`.

On the local 16-core Chromium benchmark, this preload change reduces worker targets 21→9 and
renderer PSS after three fixtures 317–319→273–274 MiB, with equivalent build times. Warm
initialization measures 208 ms control versus 171–197 ms tuned. Run `node bench/browser-memory.mjs`
after building to reproduce it on Linux. The [native build comparison](../bench/zopfli/README.md)
measures 11–26% faster warm release builds with the rebuilt compressor and unchanged bytes.

## Verifying it

From the repository root:

```sh
pnpm --filter favseed-site test
pnpm --filter favseed-site build
node site/test/cdp-check.mjs
```

The harness serves `dist/` with the required headers and drives real Chromium through Node's
built-in DevTools WebSocket. It compares every file hash and shared metadata against native
builds over eleven fast-mode fixtures, two release-mode fixtures, and custom option cases.
It also checks ZIP contents, cache mutation/transfer ownership, page responsiveness, missing
isolation, cancellation, retry, nested-worker termination, and preservation of form downloads.
`/check` supplies the test API; fixtures and native references are supplied by the Node harness.

The browser command defaults to `chromium`; set `CHROME=google-chrome` to use Google Chrome.
Only these command names are accepted, and the browser must be on `PATH`.
`FAVSEED_SMOKE=1` runs a shorter matrix with all lifecycle checks.
`FAVSEED_BENCH=1` measures initialization and four release-mode fixtures.
To exercise an already-running dev or preview server, set
`FAVSEED_ORIGIN=http://127.0.0.1:4321` (only local HTTP origins are accepted).

### Other browsers and mobile emulation

The pinned Playwright suite runs desktop Chromium, Firefox and WebKit, plus Pixel 7 and
iPhone 13 emulation. It reuses the native references: all 15 cases on desktop, and four
representative cases on mobile (gradient, release compression, transparent aliases and custom
manifest/animation options). It also checks cache ownership, ZIP downloads, page timers,
cancellation/retry, a 1024px raster after shared-memory growth, failure preservation, missing
document/worker isolation and touch controls at a 320 px viewport. The document and worker
both validate their own WASM requirements.

After building, install the test browsers and run the suite:

```sh
pnpm --filter favseed-site exec playwright install --with-deps chromium firefox webkit
pnpm --filter favseed-site test:browser
pnpm --filter favseed-site test:browser --project=firefox
```

Browser downloads are separate from package installation. Use a Playwright-supported host;
`--with-deps` installs system dependencies on supported Linux distributions. CI runs each
project on Ubuntu 24.04, with one test worker and no automatic retries. Failed runs retain
traces and screenshots for three days.

WebKit testing does not establish compatibility with a particular released Safari version.
Mobile profiles emulate viewport, touch and device parameters on desktop engines. Real iOS
Safari and Android Chrome still need device checks, including memory pressure, the native file
picker and saving/opening the generated ZIP. Growable WASM memory and worker count still make
device verification relevant before release.
