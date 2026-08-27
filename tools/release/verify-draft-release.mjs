#!/usr/bin/env node
/**
 * Waits for the `v<version>` tag build and verifies the draft GitHub release
 * it creates: run conclusion, draft status, authored body, and the complete
 * required asset set.
 *
 *   node tools/release/verify-draft-release.mjs                # package.json version
 *   node tools/release/verify-draft-release.mjs 0.24.0
 *   node tools/release/verify-draft-release.mjs --no-wait 0.24.0
 *
 * Read-only: it never publishes, edits, or deletes anything. Publishing the
 * release stays a manual act after this check and the installer smoke tests.
 *
 * The required set mirrors what `.github/workflows/build-and-make.yaml`
 * uploads for a complete matrix build (verified against a real full run).
 * When the build matrix gains or loses a target, update REQUIRED_ASSET_RULES
 * in the same PR.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { REPO_URL } from './release-notes.mjs';

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

export const REPO_SLUG = REPO_URL.replace('https://github.com/', '');
const WORKFLOW = 'build-and-make.yaml';
const CLI_USAGE =
    'Usage: verify-draft-release.mjs [--no-wait] [--repo owner/name] [<version>]';

/**
 * @param {string} version bare semver
 * @returns {{ label: string, matches: (name: string) => boolean }[]}
 */
export function requiredAssetRules(version) {
    const exact = (label, name) => ({
        label: `${label} (${name})`,
        matches: (candidate) => candidate === name,
    });

    const rules = [];

    for (const arch of ['x64', 'arm64']) {
        for (const extension of ['dmg', 'zip']) {
            const base = `iptvnator-${version}-mac-${arch}.${extension}`;

            rules.push(exact('macOS', base));
            rules.push(exact('macOS blockmap', `${base}.blockmap`));
        }
    }

    const windowsSetup = `iptvnator-${version}-windows-x64-setup.exe`;

    rules.push(exact('Windows', windowsSetup));
    rules.push(exact('Windows blockmap', `${windowsSetup}.blockmap`));

    for (const arch of ['amd64', 'arm64', 'armv7l']) {
        rules.push(exact('DEB', `iptvnator-${version}-linux-${arch}.deb`));
    }

    for (const arch of ['x86_64', 'arm64', 'armv7l']) {
        rules.push(
            exact('AppImage', `iptvnator-${version}-linux-${arch}.AppImage`)
        );
    }

    for (const arch of ['amd64', 'armhf']) {
        rules.push(exact('Snap', `iptvnator-${version}-linux-${arch}.snap`));
    }

    rules.push(exact('RPM', `iptvnator-${version}-linux-x86_64.rpm`));
    rules.push(exact('Flatpak', `iptvnator-${version}-linux-x86_64.flatpak`));

    // Electron Builder has shipped both pacman artifact shapes; accept either.
    // Compared as plain strings rather than through a regex built from the
    // version: this function is exported, so escaping the interpolated value
    // correctly would be a standing trap. Only the compression suffix, a
    // literal pattern, is matched by regex.
    const pacmanExact = `iptvnator-${version}-linux-x64.pacman`;
    const pacmanPrefix = `iptvnator-${version}-linux-x86_64.pkg.tar.`;

    rules.push({
        label: `Pacman (${pacmanExact} or …-linux-x86_64.pkg.tar.*)`,
        matches: (candidate) =>
            candidate === pacmanExact ||
            (candidate.startsWith(pacmanPrefix) &&
                /^[a-z0-9]+$/.test(candidate.slice(pacmanPrefix.length))),
    });

    for (const name of [
        'latest.yml',
        'latest-mac.yml',
        'latest-linux.yml',
        'latest-linux-arm.yml',
        'latest-linux-arm64.yml',
    ]) {
        rules.push(exact('Updater metadata', name));
    }

    rules.push(
        exact('Source archive', 'linux-frame-copy-runtime-sources.tar.xz')
    );

    return rules;
}

/**
 * @param {string[]} assetNames names attached to the release
 * @param {string} version bare semver
 * @returns {{ missing: string[], extras: string[] }} `missing` lists unmet
 * rule labels; `extras` lists assets no rule claims (informational only —
 * a new build target shows up here before the rules learn about it)
 */
export function verifyReleaseAssets(assetNames, version) {
    const rules = requiredAssetRules(version);
    const missing = rules
        .filter((rule) => !assetNames.some((name) => rule.matches(name)))
        .map((rule) => rule.label);
    const extras = assetNames.filter(
        (name) => !rules.some((rule) => rule.matches(name))
    );

    return { missing, extras };
}

/**
 * @param {string[]} args
 * @returns {{ version: string | null, wait: boolean, repo: string } | null}
 * `version: null` means "use package.json"; null result means bad usage
 */
export function parseVerifyArguments(args) {
    const options = { version: null, wait: true, repo: REPO_SLUG };
    const positional = [];

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (arg === '--no-wait') {
            options.wait = false;
        } else if (arg === '--repo') {
            const value = args[index + 1];

            // Shape-checked here so a typo fails with this script's usage
            // line instead of an opaque gh error several calls later.
            if (!value || !/^[\w.-]+\/[\w.-]+$/.test(value)) {
                return null;
            }

            options.repo = value;
            index += 1;
        } else if (arg === '--') {
            // pnpm forwards the npm-style separator verbatim; ignore it.
        } else if (arg.startsWith('--')) {
            return null;
        } else {
            positional.push(arg);
        }
    }

    if (positional.length > 1) {
        return null;
    }

    if (positional.length === 1) {
        const version = positional[0].replace(/^v/, '');

        if (!/^\d+\.\d+\.\d+$/.test(version)) {
            return null;
        }

        options.version = version;
    }

    return options;
}

/** A just-pushed tag's run is not immediately visible to the API. */
export const RUN_POLL_ATTEMPTS = 10;
export const RUN_POLL_INTERVAL_MS = 6000;

/**
 * `gh run list` reports what is indexed right now — its `--limit` caps how
 * many runs come back, it does not wait for one to appear. Run straight after
 * `git push <remote> v<version>`, the tag build is routinely not indexed yet,
 * so poll for a bounded window before concluding the tag was never pushed.
 *
 * @returns {Promise<object | null>} the newest run, or null after the window
 */
async function findTagRun({ repo, branch }, io) {
    for (let attempt = 1; attempt <= RUN_POLL_ATTEMPTS; attempt += 1) {
        const runs = io.listRuns({ repo, workflow: WORKFLOW, branch });

        if (runs.length > 0) {
            return runs[0];
        }

        if (attempt < RUN_POLL_ATTEMPTS) {
            io.progress(
                `No ${WORKFLOW} run for ${branch} yet (attempt ${attempt}/${RUN_POLL_ATTEMPTS}) — waiting…`
            );
            await io.sleep(RUN_POLL_INTERVAL_MS);
        }
    }

    return null;
}

/**
 * Verification pipeline over an injectable gh boundary, so tests never touch
 * the network. `io.watchRun` streams `gh run watch` to the terminal and throws
 * on a failed run, `io.listRuns`/`io.viewRelease` return parsed `--json`
 * payloads, `io.progress` reports transient status while waiting, and
 * `io.sleep` paces the run poll.
 *
 * @param {{ version: string, wait: boolean, repo: string }} options
 * @param {{ listRuns: Function, watchRun: Function, viewRelease: Function, progress: Function, sleep: Function }} io
 * @returns {Promise<{ exitCode: number, lines: string[] }>}
 */
export async function runVerification(options, io) {
    const { version, wait, repo } = options;
    const tag = `v${version}`;
    const lines = [];

    if (wait) {
        const run = await findTagRun({ repo, branch: tag }, io);

        if (run === null) {
            return {
                exitCode: 1,
                lines: [
                    `No ${WORKFLOW} run found for ${tag} in ${repo} after ${RUN_POLL_ATTEMPTS} attempts — was the tag pushed?`,
                ],
            };
        }

        if (run.status !== 'completed') {
            io.progress(`Waiting for ${WORKFLOW} run ${run.databaseId} (${tag})…`);
            io.watchRun({ repo, runId: run.databaseId });
        } else if (run.conclusion !== 'success') {
            return {
                exitCode: 1,
                lines: [
                    `${WORKFLOW} run for ${tag} completed with conclusion "${run.conclusion}" — fix the build before verifying assets.`,
                ],
            };
        }
    }

    const release = io.viewRelease({ repo, tag });

    if (release === null) {
        return {
            exitCode: 1,
            lines: [`No release found for ${tag} in ${repo}.`],
        };
    }

    const publishedAlready = !release.isDraft;

    lines.push(
        publishedAlready
            ? `Release ${tag} is already published — this gate runs before publication.`
            : `Draft release ${tag} found.`
    );

    if (!release.body?.trim()) {
        lines.push(
            'WARNING: authored release body is empty (expected only for an internal-only release).'
        );
    }

    const assetNames = release.assets.map((asset) => asset.name);
    const { missing, extras } = verifyReleaseAssets(assetNames, version);

    for (const extra of extras) {
        lines.push(`NOTE: unrecognized asset ${extra} (not required by the rules).`);
    }

    if (missing.length > 0) {
        lines.push(`Missing ${missing.length} required asset(s):`);
        lines.push(...missing.map((label) => `  - ${label}`));

        return { exitCode: 1, lines };
    }

    lines.push(
        `All ${requiredAssetRules(version).length} required assets present (${assetNames.length} attached).`
    );

    // A published release still gets its asset report — auditing one after the
    // fact is useful — but never a success exit. Succeeding here would claim a
    // pre-publication gate passed for a boundary already crossed.
    if (publishedAlready) {
        return { exitCode: 1, lines };
    }

    lines.push(
        'Next: verify the authored body text, smoke-test installers, then publish the release manually.'
    );

    return { exitCode: 0, lines };
}

function gh(args) {
    return execFileSync('gh', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

const liveIo = {
    listRuns: ({ repo, workflow, branch }) =>
        JSON.parse(
            gh([
                'run',
                'list',
                '--repo',
                repo,
                '--workflow',
                workflow,
                '--branch',
                branch,
                '--limit',
                '1',
                '--json',
                'databaseId,status,conclusion',
            ])
        ),
    watchRun: ({ repo, runId }) => {
        const result = spawnSync(
            'gh',
            ['run', 'watch', String(runId), '--repo', repo, '--exit-status'],
            { stdio: 'inherit' }
        );

        // spawnSync reports a missing binary and a signalled child as
        // `status: null` rather than throwing. Blaming the build for either
        // would send the release manager after a build that is fine.
        if (result.error) {
            throw new Error(`could not run gh: ${result.error.message}`);
        }

        if (result.signal) {
            throw new Error(
                `gh run watch was interrupted (${result.signal}) — run ${runId} was not judged`
            );
        }

        if (result.status !== 0) {
            throw new Error(
                `tag build run ${runId} failed — fix the build before verifying assets`
            );
        }
    },
    viewRelease: ({ repo, tag }) => {
        try {
            return JSON.parse(
                gh([
                    'release',
                    'view',
                    tag,
                    '--repo',
                    repo,
                    '--json',
                    'name,isDraft,body,assets',
                ])
            );
        } catch (error) {
            if (/release not found/i.test(`${error.stderr ?? ''}`)) {
                return null;
            }

            throw error;
        }
    },
    progress: (message) => console.error(message),
    // Deliberately not unref'd: a pending promise does not hold the event
    // loop open, so an unref'd timer would let Node exit mid-poll — and an
    // empty event loop exits 0, turning a wait into a silent false success.
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

async function main() {
    const options = parseVerifyArguments(process.argv.slice(2));

    if (options === null) {
        console.error(CLI_USAGE);
        process.exit(2);
    }

    if (options.version === null) {
        options.version = JSON.parse(
            readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')
        ).version;
        console.error(`Using version ${options.version} from package.json.`);
    }

    const { exitCode, lines } = await runVerification(options, liveIo);

    for (const line of lines) {
        console.log(line);
    }

    process.exit(exitCode);
}

// realpath on both sides: Node resolves symlinks for `import.meta.url` but
// not for argv[1], so a checkout reached through a symlinked path (macOS
// /tmp and /var are symlinks) made this publication gate a silent exit-0
// no-op — which reads exactly like a pass.
const isDirectRun = (() => {
    if (!process.argv[1]) {
        return false;
    }

    try {
        return (
            realpathSync(process.argv[1]) ===
            realpathSync(fileURLToPath(import.meta.url))
        );
    } catch {
        return false;
    }
})();

if (isDirectRun) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
