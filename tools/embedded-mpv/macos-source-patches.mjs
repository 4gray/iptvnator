import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Upstream-merged fixes applied to pinned macOS runtime sources before the
// build. Keep each file byte-for-byte as upstream published it, and remove an
// entry once the pinned release contains its commit (see "Local source
// patches" in docs/architecture/embedded-mpv-native.md).
export const MACOS_SOURCE_PATCHES = Object.freeze([
    Object.freeze({
        packageId: 'mpv',
        path: 'tools/embedded-mpv/patches/mpv/0001-ao_coreaudio-cleanup-ao-on-init-failure.patch',
        sha256: 'ae4d698c50c4e0ec4ae809fe97187e2dcca74bfaa2ca984be3d3a2acf14d2b8e',
        upstreamCommit: 'af067b5ea8e5fe396ebd9d3f895e51a7e75b3c09',
        upstreamPullRequest: 'https://github.com/mpv-player/mpv/pull/18383',
    }),
    Object.freeze({
        packageId: 'mpv',
        path: 'tools/embedded-mpv/patches/mpv/0002-ao_coreaudio-register-hotplug-after-successful-audiounit-init.patch',
        sha256: '769b218df220738cc1cf9f81cf696c16518c5dfe56a5ef028e33b22536e0e924',
        upstreamCommit: 'c5d391adba7bd024954d0df1e0405f5749f4d4ca',
        upstreamPullRequest: 'https://github.com/mpv-player/mpv/pull/18383',
    }),
]);

function defaultRunGit(args, { cwd }) {
    // Inside another work tree, git apply silently skips files that tree
    // ignores (a build root under the repo's ignored /build, for example).
    // The ceiling keeps git from discovering any repository above the source.
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
    });
    if (result.error) {
        throw result.error;
    }
    return { status: result.status, stderr: result.stderr ?? '' };
}

function sha256File(filePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
}

/**
 * Applies every registered patch for `packageId` to `sourcePath`, in order.
 * Fails closed: a changed patch file, an already-applied patch, a patch that
 * does not apply, or one that does not verify afterwards all throw.
 */
export function applySourcePatches({
    packageId,
    sourcePath,
    workspaceRoot,
    patches = MACOS_SOURCE_PATCHES,
    runGit = defaultRunGit,
}) {
    const applied = [];

    for (const patch of patches.filter(
        (candidate) => candidate.packageId === packageId
    )) {
        const name = path.basename(patch.path);
        const patchPath = path.resolve(workspaceRoot, patch.path);
        const fail = (reason) =>
            new Error(`${packageId} patch ${name}: ${reason}`);
        const git = (...args) =>
            runGit(['apply', ...args, patchPath], { cwd: sourcePath });

        const actualSha256 = sha256File(patchPath);
        if (actualSha256 !== patch.sha256) {
            throw fail(
                `SHA-256 mismatch, expected ${patch.sha256}, actual ${actualSha256}`
            );
        }
        if (git('--check', '--reverse').status === 0) {
            throw fail(
                `already applied to the pinned source; remove it once the pin contains upstream commit ${patch.upstreamCommit}`
            );
        }
        // git apply is atomic: on failure it leaves every file untouched.
        const apply = git();
        if (apply.status !== 0) {
            throw fail(`does not apply: ${apply.stderr.trim()}`);
        }
        if (git('--check', '--reverse').status !== 0) {
            throw fail('did not land; the reverse check failed after apply');
        }

        applied.push({
            name,
            sha256: patch.sha256,
            upstreamCommit: patch.upstreamCommit,
            upstreamPullRequest: patch.upstreamPullRequest,
        });
    }

    return applied;
}
