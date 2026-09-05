import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Structural checks for the blog tag hubs: the topic rail on the blog index,
 * one `/blog/tag/<tag>/` page per used tag with CollectionPage + BreadcrumbList
 * data, tag chips that resolve to existing hubs, sitemap entries, and no
 * nested anchors in the cards (the card is an <article> with a stretched title
 * link so the chips can be links of their own).
 */

const distRoot = new URL('../../dist/apps/website/', import.meta.url);
const SITE = 'https://4gray.github.io/iptvnator';
const TAG_HREF = /href="\/iptvnator\/blog\/tag\/([a-z0-9-]+)\/"/g;

const readDist = (relativePath) => readFile(new URL(relativePath, distRoot), 'utf8');
const distExists = (relativePath) =>
  access(new URL(relativePath, distRoot)).then(() => true, () => false);

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length > 0, 'Expected at least one JSON-LD script block.');
  return blocks.flatMap((match) => JSON.parse(match[1]));
}

/** Anchors must never nest: a stretched card link plus chip links inside one <a> would be invalid HTML. */
function assertNoNestedAnchors(html, label) {
  let depth = 0;
  for (const token of html.matchAll(/<a[\s>]|<\/a>/g)) {
    depth += token[0] === '</a>' ? -1 : 1;
    assert.ok(depth <= 1, `${label}: nested <a> found near offset ${token.index}.`);
  }
  assert.equal(depth, 0, `${label}: unbalanced anchors.`);
}

const tagsFromRail = (html) => [...new Set([...html.matchAll(TAG_HREF)].map((match) => match[1]))];

test('blog index carries a topic rail whose tags all have hub pages', async () => {
  const html = await readDist('blog/index.html');
  assert.match(html, /aria-label="Blog topics"/);
  const tags = tagsFromRail(html);
  assert.ok(tags.length >= 5, `Expected at least five topics, found ${tags.length}.`);
  for (const tag of tags) {
    assert.ok(await distExists(`blog/tag/${tag}/index.html`), `Missing hub page for tag "${tag}".`);
  }
  assertNoNestedAnchors(html, 'blog index');
});

test('every tag hub: canonical, CollectionPage schema, breadcrumb, cards and the rail', async () => {
  const tags = tagsFromRail(await readDist('blog/index.html'));
  for (const tag of tags) {
    const html = await readDist(`blog/tag/${tag}/index.html`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/blog/tag/${tag}/"`));
    assert.match(html, /<meta name="robots" content="index, follow/);
    assert.match(html, /Back to blog/);
    assert.match(html, new RegExp(`aria-current="page"[^>]*href="/iptvnator/blog/tag/${tag}/"|href="/iptvnator/blog/tag/${tag}/"[^>]*aria-current="page"`));

    const cards = html.match(/<article class="card-panel/g) ?? [];
    assert.ok(cards.length >= 1, `Tag "${tag}" renders no post cards.`);

    const schema = extractJsonLd(html);
    const page = schema.find((entry) => entry['@type'] === 'CollectionPage');
    assert.ok(page, `Tag "${tag}": expected a CollectionPage entry.`);
    assert.equal(page.url, `${SITE}/blog/tag/${tag}/`);
    assert.equal(page.hasPart.length, cards.length, `Tag "${tag}": schema and cards disagree on the post count.`);
    const crumbs = schema.find((entry) => entry['@type'] === 'BreadcrumbList');
    assert.equal(crumbs.itemListElement.at(-1).item, `${SITE}/blog/tag/${tag}/`);
    assertNoNestedAnchors(html, `tag ${tag}`);
  }
});

test('post pages link their tag chips to existing hubs', async () => {
  const blogIndex = await readDist('blog/index.html');
  const slugs = [...new Set([...blogIndex.matchAll(/href="\/iptvnator\/blog\/([a-z0-9-]+)\/"/g)].map((match) => match[1]))]
    .filter((slug) => slug !== 'tag');
  assert.ok(slugs.length >= 10, `Expected the blog index to link at least ten posts, found ${slugs.length}.`);
  let chipCount = 0;
  for (const slug of slugs) {
    const html = await readDist(`blog/${slug}/index.html`);
    for (const tag of tagsFromRail(html)) {
      chipCount += 1;
      assert.ok(await distExists(`blog/tag/${tag}/index.html`), `Post "${slug}" links to a missing tag hub "${tag}".`);
    }
  }
  assert.ok(chipCount > 0, 'Expected at least one post page to carry tag chips.');
});

test('homepage blog cards have no nested anchors', async () => {
  const html = await readDist('index.html');
  assert.match(html, /<article class="card-panel/);
  assertNoNestedAnchors(html, 'homepage');
});

test('sitemap lists the tag hubs', async () => {
  const sitemap = await readDist('sitemap-0.xml');
  for (const tag of tagsFromRail(await readDist('blog/index.html'))) {
    assert.match(sitemap, new RegExp(`<loc>${SITE}/blog/tag/${tag}/</loc>`));
  }
});
