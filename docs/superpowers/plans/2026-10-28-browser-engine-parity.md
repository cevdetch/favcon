# Browser engine parity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce identical browser and CLI files while keeping the page responsive and measuring performance and output improvements.

**Architecture:** Both hosts inject pinned native/WASI image adapters into `createEngine()` and run `buildSet()`. A browser module worker owns the WASI engine, build cache, and ZIP creation; a small client handles requests, cancellation, and transfer ownership.

**Tech stack:** Node 24+, Astro/Vite, @napi-rs/image and its WASI distribution 1.15.0, @gfx/zopfli 1.0.15, SVGO 4, browser DecompressionStream, node:test and Chromium CDP.

**Spec:** `docs/superpowers/specs/2026-10-28-browser-cli-parity-design.md`

## Global constraints

- Matching source, normalized options, and mode produce identical files and metadata.
- No uploads or persistent user-data storage; no alternative encoder fallback.
- Default release iterations remain 120; fast remains 15. Accuracy remains pct <= 1.0%.
- Placement render cache: per build, at most 16 MiB. Browser result cache: one entry, at most 16 MiB, owned copies.
- Measure cold and warm costs separately; report the upstream 250 MiB initial shared memory and actual asset sizes.
- Keep existing CHROME allowlist, CLI API, integration behavior, and output naming.

## Review focus

- Cancellation during initialization or synchronous Zopfli must release nested workers and allow retry (task 2 browser lifecycle test).
- Caller mutation or transferred alias buffers must not corrupt cached files (task 2 cache and real-browser tests).
- Options differing only in vars, manifest, base, or compression mode must not collide in the cache (task 2 unit tests and task 3 parity matrix).
- A failed build must preserve prior usable download links (task 3 UI cancellation/failure checks).
- Missing isolation and incorrect worker asset headers must fail clearly instead of hanging (task 2 capability and browser HTTP checks).

### Task 1: Shared placement reuse and progress

**Files:** Modify `lib/pipeline.mjs`, `test/pipeline.mjs`; create benchmark baseline artifacts in ignored execution workspace.

**Interfaces:** `buildSet(source, options, {engine, optimiseSvg, name?, warn?, progress?})` retains its return shape. Optional progress callback receives `{phase, completed, total}` with phases `placement`, `raster`, `complete`. Render cache is local to each invocation.

- [ ] Capture existing `node test/hashes.mjs`, `pnpm test`, site build, and four-fixture browser timings/bytes before replacing the browser pipeline.
- [ ] Add a test wrapping `engine.renderRgba` with a call counter, building `sizes:[180,192]`, and asserting no identical transparent render arguments repeat. Assert progress reaches completed === total and the result bytes/fit equal uncached reference behavior. Watch it fail.
- [ ] Implement bounded FIFO transparent render reuse, placement reuse by canvas, and progress events without changing render or compression settings. Include cache keys for SVG and size; oversized entries bypass caching.
- [ ] Run `node --test test/pipeline.mjs` and compare the 66 hashes with baseline; expect pass and identical hashes.
- [ ] Commit shared pipeline changes with cevdetch coauthor.

### Task 2: WASI browser worker and client

**Files:** Replace `site/src/lib/pipeline.mjs`; create `site/src/lib/engine-worker.mjs`, `site/src/lib/worker-client.mjs`, `site/src/lib/build-cache.mjs`, `site/test/worker.mjs`; modify `site/package.json`, lockfile, `site/astro.config.mjs`, `site/test/cdp-check.mjs` headers.

**Interfaces:** Client factory `createWorkerClient({createWorker, checkCapabilities})` exposes `warm()`, `build(source, options, {signal?, onProgress?}={})`, and `dispose()`. Public `buildInBrowser(source, options={}, controls={})` preserves manifest=true browser default and returns shared result plus `archive():Uint8Array`. `warm()` warms worker initialization. Worker messages carry `{id,type}`; builds include source/options; success includes result and archive bytes; errors include a message. Cache helper `createBuildCache(limit=16*1024*1024)` exposes `get(key)` and `set(key,result)` with owned copies; `buildKey(source,normalizedOptions)` includes all output options and sorted vars.

- [ ] Add node:test cases for client cancellation during initialization/build, stale messages, progress, errors followed by retry, capability rejection, and cache ownership/limits/key differences. Fake workers emulate the actual protocol, not the image implementation. Watch new behaviors fail.
- [ ] Replace browser codec dependencies with exact WASI 1.15.0 and Buffer polyfill; retain pinned Zopfli and SVGO. Install through workspace pnpm.
- [ ] Implement the client, bounded result cache, and worker. Initialize Buffer before dynamic WASI import; inject browser inflate and shared SVG stage/engine/pipeline; create ZIP in worker. Transfer unique owned buffers and leave cache undetached. Normalize on the client before starting expensive work and again only if needed at the trusted worker boundary.
- [ ] Add COOP/COEP/CORP to production headers, Vite dev/preview and test server. Set worker format `es`, build target for top-level await, and WASI optimization exclusions. Verify nested workers terminate on cancel using the real browser, adding tracked nested worker cleanup if upstream parent termination alone is insufficient.
- [ ] Run `node --test site/test/worker.mjs`, site build, and current real-browser self-check. Expect worker startup, valid outputs, cancellation/retry, correct headers, and no uncaught browser errors. Debug actual bundler behavior before adding any Vite URL workaround.
- [ ] Commit worker and hosting changes with cevdetch coauthor.

### Task 3: Browser parity and usable controls

**Files:** Modify `site/src/pages/index.astro`, `site/src/pages/check.astro`, `site/test/cdp-check.mjs`, site package scripts and CI site job as needed; create shared test case module `site/test/cases.mjs`.

**Interfaces:** The check page exposes test-only `window.favseedCheck` methods to build supplied SVG/options and return hashes, metadata, archive verification, timings, and lifecycle diagnostics. Node harness generates native references with `buildFiles()`/`buildSet()`, passes SVG/options through CDP, and compares every filename, hash, fit, links, and animation value. No production endpoint or native fixture artifacts.

- [ ] Add actual-browser parity checks for eleven fast-mode fixtures; release-mode tiles and gradient; targeted cases covering none background, fixed padding, 180/32 aliases, manifest extras, base, vars and animation off. First verify old pipeline fails byte comparison against native references.
- [ ] Add real worker cancellation/retry, cached alias-buffer mutation, progress, responsiveness timer, isolation, and ZIP-entry verification to browser checks. Check UI retains prior links across cancellation/failure and object URLs are replaced on success.
- [ ] Add release/fast select, Cancel control, progress updates, abort signals and stale submit protection. Retain successful results until a new success; revoke object URLs on replacement/page teardown. Replace obsolete differing-bytes explanation with tested matching-option parity and truthful loading costs.
- [ ] Run unit tests, site build and full CDP matrix within bounded CI time. Smoke-test Vite dev and preview worker initialization with headers. Expect all file hashes and shared metadata equal native references.
- [ ] Commit parity checks and UI with cevdetch coauthor.

### Task 4: Measurements, compression experiment and final verification

**Files:** Create `bench/parity.mjs` or extend test harness benchmark mode; update `docs/BENCHMARKS.md`, `docs/DECISIONS.md`, README/browser documentation as needed; modify `lib/engine.mjs` and `test/engine.mjs` only if the measured compression candidate earns inclusion.

**Interfaces:** Benchmark emits comparable native/browser cold, first, warm and repeated timings, output byte totals, and built transfer sizes. Keep raw evidence in the execution workspace and summarize reproducible commands in documentation.

- [ ] Measure interleaved native baseline/candidate lossless reoptimization of quantized PNGs using the fixture corpus; assert equal decoded pixels and record time/byte deltas. Keep candidate only with worthwhile measured benefit; if retained add a failing engine regression first, then implementation.
- [ ] Run required benchmark sweeps and default accuracy checks. Record per-fixture output changes and worst accuracy, avoiding aggregate-only quality claims.
- [ ] Run `pnpm test`, all browser worker tests, full site parity matrix, hashes, production build, development smoke test, and `git diff --check`. Confirm no security regression and review actual dependency/bundle changes.
- [ ] Document measured wins and costs, complete task ledger, commit with coauthor, then request fresh whole-branch code review. Fix important findings with regression tests and verify the relevant suite before reporting completion.
