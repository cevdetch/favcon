// Exercise the inputs reported by CodeQL through their real entry points.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { optimiseSvg } from '../bin/favseed.mjs';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

describe('CSS comment scanning', () => {
  it('keeps selectors needed by animation rules when comments surround the rules', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
      + '<style>/* before */.mark{fill:#123456}/* between */'
      + '@media(prefers-reduced-motion:no-preference){.mark{animation:pulse 1s}}/* after */'
      + '</style><path class="mark" d="M0 0h10v10H0z"/></svg>';
    const icon = optimiseSvg(source, { icon: true }).data;
    assert.match(icon, /fill="#123456"/);
    assert.doesNotMatch(icon, /<style/);
    const logo = optimiseSvg(source, { icon: false }).data;
    assert.match(logo, /class="mark"/);
    assert.match(logo, /prefers-reduced-motion/);
    assert.match(logo, /animation:/);
  });

  for (const icon of [true, false]) {
    it(`handles repeated unclosed comments in the ${icon ? 'icon' : 'logo'} pass without stalling`, async () => {
      // A child bounds the test even if synchronous regexp backtracking blocks the event loop.
      const script = `
        import assert from 'node:assert/strict';
        import { optimiseSvg } from './bin/favseed.mjs';
        const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
          + '<style>/*' + 'a/*'.repeat(500000) + '</style><path d="M0 0h10v10H0z"/></svg>';
        const { data } = optimiseSvg(source, { icon: ${icon} });
        assert.match(data, /<path/);
        assert.doesNotMatch(data, /<style/);
        console.log('finished');
      `;
      const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script],
        { cwd: ROOT, timeout: 5000 });
      assert.equal(stdout.trim(), 'finished');
    });
  }
});

describe('benchmark sweep selection', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'no-such-sweep']) {
    it(`rejects ${name} as an unknown sweep`, async () => {
      await assert.rejects(execFileAsync(process.execPath, [join(ROOT, 'bench/bench.mjs'), name],
        { cwd: ROOT, timeout: 5000 }), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stderr, `bench: no sweep '${name}'\n`);
        assert.equal(error.stdout, '');
        return true;
      });
    });
  }
});

describe('browser executable selection', () => {
  it('rejects an executable outside the supported browsers before starting the check', async () => {
    await assert.rejects(execFileAsync(process.execPath, [join(ROOT, 'site/test/cdp-check.mjs')],
      { cwd: ROOT, env: { ...process.env, CHROME: process.execPath }, timeout: 5000 }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /^cdp-check: CHROME must be chromium or google-chrome\n$/);
      assert.equal(error.stdout, '');
      return true;
    });
  });
});
