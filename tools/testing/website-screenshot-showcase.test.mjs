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
  const toggleTag = html.match(/<button[^>]*data-autoplay-toggle[^>]*>/)?.[0];
  assert.ok(toggleTag && /aria-pressed="false"/.test(toggleTag), 'a persistent pause control ships in the markup');
  const tablist = html.match(/<div role="tablist"[\s\S]*?<\/div>/)?.[0];
  assert.ok(tablist, 'tablist element');
  assert.equal((tablist.match(/<button/g) ?? []).length, CHANNELS.length, 'the tablist holds exactly the tabs');
  assert.doesNotMatch(tablist, /data-autoplay-toggle/, 'the pause control lives outside the tablist');

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

    // The dwell really rolls over: tab, panel, caption and badge all move to channel 02.
    await page.waitForFunction(
      () => document.querySelector('.channel-tab[aria-selected="true"]')?.dataset.channel === 'live-tv',
      null,
      { timeout: 9000 },
    );
    assert.deepEqual(await hiddenPanels(page), ['true', 'false', 'true', 'true', 'true', 'true'], 'the panel follows autoplay');
    assert.equal(await page.$eval('[data-caption-label]', (el) => el.textContent.trim()), 'Live TV');
    assert.equal(await page.$eval('[data-osd-number]', (el) => el.textContent.trim()), 'CH 02');
    assert.deepEqual((await loaded(page)).slice(0, 3), [true, true, true], 'autoplay preloads the frame after the new channel');

    // The toggle pauses until pressed again, whatever the pointer and focus do.
    const toggle = page.locator('[data-autoplay-toggle]');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await toggle.getAttribute('aria-label'), 'Resume auto-advance');
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.activeElement?.blur());
    const stoppedAt = await progressWidth(page);
    await page.waitForTimeout(800);
    assert.ok(Math.abs((await progressWidth(page)) - stoppedAt) < 0.5, 'the toggle keeps autoplay paused after mouseleave and blur');

    // A channel picked while paused does not preload its successor; resuming fetches it.
    await page.locator('.channel-tab').nth(3).click();
    assert.equal(await selectedChannel(page), 'movies');
    assert.deepEqual((await loaded(page)).slice(3, 5), [true, false], 'paused: the picked frame loads, its successor does not');
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(300);
    const pausedOnMovies = await progressWidth(page);
    assert.ok(pausedOnMovies < 0.5, 'still paused on the newly picked channel');

    // Resume restarts autoplay at once, with the pointer and the focus still on the button.
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.deepEqual((await loaded(page)).slice(3, 5), [true, true], 'resuming preloads the successor');
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-autoplay-toggle')), true, 'the button keeps focus');
    await page.waitForTimeout(500);
    assert.ok((await progressWidth(page)) > pausedOnMovies + 2, 'autoplay runs while the toggle is focused and hovered');
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.activeElement?.blur());

    // Hover pauses.
    await page.locator('.channel-tab').nth(2).hover();
    await page.waitForTimeout(150);
    const pausedAt = await progressWidth(page);
    await page.waitForTimeout(700);
    assert.ok(Math.abs((await progressWidth(page)) - pausedAt) < 0.5, 'progress holds while hovered');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const resumed = await progressWidth(page);
    assert.ok(resumed >= pausedAt && resumed < pausedAt + 15, `progress resumes from where it paused (${pausedAt} → ${resumed})`);

    // Clicking selects immediately and focus keeps the pause after the pointer leaves.
    await page.locator('.channel-tab').nth(2).hover();
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

    // Scrolling the block away pauses the dwell; scrolling back resumes it from the same mark.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400); // let the IntersectionObserver report the exit
    const whileAway = await progressWidth(page);
    await page.waitForTimeout(700);
    const stillAway = await progressWidth(page);
    assert.ok(Math.abs(stillAway - whileAway) < 0.5, `progress holds while offscreen (${whileAway} → ${stillAway})`);
    await page.locator('#screenshots').scrollIntoViewIfNeeded();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const afterReturn = await progressWidth(page);
    assert.ok(afterReturn >= whileAway && afterReturn < whileAway + 15, `progress resumes after scrolling back (${whileAway} → ${afterReturn})`);
    assert.deepEqual(errors, []);
    await page.close();

    // Reduced motion: no autoplay at all.
    const calm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await calm.goto(`${origin}${BASE}/`, { waitUntil: 'networkidle' });
    await calm.locator('#screenshots').scrollIntoViewIfNeeded();
    await calm.mouse.move(5, 5);
    await calm.waitForTimeout(1500);
    assert.equal(await progressWidth(calm), 0, 'no progress under prefers-reduced-motion');
    assert.deepEqual(await loaded(calm), [true, false, false, false, false, false], 'no prefetch when autoplay is off');
    assert.equal(await selectedChannel(calm), 'dashboard');
    assert.equal(await calm.locator('[data-autoplay-toggle]').count(), 0, 'no pause control when nothing advances');
    await calm.keyboard.press('Tab');
    await calm.locator('.channel-tab').nth(1).click();
    assert.equal(await selectedChannel(calm), 'live-tv', 'manual switching still works');
    assert.deepEqual(await loaded(calm), [true, true, false, false, false, false], 'a manual switch loads only the chosen frame under reduced motion');
    await calm.close();
  } finally {
    await browser.close();
    server.close();
  }
});
