/**
 * Injects the TMDB API key from the TMDB_API_KEY environment variable into
 * DEFAULT_TMDB_API_KEY before a CI build.
 *
 * The key intentionally lives in a GitHub Actions secret instead of the
 * repository: TMDB keys are free and extractable from any client-side app
 * anyway, but keeping the key out of the repo prevents trivial scraping and
 * fork propagation. Without TMDB_API_KEY the script is a no-op — the built
 * app then requires a user-provided key in settings for TMDB enrichment.
 *
 * Usage (CI, before `nx build web`):
 *   TMDB_API_KEY=... node tools/tmdb/inject-tmdb-key.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG_PATH = 'libs/services/src/lib/tmdb/tmdb-config.ts';
const MARKER = "export const DEFAULT_TMDB_API_KEY = '';";

const key = (process.env.TMDB_API_KEY ?? '').trim();

if (!key) {
    console.warn(
        'TMDB_API_KEY is not set — DEFAULT_TMDB_API_KEY stays empty. ' +
            'TMDB enrichment will require a user-provided key in settings.'
    );
    process.exit(0);
}

// v3 keys are hex, v4 read tokens are JWTs — both match this charset.
// Anything else would break out of the string literal below.
if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    console.error('TMDB_API_KEY contains unexpected characters; aborting.');
    process.exit(1);
}

const source = readFileSync(CONFIG_PATH, 'utf8');

if (!source.includes(MARKER)) {
    console.error(
        `Expected placeholder not found in ${CONFIG_PATH}. ` +
            'Update tools/tmdb/inject-tmdb-key.mjs if the constant moved.'
    );
    process.exit(1);
}

writeFileSync(
    CONFIG_PATH,
    source.replace(MARKER, `export const DEFAULT_TMDB_API_KEY = '${key}';`)
);
console.log(`Injected TMDB API key into ${CONFIG_PATH}.`);
