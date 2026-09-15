/**
 * Nightly build version for master merges.
 *
 * Every push to master publishes a prerelease to `4gray/iptvnator-nightly`
 * that the desktop updater's nightly channel can install. electron-updater
 * only offers a version that is semver-greater than the running one, and the
 * released version in `package.json` is what stable users run, so a nightly
 * bumps the patch and adds a prerelease tag:
 *
 *   0.23.0  →  0.23.1-nightly.20260915.1234
 *
 * - `0.23.1-nightly.*` is greater than the stable `0.23.0`, so a stable user
 *   who switches to nightly is offered it.
 * - It is smaller than both `0.23.1` and `0.24.0`, so the next stable
 *   release is offered to nightly users on either channel.
 * - The date is the commit's UTC date and the last identifier is the
 *   workflow run number, which only ever grows, so nightlies order
 *   correctly across days and within one day.
 * - electron-builder derives the updater channel file names from the
 *   prerelease tag (`nightly-mac.yml`, `nightly.yml`, `nightly-linux.yml`).
 *
 * Every build job of one workflow run computes the same value from the same
 * inputs, so no job needs to hand the version to another.
 *
 * Usage:
 *   node tools/release/nightly-version.mjs            # print the version
 *   node tools/release/nightly-version.mjs --apply    # also write package.json
 *
 * Inputs default to the repository `package.json`, the HEAD commit date, and
 * `GITHUB_RUN_NUMBER`; `--base`, `--date` and `--run-number` override them.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NIGHTLY_TAG = 'nightly';

const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const DATE_PATTERN = /^\d{8}$/;
const PACKAGE_VERSION_LINE = /^(\s*"version":\s*")([^"]+)(")/m;
const VALUE_FLAGS = {
    '--base': 'base',
    '--date': 'date',
    '--run-number': 'runNumber',
};

export function buildNightlyVersion({ baseVersion, date, runNumber }) {
    const match = STABLE_VERSION_PATTERN.exec(String(baseVersion ?? '').trim());

    if (!match) {
        throw new Error(
            `Base version must be a released X.Y.Z version, got "${baseVersion}".`
        );
    }

    if (!DATE_PATTERN.test(String(date ?? ''))) {
        throw new Error(`Date must be YYYYMMDD, got "${date}".`);
    }

    const run = Number(runNumber);

    if (!Number.isInteger(run) || run <= 0) {
        throw new Error(
            `Run number must be a positive integer, got "${runNumber}".`
        );
    }

    const [, major, minor, patch] = match;

    return `${major}.${minor}.${Number(patch) + 1}-${NIGHTLY_TAG}.${date}.${run}`;
}

/** Replaces the `version` line in `package.json` text, formatting intact. */
export function applyNightlyVersion(packageJsonText, version) {
    if (!PACKAGE_VERSION_LINE.test(packageJsonText)) {
        throw new Error('package.json has no "version" line to replace.');
    }

    return packageJsonText.replace(PACKAGE_VERSION_LINE, `$1${version}$3`);
}

export function parseArguments(argv) {
    const options = { apply: false };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === '--') {
            continue;
        }

        if (argument === '--apply') {
            options.apply = true;
            continue;
        }

        const optionName = VALUE_FLAGS[argument];

        if (optionName) {
            const value = argv[index + 1];

            if (value === undefined || value.startsWith('--')) {
                return null;
            }

            options[optionName] = value;
            index += 1;
            continue;
        }

        return null;
    }

    return options;
}

function readCommitDate() {
    const isoDate = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], {
        encoding: 'utf8',
    }).trim();
    const commitDate = new Date(isoDate);

    if (Number.isNaN(commitDate.getTime())) {
        throw new Error(`Cannot parse HEAD commit date "${isoDate}".`);
    }

    return commitDate.toISOString().slice(0, 10).replace(/-/g, '');
}

function main(argv) {
    const options = parseArguments(argv);

    if (!options) {
        console.error(
            'Usage: node tools/release/nightly-version.mjs [--apply] [--base X.Y.Z] [--date YYYYMMDD] [--run-number N]'
        );
        return 2;
    }

    const packageJsonPath = new URL('../../package.json', import.meta.url);
    const packageJsonText = readFileSync(packageJsonPath, 'utf8');
    const version = buildNightlyVersion({
        baseVersion: options.base ?? JSON.parse(packageJsonText).version,
        date: options.date ?? readCommitDate(),
        runNumber: options.runNumber ?? process.env.GITHUB_RUN_NUMBER,
    });

    if (options.apply) {
        writeFileSync(
            packageJsonPath,
            applyNightlyVersion(packageJsonText, version)
        );
        console.error(`Applied nightly version ${version} to package.json.`);
    }

    console.log(version);
    return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exitCode = main(process.argv.slice(2));
}
