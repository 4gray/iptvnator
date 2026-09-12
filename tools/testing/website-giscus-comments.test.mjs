import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const postHtmlPath = new URL('../../dist/apps/website/blog/why-external-players-help/index.html', import.meta.url);

const expectedGiscusAttributes = {
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

test('published blog posts carry the Giscus configuration on a click-to-load button', async () => {
  const html = await readFile(postHtmlPath, 'utf8');
  const buttonMatch = html.match(/<button\b[^>]*data-giscus-loader[^>]*>/);

  assert.ok(buttonMatch, 'Expected the blog post HTML to include the Giscus loader button.');

  const buttonTag = buttonMatch[0];
  for (const [name, value] of Object.entries(expectedGiscusAttributes)) {
    assert.match(buttonTag, new RegExp(`${name}="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});

test('a blog post loads nothing from a third party before the reader asks for comments', async () => {
  const html = await readFile(postHtmlPath, 'utf8');

  assert.ok(
    !/<script\b[^>]*\bsrc="https:\/\/giscus\.app/.test(html),
    'The giscus client must not be a script tag in the delivered HTML — it is created on click.'
  );
  assert.match(
    html,
    /data-script-src="https:\/\/giscus\.app\/client\.js"/,
    'The loader button must carry the giscus client URL for its click handler.'
  );
});
