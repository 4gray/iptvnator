import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Structural checks for the per-OS download pages in the built website.
 * The build resolves the latest release from the GitHub API and falls back to
 * package.json, so assertions accept any semver version but insist on direct
 * asset links, canonical URLs, structured data and internal linking.
 */

const distRoot = new URL('../../dist/apps/website/', import.meta.url);
const SITE = 'https://4gray.github.io/iptvnator';

const readDist = (relativePath) => readFile(new URL(relativePath, distRoot), 'utf8');

const assetLink = (suffix) =>
  new RegExp(
    `https://github\\.com/4gray/iptvnator/releases/download/v\\d+\\.\\d+\\.\\d+/iptvnator-\\d+\\.\\d+\\.\\d+${suffix}`
  );

const PAGES = {
  windows: {
    path: 'download/windows/index.html',
    label: 'Windows',
    assets: ['-windows-x64-setup\\.exe'],
    operatingSystem: /Windows 10/,
  },
  macos: {
    path: 'download/macos/index.html',
    label: 'macOS',
    assets: ['-mac-arm64\\.dmg', '-mac-x64\\.dmg'],
    operatingSystem: /macOS/,
  },
  linux: {
    path: 'download/linux/index.html',
    label: 'Linux',
    assets: [
      '-linux-x86_64\\.AppImage',
      '-linux-amd64\\.deb',
      '-linux-x86_64\\.rpm',
      '-linux-x64\\.pacman',
      '-linux-x86_64\\.flatpak',
      '-linux-arm64\\.AppImage',
    ],
    operatingSystem: /Linux/,
  },
};

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length > 0, 'Expected at least one JSON-LD script block.');
  return blocks.flatMap((match) => JSON.parse(match[1]));
}

for (const [platform, page] of Object.entries(PAGES)) {
  test(`${platform} download page: title, canonical and direct asset links`, async () => {
    const html = await readDist(page.path);

    assert.match(html, new RegExp(`<title>[^<]*IPTVnator for ${page.label}[^<]*</title>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/download/${platform}/"`));
    assert.match(html, /<meta name="robots" content="index, follow/);

    for (const suffix of page.assets) {
      assert.match(html, assetLink(suffix), `Expected a direct link to the ${suffix} asset.`);
    }
  });

  test(`${platform} download page: structured data`, async () => {
    const html = await readDist(page.path);
    const schema = extractJsonLd(html);

    const app = schema.find((entry) => entry['@type'] === 'SoftwareApplication');
    assert.ok(app, 'Expected a SoftwareApplication entry.');
    assert.match(String(app.operatingSystem), page.operatingSystem);
    assert.match(String(app.softwareVersion), /^\d+\.\d+\.\d+$/);
    assert.match(String(app.downloadUrl), /^https:\/\/github\.com\/4gray\/iptvnator\/releases\//);
    assert.equal(app.isAccessibleForFree, true);

    const faq = schema.find((entry) => entry['@type'] === 'FAQPage');
    assert.ok(faq, 'Expected a FAQPage entry.');
    assert.ok(faq.mainEntity.length >= 5, 'Expected at least five FAQ questions.');

    const breadcrumbs = schema.find((entry) => entry['@type'] === 'BreadcrumbList');
    assert.ok(breadcrumbs, 'Expected a BreadcrumbList entry.');
    assert.equal(breadcrumbs.itemListElement.at(-1).item, `${SITE}/download/${platform}/`);
  });

  test(`${platform} download page: links to the other platforms and the hub`, async () => {
    const html = await readDist(page.path);
    for (const other of Object.keys(PAGES).filter((candidate) => candidate !== platform)) {
      assert.match(html, new RegExp(`href="/iptvnator/download/${other}/"`));
    }
    assert.match(html, /href="\/iptvnator\/download\/"/);
    assert.match(html, /href="\/iptvnator\/blog\/beware-unofficial-iptvnator-websites\/"/);
  });
}

test('docker page: canonical, schema, quick start and links', async () => {
  const html = await readDist('download/docker/index.html');
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/download/docker/"`));
  assert.match(html, /docker compose -f docker\/docker-compose\.yml up --build -d/);
  assert.match(html, /4gray\/iptvnator:latest/);
  assert.match(html, /href="https:\/\/hub\.docker\.com\/r\/4gray\/iptvnator"/);
  assert.match(html, /href="https:\/\/github\.com\/4gray\/iptvnator\/blob\/master\/docker\/README\.md"/);
  assert.match(html, /href="\/iptvnator\/compare\/desktop-vs-browser\/"/);
  assert.match(html, /href="\/iptvnator\/download\/"/);

  const schema = extractJsonLd(html);
  const app = schema.find((entry) => entry['@type'] === 'SoftwareApplication');
  assert.ok(app, 'Expected a SoftwareApplication entry.');
  assert.match(String(app.operatingSystem), /Docker/);
  const faq = schema.find((entry) => entry['@type'] === 'FAQPage');
  assert.ok(faq && faq.mainEntity.length >= 5, 'Expected a FAQPage with at least five questions.');
  const crumbs = schema.find((entry) => entry['@type'] === 'BreadcrumbList');
  assert.equal(crumbs.itemListElement.at(-1).item, `${SITE}/download/docker/`);
});

test('the homepage and the platform pages link to the docker page', async () => {
  const home = await readDist('index.html');
  assert.match(home, /href="\/iptvnator\/download\/docker\/"/);
  for (const platform of Object.keys(PAGES)) {
    const html = await readDist(PAGES[platform].path);
    assert.match(html, /href="\/iptvnator\/download\/docker\/"/, `${platform} page should link to the docker page`);
  }
});

test('download hub links to every platform page', async () => {
  const html = await readDist('download/index.html');
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/download/"`));
  for (const platform of Object.keys(PAGES)) {
    assert.match(html, new RegExp(`href="/iptvnator/download/${platform}/"`));
  }
  assert.match(html, /href="\/iptvnator\/download\/docker\/"/);
  assert.match(html, /brew install --cask iptvnator/);
  assert.match(html, /sudo snap install iptvnator/);
});

test('homepage download cards point at the platform pages', async () => {
  const html = await readDist('index.html');
  for (const platform of Object.keys(PAGES)) {
    assert.match(html, new RegExp(`href="/iptvnator/download/${platform}/"`));
  }
  const schema = extractJsonLd(html);
  const app = schema.find((entry) => entry['@type'] === 'SoftwareApplication');
  assert.match(String(app.softwareVersion), /^\d+\.\d+\.\d+$/, 'Homepage schema should carry the resolved version.');
});

test('sitemap lists the download pages', async () => {
  const sitemap = await readDist('sitemap-0.xml');
  for (const path of ['download/', 'download/windows/', 'download/macos/', 'download/linux/', 'download/docker/']) {
    assert.match(sitemap, new RegExp(`<loc>${SITE}/${path}</loc>`));
  }
});
