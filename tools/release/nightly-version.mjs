/**
 * Nightly build version for master merges.
 *
 * Every push to master publishes a prerelease to `4gray/iptvnator-nightly`
 * that the desktop updater's nightly channel can install. electron-updater
 * only offers a version that is semver-greater than the running one, and the
 * released version in `package.json` is what stable users run, so a nightly
 * bumps the patch and adds a prerelease tag:
 *
 *   0.23.0 (tag v0.23.0 exists)  →  0.23.1-nightly.20260915.1234
 *
 * - `0.23.1-nightly.*` is greater than the stable `0.23.0`, so a stable user
 *   who switches to nightly is offered it.
 * - It is smaller than both `0.23.1` and `0.24.0`, so the next stable
 *   release is offered to nightly users on either channel.
 * - The date is the commit's UTC date and the last identifier is the
 *   workflow run number, which only ever grows, so nightlies order
 *   correctly across days and within one day.
 * - `--apply` also sets `publish[0].channel` to `nightly` in
 *   `electron-builder.json`, which is what names the updater metadata
 *   `nightly-mac.yml` / `nightly.yml` / `nightly-linux.yml`. electron-builder
 *   does NOT derive that name from the prerelease tag for the GitHub
 *   provider: the first nightly run shipped `latest-*.yml` files and the
 *   publish step refused them.
 *
 * A release cut commits the new version to master before (or together
 * with) its tag. While `v<package.json version>` does not exist yet, that
 * version is the UPCOMING release, so the patch is not bumped:
 *
 *   0.23.1 (no tag v0.23.1 yet)  →  0.23.1-nightly.20260915.1240
 *
 * That still orders above every earlier `0.23.1-nightly.*` (the run number
 * grew) and below the imminent `0.23.1`, so nightly users are offered the
 * release instead of skipping it.
 *
 * The workflow computes the version once, in a leading job, and hands it to
 * every build job with `--version`, so a tag pushed while the matrix runs
 * cannot give one run two different versions.
 *
 * Usage:
 *   node tools/release/nightly-version.mjs                       # print
 *   node tools/release/nightly-version.mjs --apply --version X   # write X
 *                                   into package.json + electron-builder.json
 *
 * Inputs default to the repository `package.json`, the HEAD commit date,
 * `GITHUB_RUN_NUMBER`, and a `git ls-remote` probe for the base tag;
 * `--base`, `--date`, `--run-number` and `--base-released` override them.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NIGHTLY_TAG = 'nightly';

const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const DATE_PATTERN = /^\d{8}$/;
const PACKAGE_VERSION_LINE = /^(\s*"version":\s*")([^"]+)(")/m;
const NIGHTLY_VERSION_PATTERN = /^\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/;
const VALUE_FLAGS = {
    '--base': 'base',
    '--base-released': 'baseReleased',
    '--date': 'date',
    '--run-number': 'runNumber',
    '--version': 'version',
};

export function buildNightlyVersion({
    baseVersion,
    date,
    runNumber,
    baseReleased = true,
}) {
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
    const nightlyPatch = baseReleased ? Number(patch) + 1 : Number(patch);

    return `${major}.${minor}.${nightlyPatch}-${NIGHTLY_TAG}.${date}.${run}`;
}

/** Accepts only the shape this script produces, so `--version` cannot smuggle junk in. */
export function isNightlyVersion(value) {
    return NIGHTLY_VERSION_PATTERN.test(String(value ?? ''));
}

export function parseBooleanFlag(value, flag) {
    if (value === 'true') {
        return true;
    }

    if (value === 'false') {
        return false;
    }

    throw new Error(`${flag} must be "true" or "false", got "${value}".`);
}

/**
 * Points electron-builder's updater metadata at the nightly channel. Written
 * as 4-space JSON like `configure-linux-frame-copy-build.mjs`, which has
 * already rewritten the file the same way on Linux by the time this runs.
 */
export function applyNightlyPublishChannel(electronBuilderJsonText) {
    const config = JSON.parse(electronBuilderJsonText);
    const publish = Array.isArray(config.publish) ? config.publish : null;

    if (!publish || publish.length === 0 || publish[0]?.provider !== 'github') {
        throw new Error(
            'electron-builder.json must declare a github publish provider first.'
        );
    }

    publish[0] = { ...publish[0], channel: NIGHTLY_TAG };

    return `${JSON.stringify(config, null, 4)}\n`;
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

/** Whether `v<base>` already exists on the origin remote. */
function isBaseVersionReleased(baseVersion) {
    try {
        execFileSync(
            'git',
            [
                'ls-remote',
                '--exit-code',
                '--tags',
                'origin',
                `refs/tags/v${baseVersion}`,
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
        );
        return true;
    } catch (error) {
        // Exit status 2 is git's "no matching refs"; anything else (no
        // remote, network) must not silently pick a version.
        if (error && error.status === 2) {
            return false;
        }

        throw new Error(
            `Cannot probe origin for tag v${baseVersion}: ${error?.message ?? error}`
        );
    }
}

function resolveVersion(options, packageJsonText) {
    if (options.version !== undefined) {
        if (!isNightlyVersion(options.version)) {
            throw new Error(
                `--version must look like X.Y.Z-nightly.YYYYMMDD.N, got "${options.version}".`
            );
        }

        return options.version;
    }

    const baseVersion = options.base ?? JSON.parse(packageJsonText).version;

    return buildNightlyVersion({
        baseVersion,
        date: options.date ?? readCommitDate(),
        runNumber: options.runNumber ?? process.env.GITHUB_RUN_NUMBER,
        baseReleased:
            options.baseReleased === undefined
                ? isBaseVersionReleased(baseVersion)
                : parseBooleanFlag(options.baseReleased, '--base-released'),
    });
}

function main(argv) {
    const options = parseArguments(argv);

    if (!options) {
        console.error(
            'Usage: node tools/release/nightly-version.mjs [--apply] [--version X.Y.Z-nightly.YYYYMMDD.N | --base X.Y.Z --base-released true|false --date YYYYMMDD --run-number N]'
        );
        return 2;
    }

    const packageJsonPath = new URL('../../package.json', import.meta.url);
    const packageJsonText = readFileSync(packageJsonPath, 'utf8');
    let version;

    try {
        version = resolveVersion(options, packageJsonText);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }

    if (options.apply) {
        writeFileSync(
            packageJsonPath,
            applyNightlyVersion(packageJsonText, version)
        );
        const electronBuilderJsonPath = new URL(
            '../../electron-builder.json',
            import.meta.url
        );
        writeFileSync(
            electronBuilderJsonPath,
            applyNightlyPublishChannel(
                readFileSync(electronBuilderJsonPath, 'utf8')
            )
        );
        console.error(
            `Applied nightly version ${version} to package.json and the nightly publish channel to electron-builder.json.`
        );
    }

    console.log(version);
    return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exitCode = main(process.argv.slice(2));
}
