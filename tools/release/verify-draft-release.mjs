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
import { readFileSync } from 'node:fs';
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
    const pacmanPattern = new RegExp(
        `^iptvnator-${version.replace(/\./g, '\\.')}-linux-(x64\\.pacman|x86_64\\.pkg\\.tar\\.[a-z0-9]+)$`
    );

    rules.push({
        label: `Pacman (iptvnator-${version}-linux-x64.pacman or .pkg.tar.*)`,
        matches: (candidate) => pacmanPattern.test(candidate),
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

            if (!value || value.startsWith('--')) {
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

/**
 * Verification pipeline over an injectable gh boundary, so tests never touch
 * the network. `io.watchRun` streams `gh run watch` to the terminal and
 * throws on a failed run; the other two return parsed `--json` payloads.
 *
 * @param {{ version: string, wait: boolean, repo: string }} options
 * @param {{ listRuns: Function, watchRun: Function, viewRelease: Function }} io
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function runVerification(options, io) {
    const { version, wait, repo } = options;
    const tag = `v${version}`;
    const lines = [];

    if (wait) {
        const runs = io.listRuns({ repo, workflow: WORKFLOW, branch: tag });

        if (runs.length === 0) {
            return {
                exitCode: 1,
                lines: [
                    `No ${WORKFLOW} run found for ${tag} in ${repo} — was the tag pushed?`,
                ],
            };
        }

        const run = runs[0];

        if (run.status !== 'completed') {
            lines.push(`Waiting for ${WORKFLOW} run ${run.databaseId} (${tag})…`);
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

    lines.push(
        release.isDraft
            ? `Draft release ${tag} found.`
            : `WARNING: release ${tag} is already published, not a draft.`
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
};

function main() {
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

    const { exitCode, lines } = runVerification(options, liveIo);

    for (const line of lines) {
        console.log(line);
    }

    process.exit(exitCode);
}

const isDirectRun =
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
