import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    parseVerifyArguments,
    requiredAssetRules,
    runVerification,
    verifyReleaseAssets,
} from './verify-draft-release.mjs';

/** The asset list of a real, complete v0.23.0 matrix build. */
function completeAssets(version) {
    return [
        `iptvnator-${version}-linux-amd64.deb`,
        `iptvnator-${version}-linux-amd64.snap`,
        `iptvnator-${version}-linux-arm64.AppImage`,
        `iptvnator-${version}-linux-arm64.deb`,
        `iptvnator-${version}-linux-armhf.snap`,
        `iptvnator-${version}-linux-armv7l.AppImage`,
        `iptvnator-${version}-linux-armv7l.deb`,
        `iptvnator-${version}-linux-x64.pacman`,
        `iptvnator-${version}-linux-x86_64.AppImage`,
        `iptvnator-${version}-linux-x86_64.flatpak`,
        `iptvnator-${version}-linux-x86_64.rpm`,
        `iptvnator-${version}-mac-arm64.dmg`,
        `iptvnator-${version}-mac-arm64.dmg.blockmap`,
        `iptvnator-${version}-mac-arm64.zip`,
        `iptvnator-${version}-mac-arm64.zip.blockmap`,
        `iptvnator-${version}-mac-x64.dmg`,
        `iptvnator-${version}-mac-x64.dmg.blockmap`,
        `iptvnator-${version}-mac-x64.zip`,
        `iptvnator-${version}-mac-x64.zip.blockmap`,
        `iptvnator-${version}-windows-x64-setup.exe`,
        `iptvnator-${version}-windows-x64-setup.exe.blockmap`,
        'latest-linux-arm.yml',
        'latest-linux-arm64.yml',
        'latest-linux.yml',
        'latest-mac.yml',
        'latest.yml',
        'linux-frame-copy-runtime-sources.tar.xz',
    ];
}

function release(overrides = {}) {
    return {
        name: 'v0.24.0',
        isDraft: true,
        body: '### Features\n\n- entry',
        assets: completeAssets('0.24.0').map((name) => ({ name })),
        ...overrides,
    };
}

function io(overrides = {}) {
    return {
        listRuns: () => [
            { databaseId: 42, status: 'completed', conclusion: 'success' },
        ],
        watchRun: () => {
            throw new Error('watchRun must not be called');
        },
        viewRelease: () => release(),
        ...overrides,
    };
}

describe('verifyReleaseAssets', () => {
    it('accepts the complete real-world asset set with no extras', () => {
        const { missing, extras } = verifyReleaseAssets(
            completeAssets('0.24.0'),
            '0.24.0'
        );

        assert.deepEqual(missing, []);
        assert.deepEqual(extras, []);
    });

    it('every rule is matched by exactly the assets it names', () => {
        // One required asset per rule: the counts must line up, otherwise a
        // rule silently matches two files and a missing one goes unnoticed.
        assert.equal(
            requiredAssetRules('0.24.0').length,
            completeAssets('0.24.0').length
        );
    });

    it('reports missing assets by label', () => {
        const withoutSnap = completeAssets('0.24.0').filter(
            (name) => !name.endsWith('.snap')
        );
        const { missing } = verifyReleaseAssets(withoutSnap, '0.24.0');

        assert.deepEqual(missing, [
            'Snap (iptvnator-0.24.0-linux-amd64.snap)',
            'Snap (iptvnator-0.24.0-linux-armhf.snap)',
        ]);
    });

    it('rejects assets from a different version', () => {
        const { missing } = verifyReleaseAssets(
            completeAssets('0.23.0'),
            '0.24.0'
        );

        assert.ok(missing.length > 0);
    });

    it('accepts the alternate pacman artifact shape', () => {
        const assets = completeAssets('0.24.0').map((name) =>
            name.endsWith('.pacman')
                ? 'iptvnator-0.24.0-linux-x86_64.pkg.tar.zst'
                : name
        );

        assert.deepEqual(verifyReleaseAssets(assets, '0.24.0').missing, []);
    });

    it('does not let the pacman pattern match across version dots', () => {
        const { extras } = verifyReleaseAssets(
            ['iptvnator-0x24y0-linux-x64.pacman'],
            '0.24.0'
        );

        assert.deepEqual(extras, ['iptvnator-0x24y0-linux-x64.pacman']);
    });

    it('surfaces unrecognized assets as extras, not errors', () => {
        const { missing, extras } = verifyReleaseAssets(
            [...completeAssets('0.24.0'), 'iptvnator-0.24.0-win-arm64.exe'],
            '0.24.0'
        );

        assert.deepEqual(missing, []);
        assert.deepEqual(extras, ['iptvnator-0.24.0-win-arm64.exe']);
    });
});

describe('parseVerifyArguments', () => {
    it('defaults to waiting and the canonical repo', () => {
        assert.deepEqual(parseVerifyArguments([]), {
            version: null,
            wait: true,
            repo: '4gray/iptvnator',
        });
    });

    it('normalizes a v-prefixed version and honours flags', () => {
        assert.deepEqual(
            parseVerifyArguments([
                '--no-wait',
                '--repo',
                'fork/iptvnator',
                'v0.24.0',
            ]),
            { version: '0.24.0', wait: false, repo: 'fork/iptvnator' }
        );
    });

    it('ignores a bare `--` separator', () => {
        assert.equal(parseVerifyArguments(['--', '0.24.0']).version, '0.24.0');
    });

    it('rejects bad usage', () => {
        for (const args of [
            ['0.24'],
            ['0.24.0', 'extra'],
            ['--unknown'],
            ['--repo'],
            ['--repo', '--no-wait'],
        ]) {
            assert.equal(parseVerifyArguments(args), null, args.join(' '));
        }
    });
});

describe('runVerification', () => {
    const options = { version: '0.24.0', wait: true, repo: '4gray/iptvnator' };

    it('passes a complete draft and points at the manual next steps', () => {
        const result = runVerification(options, io());

        assert.equal(result.exitCode, 0);
        assert.match(result.lines[0], /Draft release v0\.24\.0 found\./);
        assert.match(
            result.lines.at(-2),
            /All 27 required assets present \(27 attached\)\./
        );
        assert.match(result.lines.at(-1), /publish the release manually/);
    });

    it('fails when no tag build run exists', () => {
        const result = runVerification(options, io({ listRuns: () => [] }));

        assert.equal(result.exitCode, 1);
        assert.match(result.lines[0], /No build-and-make\.yaml run found/);
    });

    it('fails on a completed run with a non-success conclusion', () => {
        const result = runVerification(
            options,
            io({
                listRuns: () => [
                    {
                        databaseId: 42,
                        status: 'completed',
                        conclusion: 'failure',
                    },
                ],
            })
        );

        assert.equal(result.exitCode, 1);
        assert.match(result.lines[0], /conclusion "failure"/);
    });

    it('watches an in-progress run before checking the release', () => {
        const watched = [];
        const result = runVerification(
            options,
            io({
                listRuns: () => [
                    { databaseId: 7, status: 'in_progress', conclusion: null },
                ],
                watchRun: (request) => watched.push(request),
            })
        );

        assert.deepEqual(watched, [{ repo: '4gray/iptvnator', runId: 7 }]);
        assert.equal(result.exitCode, 0);
    });

    it('skips the run lookup entirely with --no-wait', () => {
        const result = runVerification(
            { ...options, wait: false },
            io({
                listRuns: () => {
                    throw new Error('listRuns must not be called');
                },
            })
        );

        assert.equal(result.exitCode, 0);
    });

    it('fails with the missing-asset list', () => {
        const result = runVerification(
            options,
            io({
                viewRelease: () =>
                    release({
                        assets: completeAssets('0.24.0')
                            .filter((name) => !name.endsWith('.flatpak'))
                            .map((name) => ({ name })),
                    }),
            })
        );

        assert.equal(result.exitCode, 1);
        assert.match(result.lines.at(-2), /Missing 1 required asset/);
        assert.match(result.lines.at(-1), /Flatpak/);
    });

    it('fails when the release does not exist', () => {
        const result = runVerification(
            options,
            io({ viewRelease: () => null })
        );

        assert.equal(result.exitCode, 1);
        assert.match(result.lines[0], /No release found for v0\.24\.0/);
    });

    it('warns on a published release and an empty body but still verifies', () => {
        const result = runVerification(
            options,
            io({ viewRelease: () => release({ isDraft: false, body: ' ' }) })
        );

        assert.equal(result.exitCode, 0);
        assert.match(result.lines[0], /WARNING: release v0\.24\.0 is already published/);
        assert.match(result.lines[1], /WARNING: authored release body is empty/);
    });

    it('notes unrecognized assets without failing', () => {
        const result = runVerification(
            options,
            io({
                viewRelease: () =>
                    release({
                        assets: [
                            ...completeAssets('0.24.0'),
                            'iptvnator-0.24.0-win-arm64.exe',
                        ].map((name) => ({ name })),
                    }),
            })
        );

        assert.equal(result.exitCode, 0);
        assert.match(
            result.lines.find((line) => line.startsWith('NOTE:')),
            /unrecognized asset iptvnator-0\.24\.0-win-arm64\.exe/
        );
    });
});
