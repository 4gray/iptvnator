import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_PATH as BASE, distRoot, launchBrowser, serveDist } from './website-browser-support.mjs';

/**
 * Home page sections rebuilt in the landing redesign: the hero, the feature
 * bento, the download panel and the footer.
 *
 * The structural half reads the built HTML and checks that the server-rendered
 * markup is already correct for a visitor whose OS cannot be guessed. The
 * browser half loads the page under desktop and phone user agents and checks
 * the client-side OS detection: the hero's primary button and the "Detected"
 * row in the download panel follow the platform, phones get the generic
 * markup, and the copy buttons write to the clipboard. Without a Chromium the
 * browser half is skipped locally and fails in CI (see
 * website-browser-support.mjs).
 */

const PLATFORMS = ['windows', 'macos', 'linux'];

test('hero: generic download CTA, self-host link and project facts', async () => {
  const html = await readFile(join(distRoot, 'index.html'), 'utf8');
  const primary = html.match(/<a[^>]*data-hero-primary[^>]*>[\s\S]*?<\/a>/)?.[0];
  assert.ok(primary, 'hero primary button');
  assert.match(primary, /href="\/iptvnator\/download\/"/, 'server-rendered CTA goes to the download hub');
  assert.match(primary, /Download for desktop/);
  assert.match(html, /data-hero-secondary[^>]*>\s*All platforms/);
  assert.match(html, /href="\/iptvnator\/download\/docker\/"[^>]*>\s*Self-host the web app/);
  assert.match(html, /<dd[^>]*>19<\/dd>/, 'languages fact');
  assert.match(html, /<dd[^>]*>MIT<\/dd>/, 'license fact');
  assert.doesNotMatch(html, /img\.shields\.io/, 'no badge images');
  assert.doesNotMatch(html, /border-dashed/, 'no dashed borders anywhere on the home page');
});

test('features bento links every feature page and shows interface fragments', async () => {
  const html = await readFile(join(distRoot, 'index.html'), 'utf8');
  const section = html.match(/<section id="features"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, 'features section');
  for (const slug of ['m3u-player', 'xtream-codes-player', 'stalker-portal-player', 'epg', 'remote-control']) {
    assert.match(section, new RegExp(`href="/iptvnator/features/${slug}/"`));
  }
  assert.match(section, /Aurora News/, 'EPG fragment uses fictional channels');
  assert.match(section, /REC/, 'recording fragment');
  assert.doesNotMatch(section, /carousel-track/, 'the marquee is gone');
});

test('download panel: one row per platform with release file names and package commands', async () => {
  const html = await readFile(join(distRoot, 'index.html'), 'utf8');
  const section = html.match(/<section id="download"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, 'download section');
  assert.match(section, /Get IPTVnator \d+\.\d+\.\d+/);
  for (const platform of PLATFORMS) {
    const row = section.match(new RegExp(`<div[^>]*data-platform-row="${platform}"[\\s\\S]*?data-platform-link[^>]*>[\\s\\S]*?</a>`))?.[0];
    assert.ok(row, `${platform} row`);
    assert.match(row, new RegExp(`href="/iptvnator/download/${platform}/"`));
    assert.match(row, /iptvnator-\d+\.\d+\.\d+-/, 'lists a release file name');
    assert.match(row, /class="hidden[^"]*"[^>]*data-detected-badge/, 'the Detected badge is hidden until the browser decides');
  }
  assert.match(section, /brew install --cask iptvnator/);
  assert.match(section, /sudo snap install iptvnator/);
  assert.match(section, /yay -S iptvnator-bin/);
});

test('footer carries the disclaimer, the mascot and the site links', async () => {
  const html = await readFile(join(distRoot, 'index.html'), 'utf8');
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footer, 'footer');
  assert.match(footer, /does not provide, host or sell/);
  assert.match(footer, /iptvnator-1-mascot/, 'the mascot lives in the footer');
  for (const href of ['/iptvnator/features/', '/iptvnator/compare/', '/iptvnator/download/', '/iptvnator/blog/']) {
    assert.match(footer, new RegExp(`href="${href}"`));
  }
});

const AGENTS = {
  windows: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    label: 'Windows',
  },
  macos: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    label: 'macOS',
  },
  linux: {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    label: 'Linux',
  },
};

test('browser: the download CTA and the Detected row follow the visitor OS, phones stay generic', async (t) => {
  const browser = await launchBrowser();
  if (!browser) {
    t.skip('no Chromium available for the browser half');
    return;
  }
  const { server, origin } = await serveDist();
  const readState = (page) =>
    page.evaluate(() => ({
      primary: document.querySelector('[data-hero-primary]')?.getAttribute('href'),
      label: document.querySelector('[data-hero-primary-label]')?.textContent.trim(),
      detected: [...document.querySelectorAll('[data-detected-badge]')]
        .filter((el) => !el.classList.contains('hidden'))
        .map((el) => el.closest('[data-platform-row]').dataset.platformRow),
    }));
  try {
    for (const [platform, agent] of Object.entries(AGENTS)) {
      const page = await browser.newPage({ userAgent: agent.userAgent, viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(`${origin}${BASE}/`, { waitUntil: 'networkidle' });
      const state = await readState(page);
      assert.equal(state.primary, `/iptvnator/download/${platform}/`, `${platform}: primary CTA target`);
      assert.equal(state.label, `Download for ${agent.label}`, `${platform}: primary CTA label`);
      assert.deepEqual(state.detected, [platform], `${platform}: detected row`);
      assert.deepEqual(errors, []);
      await page.close();
    }

    const phone = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
      viewport: { width: 390, height: 844 },
    });
    await phone.goto(`${origin}${BASE}/`, { waitUntil: 'networkidle' });
    const phoneState = await readState(phone);
    assert.equal(phoneState.primary, '/iptvnator/download/', 'phone keeps the generic CTA');
    assert.equal(phoneState.label, 'Download for desktop');
    assert.deepEqual(phoneState.detected, [], 'phone highlights no platform row');
    await phone.close();

    // Copy buttons write the command and confirm briefly.
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.goto(`${origin}${BASE}/`, { waitUntil: 'networkidle' });
    const button = page.locator('.copy-btn').first();
    await button.scrollIntoViewIfNeeded();
    await button.click();
    assert.equal(await button.textContent(), 'Copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'brew install --cask iptvnator');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
});
