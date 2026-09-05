import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_PATH as BASE, distRoot, launchBrowser, serveDist } from './website-browser-support.mjs';

/**
 * The home page "Flip through the app" channel switcher.
 *
 * The structural half reads the built HTML: a vertical tablist with one
 * selected channel, roving tabindex, and a panel per channel. The
 * interaction half serves the build over HTTP and drives it in Chromium:
 * autoplay advances, hover and focus pause independently, arrow keys move
 * the selection together with the panel, caption and on-screen badge, and
 * `prefers-reduced-motion` turns autoplay off. Without a Chromium the browser
 * half is skipped locally and fails in CI (see website-browser-support.mjs).
 */

const CHANNELS = ['dashboard', 'live-tv', 'epg', 'movies', 'downloads', 'settings'];

test('showcase markup: a vertical tablist with one selected channel and a panel each', async () => {
  const html = await readFile(join(distRoot, 'index.html'), 'utf8');
  assert.match(html, /<section id="screenshots"/);
  assert.match(html, /role="tablist"[^>]*aria-orientation="vertical"/);

  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, CHANNELS.length, 'one tab per channel');
  for (const [i, tab] of tabs.entries()) {
    assert.match(tab, new RegExp(`data-channel="${CHANNELS[i]}"`));
    assert.match(tab, new RegExp(`aria-controls="screen-panel-${CHANNELS[i]}"`));
    assert.match(tab, new RegExp(`aria-selected="${i === 0 ? 'true' : 'false'}"`));
    assert.match(tab, new RegExp(`tabindex="${i === 0 ? '0' : '-1'}"`));
  }

  const panels = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
  assert.equal(panels.length, CHANNELS.length, 'one panel per channel');
  for (const [i, panel] of panels.entries()) {
    assert.match(panel, new RegExp(`id="screen-panel-${CHANNELS[i]}"`));
    assert.match(panel, new RegExp(`aria-labelledby="screen-tab-${CHANNELS[i]}"`));
    assert.match(panel, new RegExp(`aria-hidden="${i === 0 ? 'false' : 'true'}"`));
  }
  assert.match(html, /href="\/iptvnator\/features\/epg\/"/, 'captions link into the feature pages');

  const frames = panels.map((panel) => html.slice(html.indexOf(panel)).match(/<img[^>]*>/)[0]);
  assert.equal(frames.filter((img) => / src="/.test(img)).length, 1, 'only the first frame ships with a src');
  assert.ok(frames.every((img) => /data-src="\/iptvnator\/screenshots\//.test(img)), 'every frame carries its data-src');
});

const selectedChannel = (page) => page.$eval('.channel-tab[aria-selected="true"]', (el) => el.dataset.channel);
const progressWidth = (page) =>
  page.$eval('.channel-tab[aria-selected="true"] .channel-progress', (el) => parseFloat(el.style.width) || 0);
const hiddenPanels = (page) => page.$$eval('.channel-panel', (els) => els.map((el) => el.getAttribute('aria-hidden')));

test('showcase interaction: autoplay, pausing, keyboard and synchronized state', async (t) => {
  const browser = await launchBrowser();
  if (!browser) {
    t.skip('no Chromium available for the browser half');
    return;
  }
  const { server, origin } = await serveDist();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${origin}${BASE}/`, { waitUntil: 'networkidle' });
    await page.locator('#screenshots').scrollIntoViewIfNeeded();
    // Park the pointer away from the block so hover cannot pause autoplay.
    await page.mouse.move(5, 5);

    await page.waitForFunction(
      () => parseFloat(document.querySelector('.channel-tab[aria-selected="true"] .channel-progress').style.width) > 5,
      null,
      { timeout: 5000 },
    );
    assert.equal(await selectedChannel(page), 'dashboard', 'autoplay starts on the first channel');
    const loaded = (p) => p.$$eval('.channel-panel img', (els) => els.map((el) => Boolean(el.getAttribute('src'))));
    assert.deepEqual(await loaded(page), [true, true, false, false, false, false], 'only the shown frame and the next one have a src');

    // Hover pauses.
    await page.locator('.channel-tab').nth(2).hover();
    await page.waitForTimeout(150);
    const pausedAt = await progressWidth(page);
    await page.waitForTimeout(700);
    assert.ok(Math.abs((await progressWidth(page)) - pausedAt) < 0.5, 'progress holds while hovered');

    // Clicking selects immediately and focus keeps the pause after the pointer leaves.
    await page.locator('.channel-tab').nth(2).click();
    assert.equal(await selectedChannel(page), 'epg');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.channel), 'epg', 'click moves focus to the tab');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(900);
    assert.equal(await progressWidth(page), 0, 'a focused tab keeps autoplay paused after mouseleave');
    assert.equal(await selectedChannel(page), 'epg');

    // Keyboard: ArrowDown / ArrowUp / End / Home move selection, focus, panel, caption and badge together.
    await page.keyboard.press('ArrowDown');
    assert.equal(await selectedChannel(page), 'movies');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.channel), 'movies');
    assert.deepEqual(await hiddenPanels(page), ['true', 'true', 'true', 'false', 'true', 'true']);
    assert.equal(await page.$eval('[data-caption-label]', (el) => el.textContent.trim()), 'Movies & series');
    assert.equal(await page.$eval('[data-osd-number]', (el) => el.textContent.trim()), 'CH 04');
    assert.deepEqual((await loaded(page)).slice(2, 5), [true, true, true], 'a shown frame and its successor get their src');
    assert.equal(await page.$eval('.channel-osd', (el) => el.classList.contains('opacity-0')), false, 'badge shows on switch');
    await page.keyboard.press('ArrowUp');
    assert.equal(await selectedChannel(page), 'epg');
    await page.keyboard.press('End');
    assert.equal(await selectedChannel(page), 'settings');
    await page.keyboard.press('ArrowDown');
    assert.equal(await selectedChannel(page), 'dashboard', 'ArrowDown wraps around');
    await page.keyboard.press('Home');
    assert.equal(await selectedChannel(page), 'dashboard');
    const tabIndexes = await page.$$eval('.channel-tab', (els) => els.map((el) => el.tabIndex));
    assert.deepEqual(tabIndexes, [0, -1, -1, -1, -1, -1], 'roving tabindex follows the selection');

    // Blurring the list resumes autoplay.
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForFunction(
      () => parseFloat(document.querySelector('.channel-tab[aria-selected="true"] .channel-progress').style.width) > 5,
      null,
      { timeout: 5000 },
    );
    assert.deepEqual(errors, []);
    await page.close();

    // Reduced motion: no autoplay at all.
    const calm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await calm.goto(`${origin}${BASE}/`, { waitUntil: 'networkidle' });
    await calm.locator('#screenshots').scrollIntoViewIfNeeded();
    await calm.mouse.move(5, 5);
    await calm.waitForTimeout(1500);
    assert.equal(await progressWidth(calm), 0, 'no progress under prefers-reduced-motion');
    assert.equal(await selectedChannel(calm), 'dashboard');
    await calm.keyboard.press('Tab');
    await calm.locator('.channel-tab').nth(1).click();
    assert.equal(await selectedChannel(calm), 'live-tv', 'manual switching still works');
    await calm.close();
  } finally {
    await browser.close();
    server.close();
  }
});
