import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Structural checks for the comparison pages: canonical URLs, the
 * WebPage + FAQPage + BreadcrumbList structured data, a short verdict before
 * the detail, at least one comparison table, cross-links and sitemap entries.
 */

const distRoot = new URL('../../dist/apps/website/', import.meta.url);
const SITE = 'https://4gray.github.io/iptvnator';
const COMPARISONS = ['m3u-vs-xtream-vs-stalker', 'playback-engines', 'desktop-vs-browser'];

const readDist = (relativePath) => readFile(new URL(relativePath, distRoot), 'utf8');

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length > 0, 'Expected at least one JSON-LD script block.');
  return blocks.flatMap((match) => JSON.parse(match[1]));
}

for (const slug of COMPARISONS) {
  test(`comparison page ${slug}: canonical, schema and verdict`, async () => {
    const html = await readDist(`compare/${slug}/index.html`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/compare/${slug}/"`));
    assert.match(html, /<meta name="robots" content="index, follow/);
    assert.match(html, /Short answer/, 'Every comparison must state its verdict up front.');
    assert.match(html, /<table/, 'Every comparison must carry a comparison table.');

    const schema = extractJsonLd(html);
    const page = schema.find((entry) => entry['@type'] === 'WebPage');
    assert.ok(page, 'Expected a WebPage entry.');
    assert.equal(page.url, `${SITE}/compare/${slug}/`);
    const faq = schema.find((entry) => entry['@type'] === 'FAQPage');
    assert.ok(faq && faq.mainEntity.length >= 5, 'Expected a FAQPage with at least five questions.');
    const crumbs = schema.find((entry) => entry['@type'] === 'BreadcrumbList');
    assert.equal(crumbs.itemListElement.at(-1).item, `${SITE}/compare/${slug}/`);
    assert.ok(
      !schema.some((entry) => entry['@type'] === 'SoftwareApplication'),
      'A comparison page is guidance, not a product listing.'
    );
  });

  test(`comparison page ${slug}: links to the hub and the other comparisons`, async () => {
    const html = await readDist(`compare/${slug}/index.html`);
    assert.match(html, /href="\/iptvnator\/compare\/"/);
    for (const other of COMPARISONS.filter((candidate) => candidate !== slug)) {
      assert.match(html, new RegExp(`href="/iptvnator/compare/${other}/"`));
    }
    assert.match(html, /href="\/iptvnator\/blog\/[a-z0-9-]+\/"/, 'Expected a link into the guides.');
  });
}

test('compare hub links to every comparison and to the feature pages', async () => {
  const html = await readDist('compare/index.html');
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/compare/"`));
  for (const slug of COMPARISONS) {
    assert.match(html, new RegExp(`href="/iptvnator/compare/${slug}/"`));
  }
  assert.match(html, /href="\/iptvnator\/features\/[a-z0-9-]+\/"/);
});

test('the header and the features hub link into the comparisons', async () => {
  const home = await readDist('index.html');
  assert.match(home, /href="\/iptvnator\/compare\/"/);
  const features = await readDist('features/index.html');
  assert.match(features, /href="\/iptvnator\/compare\/"/);
});

test('sitemap lists the comparison pages', async () => {
  const sitemap = await readDist('sitemap-0.xml');
  for (const path of ['compare/', ...COMPARISONS.map((slug) => `compare/${slug}/`)]) {
    assert.match(sitemap, new RegExp(`<loc>${SITE}/${path}</loc>`));
  }
});
