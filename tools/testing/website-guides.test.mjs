import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parse as parseYaml } from 'yaml';
import { launchBrowser, serveDist } from './website-browser-support.mjs';

/**
 * Structural checks for guide posts: they must carry FAQPage structured data
 * next to the BlogPosting entry, link to the download hub, and reference only
 * screenshots that the build actually shipped.
 */

const distRoot = new URL('../../dist/apps/website/', import.meta.url);
const SITE = 'https://4gray.github.io/iptvnator';

const GUIDES = [
  {
    slug: 'm3u-programme-guide',
    screenshots: [],
  },
  {
    slug: 'xtream-codes-setup-guide',
    screenshots: [
      'blog/guides/screenshots/guide-xtream-add-playlist-dark.png',
      'blog/guides/screenshots/guide-xtream-auto-detect-dark.png',
      'blog/guides/screenshots/guide-xtream-live-dark.png',
    ],
  },
  {
    slug: 'stalker-portal-setup-guide',
    screenshots: [
      'blog/guides/screenshots/guide-stalker-add-playlist-dark.png',
      'blog/guides/screenshots/guide-stalker-live-dark.png',
    ],
  },
  {
    slug: 'm3u-playlist-epg-setup-guide',
    screenshots: [
      'blog/guides/screenshots/guide-m3u-add-playlist-dark.png',
      'blog/guides/screenshots/guide-m3u-live-groups-dark.png',
      'blog/guides/screenshots/guide-epg-settings-dark.png',
    ],
  },
  {
    slug: 'offline-downloads-guide',
    screenshots: [
      'blog/guides/screenshots/guide-downloads-movie-detail-dark.png',
      'blog/guides/screenshots/guide-downloads-manager-dark.png',
      'blog/guides/screenshots/guide-downloads-offline-movie-dark.png',
    ],
  },
  {
    slug: 'alternative-sources-guide',
    screenshots: [
      'blog/guides/screenshots/guide-sources-chip-dark.png',
      'blog/guides/screenshots/guide-sources-menu-dark.png',
    ],
  },
  {
    slug: 'remote-control-guide',
    screenshots: [
      'blog/guides/screenshots/guide-remote-settings-dark.png',
      'blog/guides/screenshots/guide-remote-phone-dark.png',
    ],
  },
  {
    slug: 'epg-wrong-program-fix',
    screenshots: [
      'blog/guides/screenshots/guide-epg-map-menu-dark.png',
      'blog/guides/screenshots/guide-epg-map-dialog-dark.png',
      'blog/guides/screenshots/guide-epg-offset-dark.png',
    ],
  },
  {
    slug: 'tmdb-metadata-guide',
    screenshots: ['blog/guides/screenshots/guide-tmdb-settings-dark.png'],
  },
];

const readDist = (relativePath) => readFile(new URL(relativePath, distRoot), 'utf8');

const HUB_GROUPS = ['getting-started', 'live-tv-epg', 'playback', 'library', 'updates'];
const DRAFT_GUIDES = [
  'm3u-programme-guide', 'stable-nightly-updates-guide', 'fullscreen-channel-episode-guide',
  'player-controls-guide', 'stream-info-diagnostics-guide', 'playlist-backup-restore-guide',
  'library-organization-guide',
];

test('guides hub groups working article links by task and keeps draft visibility consistent', async () => {
  const html = await readDist('guides/index.html');
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('link[rel="canonical"]').href, `${SITE}/guides/`);
  assert.equal(doc.querySelectorAll('h1').length, 1);
  for (const id of HUB_GROUPS) {
    const section = doc.getElementById(id);
    assert.ok(section?.querySelector('h2'), `${id}: named section`);
    assert.ok(section.querySelector('[data-guide-article]'), `${id}: not an empty category`);
    assert.ok(doc.querySelector(`nav[aria-label="Guide topics"] a[href="#${id}"]`));
  }
  const links = [...doc.querySelectorAll('[data-guide-article]')];
  assert.equal(new Set(links.map((link) => link.dataset.guideArticle)).size, links.length);
  for (const link of links) {
    const slug = link.dataset.guideArticle;
    assert.equal(link.getAttribute('href'), `/iptvnator/blog/${slug}/`);
    await access(new URL(`blog/${slug}/index.html`, distRoot));
    const source = await readFile(new URL(`../../apps/website/src/content/blog/${slug}.mdx`, import.meta.url), 'utf8');
    const meta = parseYaml(source.split('---')[1]);
    assert.equal(link.querySelector('h3').textContent, meta.title);
    assert.equal(link.textContent.includes('Draft preview'), meta.draft === true);
  }
  for (const slug of DRAFT_GUIDES) {
    const source = await readFile(new URL(`../../apps/website/src/content/blog/${slug}.mdx`, import.meta.url), 'utf8');
    const meta = parseYaml(source.split('---')[1]);
    const visible = !meta.draft || process.env.PUBLIC_INCLUDE_DRAFTS === 'true';
    assert.equal(links.some((link) => link.dataset.guideArticle === slug), visible, `${slug}: draft visibility`);
  }
  const schema = extractJsonLd(html);
  const collection = schema.find((entry) => entry['@type'] === 'CollectionPage');
  assert.equal(collection.url, `${SITE}/guides/`);
  assert.deepEqual(collection.hasPart.map((entry) => entry.url), links.map((link) => `https://4gray.github.io${link.getAttribute('href')}`));
  assert.equal(schema.find((entry) => entry['@type'] === 'BreadcrumbList').itemListElement.at(-1).item, `${SITE}/guides/`);
  assert.match(await readDist('sitemap-0.xml'), /<loc>https:\/\/4gray.github.io\/iptvnator\/guides\/<\/loc>/);
});

test('guides are discoverable from the header, footer and blog', async () => {
  const home = new JSDOM(await readDist('index.html')).window.document;
  assert.ok(home.querySelector('header a[href="/iptvnator/guides/"]'));
  assert.ok(home.querySelector('#mobile-menu a[href="/iptvnator/guides/"]'));
  assert.ok(home.querySelector('footer a[href="/iptvnator/guides/"]'));
  const blog = new JSDOM(await readDist('blog/index.html')).window.document;
  assert.ok(blog.querySelector('main a[href="/iptvnator/guides/"]'));
});

test('guides hub: responsive navigation and task anchors work in Chromium', async (t) => {
  const browser = await launchBrowser();
  if (!browser) return t.skip('Chromium is not installed locally');
  const { server, origin } = await serveDist();
  try {
    for (const width of [390, 768, 1024, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      try {
        await page.goto(`${origin}/iptvnator/guides/`);
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal overflow`);
        if (width < 1024) {
          const button = page.getByRole('button', { name: 'Toggle menu' });
          await button.click();
          assert.equal(await button.getAttribute('aria-expanded'), 'true');
          await page.locator('#mobile-menu').getByRole('link', { name: 'Guides', exact: true }).click();
          await page.waitForURL(`${origin}/iptvnator/guides/`);
        } else {
          const bounds = await page.locator('#site-header a:visible').evaluateAll((links) => links.map((link) => {
            const { left, right } = link.getBoundingClientRect();
            return { left, right };
          }));
          for (let index = 1; index < bounds.length; index++) {
            assert.ok(bounds[index].left >= bounds[index - 1].right, `${width}: header links do not overlap`);
          }
        }
        await page.getByRole('navigation', { name: 'Guide topics' }).getByRole('link', { name: /Updates/ }).click();
        await page.waitForFunction(() => {
          const top = document.getElementById('updates').getBoundingClientRect().top;
          return top >= 80 && top < 400;
        });
        assert.equal(new URL(page.url()).hash, '#updates');
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length > 0, 'Expected at least one JSON-LD script block.');
  return blocks.flatMap((match) => JSON.parse(match[1]));
}

for (const guide of GUIDES) {
  test(`${guide.slug}: BlogPosting and FAQPage structured data`, async () => {
    const html = await readDist(`blog/${guide.slug}/index.html`);
    const schema = extractJsonLd(html);

    assert.ok(schema.some((entry) => entry['@type'] === 'BlogPosting'), 'Expected a BlogPosting entry.');

    const faq = schema.find((entry) => entry['@type'] === 'FAQPage');
    assert.ok(faq, 'Expected a FAQPage entry.');
    assert.ok(faq.mainEntity.length >= 5, 'Expected at least five FAQ questions.');
    assert.match(html, /Frequently asked questions/);
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/blog/${guide.slug}/"`));
  });

  test(`${guide.slug}: links to the download hub and ships its screenshots`, async () => {
    const html = await readDist(`blog/${guide.slug}/index.html`);
    assert.match(html, /href="\/iptvnator\/download\/"/);

    for (const screenshot of guide.screenshots) {
      assert.match(html, new RegExp(`src="/iptvnator/${screenshot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
      await access(new URL(screenshot, distRoot));
    }
  });
}
