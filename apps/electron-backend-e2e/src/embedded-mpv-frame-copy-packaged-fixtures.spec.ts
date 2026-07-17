import assert = require('node:assert/strict');
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { isMeaningfulNativePlaybackSnapshot } from './embedded-mpv-frame-copy-packaged-fixtures';
import './embedded-mpv-frame-copy-packaged-filesystem.tests';
import { resolvePackagedElectronLaunchArgs } from './electron-test-fixtures';
import packagedPlaywrightConfig from '../playwright.packaged.config';

const projectRoot = resolve(__dirname, '..');

describe('packaged Electron launch arguments', () => {
    it('disables the Chromium sandbox only when running as root', () => {
        const originalCi = process.env['CI'];
        process.env['CI'] = 'true';

        try {
            assert.deepEqual(
                resolvePackagedElectronLaunchArgs(() => 1000),
                []
            );
            assert.deepEqual(resolvePackagedElectronLaunchArgs(undefined), []);
            assert.deepEqual(
                resolvePackagedElectronLaunchArgs(() => 0),
                ['--no-sandbox']
            );
        } finally {
            if (originalCi === undefined) {
                delete process.env['CI'];
            } else {
                process.env['CI'] = originalCi;
            }
        }
    });
});

describe('native-view playback proof', () => {
    it('requires the loaded URL, a playing or paused state, and positive duration', () => {
        const expectedUrl = 'http://127.0.0.1:3210/fixture.y4m';
        const baseSnapshot = {
            durationSeconds: 2,
            status: 'playing',
            streamUrl: expectedUrl,
        };

        assert.equal(
            isMeaningfulNativePlaybackSnapshot(baseSnapshot, expectedUrl),
            true
        );
        assert.equal(
            isMeaningfulNativePlaybackSnapshot(
                { ...baseSnapshot, status: 'paused' },
                `${expectedUrl}#ignored`
            ),
            true
        );
        assert.equal(
            isMeaningfulNativePlaybackSnapshot(
                { ...baseSnapshot, durationSeconds: null },
                expectedUrl
            ),
            false
        );
        assert.equal(
            isMeaningfulNativePlaybackSnapshot(
                { ...baseSnapshot, status: 'idle' },
                expectedUrl
            ),
            false
        );
        assert.equal(
            isMeaningfulNativePlaybackSnapshot(
                { ...baseSnapshot, streamUrl: `${expectedUrl}?other=1` },
                expectedUrl
            ),
            false
        );
    });

    it('loads the fixture and observes playback before disposing the native session', () => {
        const source = readFileSync(
            join(projectRoot, 'src', 'embedded-mpv-frame-copy-packaged.e2e.ts'),
            'utf8'
        );
        const fallbackStart = source.indexOf('const launchedFallbackApp');
        const captureIndex = source.indexOf(
            'installEmbeddedMpvSessionCapture',
            fallbackStart
        );
        const loadIndex = source.indexOf(
            'loadEmbeddedMpvPlayback',
            fallbackStart
        );
        const proofIndex = source.indexOf(
            'isMeaningfulNativePlaybackSnapshot',
            fallbackStart
        );
        const exitCodeIndex = source.indexOf(
            'electronApp.process().exitCode',
            fallbackStart
        );
        const disposeIndex = source.indexOf(
            'disposeEmbeddedMpvSession',
            fallbackStart
        );

        assert.ok(fallbackStart >= 0);
        assert.ok(captureIndex > fallbackStart);
        assert.ok(loadIndex > captureIndex);
        assert.ok(proofIndex > loadIndex);
        assert.ok(exitCodeIndex > proofIndex);
        assert.ok(disposeIndex > exitCodeIndex);
    });

    it('removes the manifest-declared libmpv target and expects the stable missing-library reason', () => {
        const source = readFileSync(
            join(projectRoot, 'src', 'embedded-mpv-frame-copy-packaged.e2e.ts'),
            'utf8'
        );
        const manifestIdentityIndex = source.indexOf(
            'const runtimeIdentity = readPackagedRuntimeIdentity'
        );
        const guardIndex = source.indexOf(
            'createPackagedEntryGuard(',
            manifestIdentityIndex
        );
        const sonameIndex = source.indexOf(
            'runtimeIdentity.libmpvSoname',
            guardIndex
        );
        const hideIndex = source.indexOf('.hide()', sonameIndex);
        const fallbackStart = source.indexOf(
            'const launchedFallbackApp',
            hideIndex
        );
        const missingReasonIndex = source.indexOf(
            "frameCopyUnavailableReason: 'runtime-library-missing'",
            fallbackStart
        );

        assert.ok(manifestIdentityIndex >= 0);
        assert.ok(guardIndex > manifestIdentityIndex);
        assert.ok(sonameIndex > guardIndex);
        assert.ok(hideIndex > sonameIndex);
        assert.ok(fallbackStart > hideIndex);
        assert.ok(missingReasonIndex > fallbackStart);
        assert.doesNotMatch(source, /createRuntimeManifestGuard/);
        assert.doesNotMatch(source, /runtimeManifest\.hide/);
    });
});

describe('dedicated packaged smoke target', () => {
    it('inherits the GL mode from the workflow environment', () => {
        const source = readFileSync(
            join(projectRoot, 'src', 'embedded-mpv-frame-copy-packaged.e2e.ts'),
            'utf8'
        );

        assert.doesNotMatch(source, /LIBGL_ALWAYS_SOFTWARE\s*:/);
    });

    it('does not build the backend or start portal mock servers', () => {
        const project = JSON.parse(
            readFileSync(join(projectRoot, 'project.json'), 'utf8')
        ) as {
            targets?: Record<
                string,
                {
                    cache?: boolean;
                    dependsOn?: unknown;
                    options?: { command?: string };
                }
            >;
        };
        const target = project.targets?.['packaged-frame-copy-smoke'];
        const packagedConfig = readFileSync(
            join(projectRoot, 'playwright.packaged.config.ts'),
            'utf8'
        );

        if (!target) {
            throw new Error('The packaged frame-copy smoke target is missing.');
        }
        assert.equal(target.cache, false);
        assert.equal(target.dependsOn, undefined);
        assert.match(
            target.options?.command ?? '',
            /playwright\.packaged\.config\.ts/
        );
        assert.match(
            target.options?.command ?? '',
            /embedded-mpv-frame-copy-packaged\.e2e\.ts/
        );
        assert.match(packagedConfig, /timeout:\s*120000/);
        assert.match(packagedConfig, /webServer:\s*\[\]/);
        assert.deepEqual(packagedPlaywrightConfig.webServer, []);
    });
});
