import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Structural checks for guide posts: they must carry FAQPage structured data
 * next to the BlogPosting entry, link to the download hub, and reference only
 * screenshots that the build actually shipped.
 */

const distRoot = new URL('../../dist/apps/website/', import.meta.url);
const SITE = 'https://4gray.github.io/iptvnator';

const GUIDES = [
  {
    slug: 'xtream-codes-setup-guide',
    screenshots: [
      'blog/guides/screenshots/guide-xtream-add-playlist-dark.png',
      'blog/guides/screenshots/guide-xtream-auto-detect-dark.png',
      'blog/guides/screenshots/guide-xtream-live-dark.png',
    ],
  },
];

const readDist = (relativePath) => readFile(new URL(relativePath, distRoot), 'utf8');

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
