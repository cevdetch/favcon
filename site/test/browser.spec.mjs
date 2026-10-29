import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildFiles } from '../../bin/favseed.mjs';
import { isolationHeaders } from '../headers.mjs';
import { cases } from './cases.mjs';

const fixture = (mark) => fileURLToPath(new URL(`../../test/fixtures/${mark}.svg`, import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const summary = ({ files, fit, links, animated }) => ({
  files: files.map(({ name, bytes }) => ({ name, hash: hash(bytes), size: bytes.length })),
  fit, links, animated,
});
const checkPage = async (page) => {
  const response = await page.goto('/check');
  for (const [name, value] of Object.entries(isolationHeaders)) expect(await response.headerValue(name)).toBe(value);
  await page.waitForFunction(() => !!window.favseedCheck);
  expect(await page.evaluate(() => window.favseedCheck.isolated)).toBe(true);
};

test('files and metadata match the CLI; archives, cache and page timers work', async ({ page, isMobile }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await checkPage(page);
  const selected = isMobile ? cases.filter((item) =>
    ['gradient/fast', 'tiles/release', 'transparent-aliases', 'custom-manifest'].includes(item.name)) : cases;
  let fileCount = 0;
  for (const item of selected) {
    await test.step(item.name, async () => {
      const input = fixture(item.mark), source = await readFile(input, 'utf8');
      const options = { manifest: true, ...item.options };
      const expected = summary(await buildFiles({ input, ...options }));
      const actual = await page.evaluate(({ source, options }) => window.favseedCheck.build(source, options), { source, options });
      expect({ files: actual.files, fit: actual.fit, links: actual.links, animated: actual.animated }).toEqual(expected);
      expect(actual.ticks).toBeGreaterThan(0);
      fileCount += actual.files.length;
    });
  }
  const source = await readFile(fixture('general'), 'utf8'), options = { mode: 'fast', sizes: [180, 32] };
  expect(await page.evaluate(({ source, options }) => window.favseedCheck.cache(source, options), { source, options })).toBe(true);
  const repeat = await page.evaluate(({ source, options }) => window.favseedCheck.build(source, options), { source, options });
  expect(repeat.progress).toEqual([]);
  expect(errors).toEqual([]);
  console.log(`${test.info().project.name}: ${fileCount} files match native across ${selected.length} cases`);
});

test('invalid options, cancellation and worker retry leave the engine usable', async ({ page }) => {
  await checkPage(page);
  const source = await readFile(fixture('general'), 'utf8'), options = { mode: 'fast', sizes: [32] };
  expect(await page.evaluate((source) => window.favseedCheck.invalid(source), source)).toBe(true);
  await page.evaluate(() => window.favseedCheck.dispose());
  expect(await page.evaluate(({ source, options }) => window.favseedCheck.cancel(source, options, 'initialization'), { source, options })).toBe(true);
  await page.evaluate(({ source, options }) => window.favseedCheck.build(source, options), { source, options });
  expect(await page.evaluate(({ source, options }) => window.favseedCheck.cancel(source, options, 'raster'),
    { source, options: { ...options, padding: 20 } })).toBe(true);
  const actual = await page.evaluate(({ source, options }) => window.favseedCheck.build(source, options), { source, options });
  expect(actual.files).toEqual(summary(await buildFiles({ input: fixture('general'), manifest: true, ...options })).files);
});

test('form downloads match native and survive failed and cancelled builds', async ({ page, isMobile }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  if (isMobile) await page.evaluate(() => {
    window.favseedTouches = 0;
    document.addEventListener('touchstart', () => window.favseedTouches++);
  });
  await expect(page.locator('#cancel')).toBeHidden();
  await page.locator('input[type=file]').setInputFiles(fixture('tiles'));
  await page.locator('select[name=mode]').selectOption('fast');
  const generate = page.getByRole('button', { name: 'Generate', exact: true });
  if (isMobile) await generate.tap(); else await generate.click();
  await expect(page.locator('output')).toHaveClass('good', { timeout: 90_000 });
  await expect(page.locator('#result')).toBeVisible();
  const expected = summary(await buildFiles({ input: fixture('tiles'), mode: 'fast', manifest: true }));
  const actual = await page.locator('#files a').evaluateAll(async (links) => Promise.all(links.map(async (link) => {
    const bytes = await (await fetch(link.href)).arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return { name: link.download, size: bytes.byteLength, hash: Array.from(digest, (n) => n.toString(16).padStart(2, '0')).join('') };
  })));
  expect(actual).toEqual(expected.files);
  const downloadEvent = page.waitForEvent('download');
  if (isMobile) await page.locator('#zip').tap(); else await page.locator('#zip').click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('favseed.zip');
  const zip = await readFile(await download.path());
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const url = await page.locator('#zip').getAttribute('href');
  await page.locator('input[name=bg]').fill('#ffffff80');
  await generate.click();
  await expect(page.locator('output')).toHaveClass('bad');
  await expect(generate).toBeEnabled();
  await expect(page.locator('#zip')).toHaveAttribute('href', url);
  await page.locator('input[name=bg]').fill('#000000');
  await page.locator('input[name=padding]').fill('20');
  await generate.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('output')).toHaveText('Cancelled.');
  await expect(page.locator('#zip')).toHaveAttribute('href', url);
  expect(await page.evaluate(async () => (await (await fetch(document.getElementById('zip').href)).arrayBuffer()).byteLength)).toBe(zip.length);
  if (isMobile) {
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth }));
    expect(layout.width).toBeLessThanOrEqual(layout.viewport);
    expect(await page.evaluate(() => window.favseedTouches)).toBeGreaterThan(0);
    for (const control of ['button[type=submit]', '#zip']) {
      expect((await page.locator(control).boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
  }
  expect(errors).toEqual([]);
});

test('missing document isolation gives the CLI alternative and restores form controls', async ({ page }) => {
  await page.goto('/?no-isolation');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await page.locator('input[type=file]').setInputFiles(fixture('tiles'));
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('output')).toHaveClass('bad');
  await expect(page.locator('output')).toContainText('favseed CLI');
  await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  await expect(page.locator('#cancel')).toBeHidden();
  await expect(page.locator('#result')).toBeHidden();
});

test('missing worker isolation rejects initialization and permits retry', async ({ page }) => {
  test.setTimeout(30_000);
  let intercepted = false;
  await page.route('**/engine-worker-*.js', async (route) => {
    intercepted = true;
    const response = await route.fetch();
    const headers = { ...response.headers(), 'cross-origin-embedder-policy': 'unsafe-none' };
    await route.fulfill({ response, headers });
  });
  await checkPage(page);
  await expect(page.evaluate(() => window.favseedCheck.warm())).rejects.toThrow();
  expect(intercepted).toBe(true);
  await page.unroute('**/engine-worker-*.js');
  await page.evaluate(() => window.favseedCheck.warm());
});
