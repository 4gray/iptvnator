import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared plumbing for the website tests that drive the built site in a real
 * browser: a loopback static server for `dist/apps/website` mounted under the
 * GitHub Pages base path, and a Chromium launcher.
 *
 * The server only ever hands out files below the build directory: the
 * requested path is resolved against the root and anything that escapes it is
 * answered with 404. Only local tests talk to it, but the guard keeps the
 * helper honest and static analysis quiet.
 *
 * Chromium comes from the Playwright download when one exists, otherwise from
 * the system Chrome/Chromium channel (GitHub's Ubuntu runners ship Google
 * Chrome). In CI a missing browser is a failure, never a silent skip, so the
 * interaction assertions cannot rot unnoticed; locally the caller may skip.
 */

export const distRoot = fileURLToPath(new URL('../../dist/apps/website/', import.meta.url));
export const BASE_PATH = '/iptvnator';

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'text/xml',
};

/** Maps a request URL to a file below `distRoot`, or `null` when it escapes the root. */
export function resolveDistFile(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.startsWith(BASE_PATH)) {
    pathname = pathname.slice(BASE_PATH.length) || '/';
  }
  const root = resolve(distRoot);
  const candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }
  const file = existsSync(candidate) && statSync(candidate).isDirectory() ? resolve(candidate, 'index.html') : candidate;
  return existsSync(file) ? file : null;
}

/** Serves the build on a random loopback port; resolves to `{ server, origin }`. */
export function serveDist() {
  const server = createServer((req, res) => {
    const file = resolveDistFile(req.url ?? '/');
    if (!file) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done({ server, origin: `http://127.0.0.1:${server.address().port}` })),
  );
}

/**
 * Launches Chromium, trying the Playwright download first and the system
 * channels next. Returns `null` when none is available — except in CI, where
 * that is thrown as an error so the browser half of a test cannot be skipped.
 */
export async function launchBrowser() {
  let playwright;
  try {
    playwright = await import('@playwright/test');
  } catch (error) {
    return unavailable(`@playwright/test is not installed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const attempts = [];
  for (const options of [{}, { channel: 'chrome' }, { channel: 'chromium' }]) {
    try {
      return await playwright.chromium.launch(options);
    } catch (error) {
      attempts.push(`${JSON.stringify(options)}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
  return unavailable(`no Chromium could be launched (${attempts.join('; ')})`);
}

function unavailable(reason) {
  if (process.env.CI) {
    throw new Error(`Website browser tests must run in CI, but ${reason}`);
  }
  return null;
}
