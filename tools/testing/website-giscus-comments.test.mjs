import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const postHtmlPath = new URL('../../dist/apps/website/blog/why-external-players-help/index.html', import.meta.url);

const expectedGiscusAttributes = {
  src: 'https://giscus.app/client.js',
  'data-repo': '4gray/iptvnator',
  'data-repo-id': 'MDEwOlJlcG9zaXRvcnkyMTMxOTQ3Mzg=',
  'data-category': 'Blog comments',
  'data-category-id': 'DIC_kwDODLUX8s4C9eBJ',
  'data-mapping': 'pathname',
  'data-strict': '1',
  'data-reactions-enabled': '1',
  'data-emit-metadata': '0',
  'data-input-position': 'bottom',
  'data-theme': 'transparent_dark',
  'data-lang': 'en',
};

test('published blog posts include the Giscus comments embed configuration', async () => {
  const html = await readFile(postHtmlPath, 'utf8');
  const scriptMatch = html.match(/<script\b[^>]*giscus\.app\/client\.js[^>]*>/);

  assert.ok(scriptMatch, 'Expected the blog post HTML to include the Giscus client script.');

  const scriptTag = scriptMatch[0];
  for (const [name, value] of Object.entries(expectedGiscusAttributes)) {
    assert.match(scriptTag, new RegExp(`${name}="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }

  assert.match(scriptTag, /\bloading="lazy"/);
  assert.match(scriptTag, /\bcrossorigin="anonymous"/);
  assert.match(scriptTag, /\basync/);
});
