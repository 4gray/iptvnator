import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Structural checks for the feature landing pages: canonical URLs, the
 * SoftwareApplication + FAQPage + BreadcrumbList structured data, links to
 * the download hub and a setup guide, the hub's coverage, and sitemap entries.
 */

const distRoot = new URL('../../dist/apps/website/', import.meta.url);
const SITE = 'https://4gray.github.io/iptvnator';
const FEATURES = ['m3u-player', 'xtream-codes-player', 'stalker-portal-player', 'epg', 'remote-control'];

const readDist = (relativePath) => readFile(new URL(relativePath, distRoot), 'utf8');

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length > 0, 'Expected at least one JSON-LD script block.');
  return blocks.flatMap((match) => JSON.parse(match[1]));
}

for (const slug of FEATURES) {
  test(`feature page ${slug}: canonical, schema and links`, async () => {
    const html = await readDist(`features/${slug}/index.html`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/features/${slug}/"`));
    assert.match(html, /<meta name="robots" content="index, follow/);

    const schema = extractJsonLd(html);
    const app = schema.find((entry) => entry['@type'] === 'SoftwareApplication');
    assert.ok(app, 'Expected a SoftwareApplication entry.');
    assert.ok(Array.isArray(app.featureList) && app.featureList.length >= 4, 'Expected a featureList.');
    const faq = schema.find((entry) => entry['@type'] === 'FAQPage');
    assert.ok(faq && faq.mainEntity.length >= 5, 'Expected a FAQPage with at least five questions.');
    const crumbs = schema.find((entry) => entry['@type'] === 'BreadcrumbList');
    assert.equal(crumbs.itemListElement.at(-1).item, `${SITE}/features/${slug}/`);

    assert.match(html, /href="\/iptvnator\/download\/"/);
    assert.match(html, /href="\/iptvnator\/blog\/[a-z0-9-]+-setup-guide\/"/);
    assert.match(html, /href="\/iptvnator\/features\/"/);
    for (const other of FEATURES.filter((candidate) => candidate !== slug)) {
      assert.match(html, new RegExp(`href="/iptvnator/features/${other}/"`));
    }
  });
}

test('features hub links to every feature page and the download hub', async () => {
  const html = await readDist('features/index.html');
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/features/"`));
  for (const slug of FEATURES) {
    assert.match(html, new RegExp(`href="/iptvnator/features/${slug}/"`));
  }
  assert.match(html, /href="\/iptvnator\/download\/"/);
});

test('homepage feature cards and the header link into the feature pages', async () => {
  const html = await readDist('index.html');
  assert.match(html, /href="\/iptvnator\/features\/"/);
  for (const slug of ['m3u-player', 'xtream-codes-player', 'epg', 'stalker-portal-player', 'remote-control']) {
    assert.match(html, new RegExp(`href="/iptvnator/features/${slug}/"`));
  }
});

test('sitemap lists the feature pages', async () => {
  const sitemap = await readDist('sitemap-0.xml');
  for (const path of ['features/', ...FEATURES.map((slug) => `features/${slug}/`)]) {
    assert.match(sitemap, new RegExp(`<loc>${SITE}/${path}</loc>`));
  }
});
