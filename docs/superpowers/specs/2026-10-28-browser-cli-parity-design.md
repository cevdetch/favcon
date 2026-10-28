# Browser and CLI engine parity

Status: approved by the user, 2026-10-28. Implementation measurements: `docs/BROWSER-PARITY.md`.

## Intent

Use the same engine and build pipeline in the browser and CLI. Identical SVG source, normalized options, and build mode must produce identical filenames, ordering, and bytes. Improve responsiveness, repeated-build speed, and output quality or size where measurements support the change.

The user permits measured changes to both outputs when files become smaller at equal or better visual accuracy. Existing CLI bytes are a baseline, not a compatibility requirement. The repository's accuracy requirements and preference for smaller files still apply. A speed improvement alone does not justify worse visual results.

## Approaches

The proposed approach uses the pinned native and WASI distributions of `@napi-rs/image` with the existing import-free `createEngine()` and `buildSet()`. Native and WASI byte equality has already been demonstrated in the project's earlier isolated prototype; this work makes it a maintained end-to-end guarantee. The CLI keeps native execution. The browser runs WASI in a dedicated worker.

Using WASI in both hosts would simplify distribution identity but impose browser-oriented memory and startup costs on the CLI. A custom trimmed WASM build might reduce download size but creates a separate codec build and maintenance obligation. The existing architecture and pinned upstream WASI build make the first approach the practical starting point. A custom build is outside this change.

The approach and details below are implementation proposals, not additional requirements attributed to the user.

## Scope and constraints

- Share SVG processing, option validation, placement, rasterization, quantization, compression, ICO assembly, manifest content, and links through the existing library modules.
- Preserve the browser's local processing model: no upload endpoint or persistent storage of source SVGs or generated files.
- Preserve the CLI API, existing release and fast modes, filename conventions, and browser download/archive behavior. Add a browser mode selector using those existing modes, defaulting to release.
- Keep framework integrations on the same engine and pipeline. Do not add a new rendering fallback that would silently produce different bytes.
- Do not publish a release or package as part of this implementation.

Parity applies to all returned files, including SVG, PNG, ICO, and manifest, and to generated links and placement results. Compare matching explicit options: the browser can retain its manifest-enabled UI default while the CLI retains its existing default. ZIP packaging remains deterministic; the CLI does not currently expose a matching archive command.

## Shared engine and host adapters

Keep `lib/engine.mjs` and `lib/pipeline.mjs` free of platform imports. The native adapter continues injecting the pinned native image implementation, Zopfli, and Node inflate. The browser adapter injects the same-version WASI image implementation, the existing pinned Zopfli implementation, and browser deflate decompression. Any host-specific decompression must be verified against the same PNG input and resulting pixels.

Use `normaliseOptions()` in the browser. Remove its independent raster, quantization, placement orchestration, and PNG optimization implementation. Continue using the shared SVGO configuration with the browser SVGO entry point at the same pinned version.

Initialize the Buffer polyfill before dynamically importing WASI. Use the upstream loader and nested worker support rather than copying a partial generated loader. Keep image calls asynchronous so WASI pthread messages can be serviced. Copy outputs into owned regular ArrayBuffers before transfer; deduplicate transfer lists because multiple filenames can share one buffer.

The published image WASM is 10,322,976 bytes uncompressed; the package tarball is approximately 3.55 MB compressed. Its loader creates 250 MiB of initial shared memory and a worker pool. These are material costs, not speed improvements. Record actual built transfer size, initialization time, and observable memory limitations. Do not claim a universal cold-start or memory improvement.

## Browser execution and user experience

Lazy-load engine code when a valid SVG is selected or a build is requested. Keep the heavy pipeline and archive creation in a module worker. The page remains responsive during rasterization and compression.

Use request IDs for build, progress, completion, error, and cancellation messages. Progress reports meaningful phases and completed output counts; Zopfli may occupy a worker between reports. Cancellation terminates the active worker and its nested workers, invalidates its request ID, and permits a clean retry. Verify upstream disposal and worker termination behavior rather than assuming termination cleans up every nested worker.

Retain the last successful preview and download links until the next build succeeds. Revoke replaced object URLs and clean them up when the page closes. Ignore late progress or results from cancelled or superseded requests. Initialization failure resets the loader so retry is possible.

If shared memory, cross-origin isolation, or another required browser capability is unavailable, show a useful explanation with a CLI alternative. Do not silently select a different encoder. Replace the current claim that browser bytes differ from CLI bytes with tested parity and an explanation of release/fast settings.

## Hosting and security

WASI requires a secure context and cross-origin isolation. Configure document and worker responses with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, with appropriate same-origin resource policy. Apply equivalent headers to development, preview, production `_headers`, and the browser test server. Preserve immutable caching for hashed assets.

Use ES module worker output, including nested WASI workers. Verify dev and built asset resolution; upstream documents a nested worker URL resolution issue in Vite development. Apply a narrowly scoped fix only if reproduced. Verify actual HTTP responses and `crossOriginIsolated` in the browser test.

Retain the existing restrictive CHROME executable allowlist and security regressions. No new arbitrary process execution or source uploads.

## Performance improvements

Measure the existing baseline before changing the engine. Separate cold load/initialization, first build, warm build, repeated identical build, output bytes, and page responsiveness. Report browser and native results separately and identify benchmark environment and mode.

Start with two bounded reuse opportunities: transparent RGBA renders repeated during placement, and one completed browser build. Placement cache keys include every rendering argument; keep it per build, with a 16 MiB byte budget and deterministic eviction. The browser result cache holds at most one entry and 16 MiB of owned bytes; oversized results are not cached. Its key includes source and every normalized output option, including mode, vars, base, and manifest. Copy cached results before transfer to prevent detachment or caller mutation. No persistent user-data cache.

Benchmark lossless reoptimization of a quantized candidate as a possible output improvement. Keep it only if it preserves pixels and provides a worthwhile measured result under the repository's size/speed policy. Other codec changes need the same evidence. Do not reduce release compression iterations or add blind concurrency to manufacture a speed claim. If a candidate does not help, record that result and omit it.

The required improvements are responsive browser execution and faster repeated identical builds. Report cold-load or memory regressions honestly. Codec throughput and file-size improvements are evidence-driven opportunities rather than unmeasured guarantees.

## Verification and acceptance

1. Capture native and current browser benchmark baselines and the existing fixture hashes before implementation.
2. Retain and run the existing native, security, accuracy, and cross-platform hash checks. Output-changing optimizations must meet the existing visual accuracy bar on the fixture corpus and not conceal per-fixture regressions behind an average.
3. Extend the actual-browser CDP test to compare native references with worker-produced bytes, filenames, links, animation, and placement results. Use all eleven hash fixtures in fast mode, representative release-mode fixtures, and targeted options covering transparent/opaque backgrounds, fixed/automatic padding, repeated sizes, manifest customization, base, vars, and animation. Bound the matrix to the existing CI timeout and expand it only as needed for meaningful coverage.
4. Compute native references in the Node test harness and pass fixtures through CDP; do not ship a native-reference endpoint or reference artifacts in the public site. Compare every file hash and order. Verify ZIP entries against returned files and fixed archive metadata.
5. Exercise real worker initialization, caching without detached buffers, cancellation, retry, invalid options, and stale request handling. Test unsupported isolation through a controlled capability check. Confirm cancellation releases nested workers using browser instrumentation or observable worker lifecycle events.
6. Build the site and check the actual headers, worker asset loading, and absence of browser errors. Smoke-test development worker initialization as well as the production build.
7. Record cold/warm timings, output-byte deltas, built asset sizes, and accuracy results in repository documentation. Claim only improvements shown by those results. Obtain code review and run relevant CI/security checks before integration.

## Builder discretion

The implementer may settle internal worker message shapes, cache implementation, benchmark sample counts, precise progress wording, and small UI placement using existing conventions. Keep these changes focused on parity and measured performance. A finding that requires a new service, custom engine distribution, changed quality standard, or different browser support contract requires revisiting this design.
