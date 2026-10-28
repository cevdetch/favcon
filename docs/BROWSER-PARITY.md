# Browser/CLI parity measurements

Measured 2026-10-28–29 on Linux x64, Node v26.12.1, Chrome for Testing 151.0.7922.34,
using image 1.15.0, Zopfli 1.0.15, and the repository fixtures. Browser tests use a
local HTTP server; these are local execution measurements, not internet download timings.

## What is identical

The actual-browser check compares 104 files over fifteen cases: eleven fixtures in fast
mode, tiles and gradient in release mode, and two custom-option cases. Every filename,
SHA-256, order, link block, placement result, and animation flag matches native execution.
The custom cases cover transparent backgrounds, fixed padding, 180/32 aliases, manifest
members, base paths, effective CSS variables, and disabled animation. The 66 pre-change CLI
fixture hashes remain identical. Native rendering and compression settings are unchanged.

The browser now uses the same shared options, SVG stage, engine, and pipeline. Its manifest
default remains enabled; compare with `--manifest` in the CLI. Compare release with release
or fast with fast, since those modes intentionally have different compression budgets.

## Browser output size against its former pipeline

The baseline is the actual four-fixture browser run captured before replacement. Counts
below include the three emitted PNG files, excluding ICO, SVG, manifest, and ZIP overhead.
The new release files equal the CLI files; the old browser used different codecs and no
Zopfli. This is an aggregate improvement, with a per-fixture byte increase on heavy.

| fixture | old browser PNG bytes | shared engine/release | change | shared engine/fast |
|---|---:|---:|---:|---:|
| tiles | 620 | 600 | -3.2% | 602 |
| heavy | 5,043 | 5,343 | +5.9% | 5,352 |
| general | 5,079 | 4,959 | -2.4% | 4,973 |
| gradient | 29,642 | 25,946 | -12.5% | 26,013 |
| total | 40,384 | 36,848 | -8.8% | 36,940 |

## Work avoided and responsiveness

Transparent placement renders are cached per build, up to 16 MiB, and released before PNG
compression. Comparing the previous pipeline with the current one gives these actual image
engine call counts (encoding/compression excluded from this count):

| fixture | default 192/512 before → after | sizes 180/192 before → after |
|---|---:|---:|
| general | 40 → 37 | 27 → 15 |
| heavy | 36 → 33 | 24 → 13 |
| tiles | 19 → 16 | 16 → 9 |
| gradient | 42 → 38 | 28 → 15 |
| total | 137 → 124 (−9.5%) | 95 → 52 (−45.3%) |

These are reductions in placement work, not equivalent percentages of total build time.
Compression still dominates release builds. Both browser and CLI receive this reuse.

The browser retains one completed set, at most 16 MiB including source key and binary
payloads. A repeated identical general build with sizes 180/32 returned in **0.42 ms** in the
full matrix run, avoiding rasterization and compression. The check mutates returned bytes
and metadata, transfers buffers, and verifies that the cached copy stays intact.

A 20 ms page timer's largest observed interval was **21 ms** throughout the fifteen cases,
including release compression. Heavy work now runs in a dedicated worker. The check also
confirms cancellation during initialization and raster work, clean retry, and zero remaining
nested worker targets after cancellation. Form tests verify that previous downloads remain
usable after failure and cancellation. Development and preview smoke checks pass too.

## Build time and loading costs

Representative timings from the full parity matrix, seconds, one observation per case:

| fixture/mode | native | browser |
|---|---:|---:|
| general/fast | 4.58 | 4.43 |
| heavy/fast | 3.95 | 4.15 |
| tiles/fast | 0.85 | 0.91 |
| gradient/fast | 7.60 | 7.69 |
| tiles/release | 5.15 | 5.25 |
| gradient/release | 27.71 | 27.47 |

The dedicated four-fixture benchmark measured browser release builds at 5.30 s (tiles),
27.47 s (gradient), 22.04 s (general), and 18.65 s (heavy). The former browser baseline was
6.67 s, 14.01 s, 9.84 s, and 9.74 s respectively; the first old case included initialization.
Release parity therefore costs time on three of these four fixtures. The matching fast mode
and cached repeats give users a quicker path without changing what a chosen mode means.

These smoke measurements establish comparable execution costs, not a claim that WASI is
faster than native. Release retains 120 Zopfli iterations; fast uses 15. The old browser
skipped Zopfli entirely, so full release parity can take longer than its old substitute
pipeline. Responsiveness and cached repeats are the speed improvements guaranteed here.

Fresh browser worker initialization took **320 ms** on the local benchmark server. Real
network transfer latency is additional. The emitted WASM is **10,322,976 bytes**,
approximately **3,488,533 bytes with gzip**. All emitted JS plus WASM total approximately
**3.81 MB with gzip**, including the check-page script; these gzip sizes are estimates from
the built files, not captured CDN responses. Assets load only after selecting a source or
requesting a build and use immutable HTTP caching under hashed URLs.

The upstream loader allocates **250 MiB of initial shared WASM memory** plus worker/runtime
overhead and possible growth. This change does not lower the browser's memory requirement.
It needs HTTPS/localhost and cross-origin isolation on document and worker responses. An
unsupported browser receives a CLI alternative; it never silently switches encoders.

## Accuracy and rejected experiment

The accuracy sweep reproduces all thirty existing rows in `BENCHMARKS.md`. At the default
palette, the worst non-gradient row remains 0.114%. The existing gradient exception remains:
the sweep reports up to 1.74% at 256 colors, outside the 1% non-gradient gate. Parity preserves
the CLI's current output; this work does not claim to repair that existing quality limit.

An additional lossless optimization pass on the selected PNG before Zopfli saved **zero
bytes** across eleven fast-mode fixtures: **67,181 PNG bytes in both arms**, with identical
decoded pixels. It is omitted. No codec change, iteration reduction, or parallel raster pool
was introduced. The initial experiment's aggregate timings include cold-start effects and
are not used as evidence of a speed gain.

## Reproducing the checks

```sh
pnpm install
pnpm test
pnpm --filter favseed-site test
pnpm --filter favseed-site build
node site/test/cdp-check.mjs
FAVSEED_BENCH=1 node site/test/cdp-check.mjs
node test/hashes.mjs
node bench/bench.mjs accuracy
node bench/parity.mjs
node bench/parity.mjs --placement
```

Chromium must be on PATH as `chromium` or `google-chrome`; set `CHROME=google-chrome` for the
latter. The benchmark mode prints four release-mode cases and initialization separately.
Generated `BENCHMARKS.md` remains the existing codec-sweep report; this document records the
browser integration measurements separately.
