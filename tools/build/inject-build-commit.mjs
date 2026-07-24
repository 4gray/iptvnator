/**
 * Injects the git commit SHA from the BUILD_COMMIT environment variable into
 * the frontend BUILD_COMMIT constant before a CI build.
 *
 * The commit is shown next to the app version in Settings > About so bug
 * reports from test and nightly builds identify the exact commit. The semver
 * version itself intentionally stays untouched: a `-sha` suffix would flip
 * electron-updater into prerelease mode and leak into installer/artifact
 * version fields. Without BUILD_COMMIT the script is a no-op — local and dev
 * builds show the plain version.
 *
 * Usage (CI, before `nx build web`):
 *   BUILD_COMMIT=<git-sha> node tools/build/inject-build-commit.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CONFIG_PATH = 'apps/web/src/environments/build-commit.ts';
const MARKER = "export const BUILD_COMMIT = '';";

const commit = (process.env.BUILD_COMMIT ?? '').trim().toLowerCase();

if (!commit) {
    console.warn(
        'BUILD_COMMIT is not set — Settings > About will show the plain version.'
    );
    process.exit(0);
}

if (!/^[0-9a-f]{7,40}$/.test(commit)) {
    console.error(
        'BUILD_COMMIT must be a 7-40 character hex git SHA; aborting.'
    );
    process.exit(1);
}

const source = readFileSync(CONFIG_PATH, 'utf8');

if (!source.includes(MARKER)) {
    console.error(
        `Expected placeholder not found in ${CONFIG_PATH}. ` +
            'Update tools/build/inject-build-commit.mjs if the constant moved.'
    );
    process.exit(1);
}

writeFileSync(
    CONFIG_PATH,
    source.replace(MARKER, `export const BUILD_COMMIT = '${commit}';`)
);
console.log(`Injected build commit ${commit} into ${CONFIG_PATH}.`);
