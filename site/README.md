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

The site's own icons in `public/` are favseed's output for `public/logo.svg`. The Open Graph
card is `src/og/og.svg`, rendered with the same three tools:

```sh
resvg src/og/og.svg /tmp/og.png
pngquant --force --speed 1 --nofs --colors 16 --output /tmp/og-q.png /tmp/og.png
oxipng -q -o max -s --zopfli -a --out public/og.png /tmp/og-q.png
```

## One engine and identical output

The browser imports the same `lib/core.mjs`, `lib/config.mjs`, `lib/engine.mjs`, and
`lib/pipeline.mjs` as the CLI. The host adapters inject native or WASI
`@napi-rs/image` 1.15.0, `@gfx/zopfli` 1.0.15, SVGO, and a deflate decoder.
Matching source, normalized options, and mode produce identical files, links, and placement.
The browser includes a manifest by default; the CLI needs `--manifest` to match.

Release mode uses 120 Zopfli iterations; fast mode uses 15, matching `mode: 'fast'` in the CLI config.
Both run in a dedicated module worker, keeping the page responsive. Cancel terminates the
worker and its children. The previous successful downloads remain usable after a failed or
cancelled build. One completed set is cached in memory, at most 16 MiB, with owned copies;
no source or result is persisted or uploaded.

## Loading and hosting requirements

The WASM asset is 10,322,976 bytes before transfer compression, and the upstream loader starts
with 250 MiB of shared memory. Loading is lazy, after selecting an SVG. This improves page
responsiveness and repeated builds, but does not promise lower startup cost or memory use.
Across four measured fixtures, PNGs total 40,384 → 36,848 bytes (8.8% smaller overall;
the heavy fixture grows 5.9%). Release builds take longer on three of the four fixtures
because they now include Zopfli compression; fast mode reduces compression time.

Use HTTPS (or localhost), SharedArrayBuffer, DecompressionStream, and cross-origin isolation.
The build writes Cloudflare Pages `_headers` with COOP `same-origin`, COEP `require-corp`,
and CORP `same-origin` for documents and assets. Other hosts must supply equivalent response
headers, including worker responses. Astro dev and preview use the same headers.
Unsupported environments get a clear CLI alternative instead of a different encoder.

`build/zopfli-browser.mjs` fixes the pinned package's generated CommonJS glue: it exports
its runtime only in Node, so browser callbacks would otherwise queue forever. The transform
exports that same runtime for browser builds and dependency optimization; it does not change
the embedded WASM or compression settings. Native/browser file hashes cover the result.

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
cancellation/retry, failure preservation, missing document/worker isolation and touch controls
at a 320 px viewport. The document and worker both validate their own WASM requirements.

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
picker and saving/opening the generated ZIP. The engine's 250 MiB initial shared memory makes
that device verification especially relevant before release.
