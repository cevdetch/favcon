// buildSet on its own: the file set, the order and the determinism, with nothing written.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { loadEngine, optimiseSvg } from '../bin/favseed.mjs';
import { normaliseOptions } from '../lib/config.mjs';
import { buildSet } from '../lib/pipeline.mjs';
import { header } from './lib/png.mjs';

const read = (n) => readFileSync(new URL(`./fixtures/${n}.svg`, import.meta.url), 'utf8');
const engine = await loadEngine();
const opts = ({ iterations = 0, ...extra } = {}) => ({ ...normaliseOptions({ sizes: [32], ...extra }), iterations });
const run = (name, extra) => buildSet(read(name), opts(extra), { engine, optimiseSvg, name: `${name}.svg` });

describe('buildSet', () => {
  it('returns the set in the CLI order, as bytes', async () => {
    const set = await run('general', { manifest: true });
    assert.deepEqual(set.files.map((f) => f.name),
      ['icon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-32.png', 'site.webmanifest']);
    for (const f of set.files) assert.ok(f.bytes instanceof Uint8Array && f.bytes.length > 0, f.name);
    assert.equal(header(Buffer.from(set.files[2].bytes)).width, 180);
  });

  it('gives the same bytes twice', async () => {
    const a = await run('heavy', { iterations: 15 }), b = await run('heavy', { iterations: 15 });
    assert.deepEqual(a.files.map((f) => [...f.bytes]), b.files.map((f) => [...f.bytes]));
  });

  it('default quality 80 matches its explicit setting and quality 100 restores higher fidelity', async () => {
    const defaults = await run('gradient'), full = await run('gradient', { quality: 100 }), low = await run('gradient', { quality: 80 });
    assert.deepEqual(low, defaults);
    assert.deepEqual(low.fit, full.fit);
    assert.deepEqual(low.files.find((f) => f.name === 'icon.svg'), full.files.find((f) => f.name === 'icon.svg'));
    const pixels = (set) => set.files.find((f) => f.name === 'apple-touch-icon.png').bytes;
    assert.ok(pixels(low).length < pixels(full).length);
    assert.notDeepEqual(pixels(low), pixels(full));
  });

  it('emits one SVG preserving motion, style references and accessibility', async () => {
    const set = await run('animated');
    assert.equal(set.animated, true);
    assert.deepEqual(set.files.filter((f) => f.name.endsWith('.svg')).map((f) => f.name), ['icon.svg']);
    const icon = new TextDecoder().decode(set.files.find((f) => f.name === 'icon.svg').bytes);
    assert.match(icon, /@keyframes/);
    assert.match(icon, /prefers-reduced-motion/);
    assert.match(icon, /class="ring"/);
    assert.match(icon, /aria-label="Animated fixture"/);
    const still = await run('animated', { animation: false });
    assert.equal(still.animated, false);
    assert.doesNotMatch(new TextDecoder().decode(still.files.find((f) => f.name === 'icon.svg').bytes), /@keyframes|animation:/);
  });

  it('optimizes the preserved SVG once and leaves its non-square viewBox intact', async () => {
    let calls = 0;
    const set = await buildSet(read('wide'), opts(), { engine, optimiseSvg: (...args) => {
      calls++; return optimiseSvg(...args);
    } });
    assert.equal(calls, 1);
    const icon = new TextDecoder().decode(set.files.find((f) => f.name === 'icon.svg').bytes);
    assert.match(icon, /viewBox="0 0 128 64"/);
    assert.doesNotMatch(icon, /preserveAspectRatio="none"/);
  });

  it('rejects input that is not an SVG', async () => {
    await assert.rejects(buildSet('hello', opts(), { engine, optimiseSvg, name: 'x.txt' }),
      /not an SVG \(no <svg> element found\): x\.txt/);
  });

  it('rejects a translucent ground before rendering anything', async () => {
    await assert.rejects(run('flat', { bg: '#ffffff80' }), /--bg must be opaque/);
  });

  it('overlaps default raster jobs within four slots and keeps large jobs serial', async () => {
    for (const [sizes, concurrent] of [[[192, 512], true], [[1024], false]]) {
      let active = 0, peak = 0;
      const counted = { ...engine,
        render: async (...args) => {
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return engine.render(...args);
        },
        finish: async (...args) => { const out = await engine.finish(...args); active--; return out; },
      };
      const set = await buildSet(read('tiles'), opts({ sizes, padding: 20 }), { engine: counted, optimiseSvg });
      assert.equal(active, 0);
      assert.ok(peak <= 4);
      assert.equal(peak > 1, concurrent);
      assert.equal(set.files.filter((f) => f.name.endsWith('.png')).length, sizes.length + 1);
    }
  });

  it('drains sibling raster jobs before reporting a failed batch', async () => {
    const finished = [];
    const failing = { ...engine,
      render: async (svg, px, bg) => {
        if (px === 180) throw new Error('raster failed');
        await new Promise((resolve) => setTimeout(resolve, 10));
        return engine.render(svg, px, bg);
      },
      finish: async (png, options) => {
        const out = await engine.finish(png, options);
        finished.push(new DataView(png.buffer, png.byteOffset).getUint32(16));
        return out;
      },
    };
    await assert.rejects(buildSet(read('tiles'), opts({ sizes: [192, 512], padding: 20 }),
      { engine: failing, optimiseSvg }), /raster failed/);
    assert.deepEqual(finished.sort((a, b) => a - b), [32, 192, 512]);
  });

  it('reuses transparent placement renders and reports completed raster jobs', async () => {
    const calls = new Map(), events = [];
    const counted = { ...engine, renderRgba: async (svg, px) => {
      const key = `${svg}\0${px}`;
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return engine.renderRgba(svg, px);
    } };
    const options = opts({ sizes: [180, 192] });
    const actual = await buildSet(read('general'), options,
      { engine: counted, optimiseSvg, progress: (event) => events.push(event) });
    assert.ok([...calls.values()].every((n) => n === 1), 'each placement render is reused');
    assert.equal(events[0].phase, 'placement');
    assert.deepEqual(events.at(-1), { phase: 'complete', completed: 3, total: 3 });
    assert.deepEqual(events.filter((e) => e.phase === 'raster').map((e) => e.completed), [0, 1, 2, 3]);
    const expected = await buildSet(read('general'), options, { engine, optimiseSvg });
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual.files[2].bytes, actual.files[3].bytes, '180px alias matches apple');
  });
});
