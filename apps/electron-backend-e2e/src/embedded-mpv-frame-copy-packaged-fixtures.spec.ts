import assert = require('node:assert/strict');
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { isMeaningfulNativePlaybackSnapshot } from './embedded-mpv-frame-copy-packaged-fixtures';
import {
    createDisposablePackagedLinuxApp,
    createRuntimeManifestGuard,
} from './embedded-mpv-frame-copy-packaged-filesystem';
import { resolvePackagedElectronLaunchArgs } from './electron-test-fixtures';
import packagedPlaywrightConfig from '../playwright.packaged.config';

const projectRoot = resolve(__dirname, '..');
const temporaryDirectories = new Set<string>();

type PackageFixture = {
    executablePath: string;
    nativeDir: string;
    packageRoot: string;
    payloadPath: string;
    runtimeManifestPath: string;
};

function createPackageFixture(): PackageFixture {
    const packageRoot = mkdtempSync(
        join(tmpdir(), 'iptvnator-packaged-fixture-source-')
    );
    temporaryDirectories.add(packageRoot);
    const executablePath = join(packageRoot, 'IPTVnator');
    const nativeDir = join(
        packageRoot,
        'resources',
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    const payloadPath = join(packageRoot, 'resources', 'payload.bin');
    const runtimeManifestPath = join(nativeDir, 'embedded-mpv-runtime.json');

    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(executablePath, '#!/bin/sh\nexit 0\n');
    chmodSync(executablePath, 0o755);
    writeFileSync(payloadPath, 'packaged payload');
    chmodSync(payloadPath, 0o640);
    writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
            arch: 'x64',
            platform: 'linux',
            profile: 'portable',
            runtimeMode: 'bundled',
        })
    );

    if (process.platform !== 'win32') {
        symlinkSync(
            'payload.bin',
            join(packageRoot, 'resources', 'payload-link')
        );
    }

    return {
        executablePath,
        nativeDir,
        packageRoot,
        payloadPath,
        runtimeManifestPath,
    };
}

afterEach(() => {
    for (const directory of temporaryDirectories) {
        rmSync(directory, { force: true, recursive: true });
    }
    temporaryDirectories.clear();
});

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

describe('disposable unpacked package clone', () => {
    it('hardlinks regular files, preserves modes and symlinks, and never hides the source manifest', () => {
        const source = createPackageFixture();
        const clone = createDisposablePackagedLinuxApp(source.executablePath);
        temporaryDirectories.add(clone.temporaryRoot);

        try {
            assert.notEqual(clone.packageRoot, source.packageRoot);
            assert.equal(
                statSync(clone.executablePath).mode & 0o777,
                statSync(source.executablePath).mode & 0o777
            );

            const clonedPayloadPath = join(
                clone.packageRoot,
                'resources',
                'payload.bin'
            );
            assert.equal(
                statSync(clonedPayloadPath).ino,
                statSync(source.payloadPath).ino
            );
            assert.equal(statSync(clonedPayloadPath).mode & 0o777, 0o640);

            if (process.platform !== 'win32') {
                const clonedLinkPath = join(
                    clone.packageRoot,
                    'resources',
                    'payload-link'
                );
                assert.equal(lstatSync(clonedLinkPath).isSymbolicLink(), true);
                assert.equal(readlinkSync(clonedLinkPath), 'payload.bin');
            }

            const clonedRuntimeManifestPath = join(
                clone.nativeDir,
                'embedded-mpv-runtime.json'
            );
            const guard = createRuntimeManifestGuard(clone.nativeDir);
            guard.hide();
            assert.equal(existsSync(clonedRuntimeManifestPath), false);
            assert.equal(existsSync(source.runtimeManifestPath), true);
            guard.restore();
        } finally {
            clone.cleanup();
            temporaryDirectories.delete(clone.temporaryRoot);
        }

        assert.equal(existsSync(clone.temporaryRoot), false);
        assert.equal(existsSync(source.runtimeManifestPath), true);
    });

    it('copies a regular file when hardlinking is unavailable', () => {
        const source = createPackageFixture();
        const clone = createDisposablePackagedLinuxApp(source.executablePath, {
            linkFile() {
                throw Object.assign(new Error('cross-device hardlink'), {
                    code: 'EXDEV',
                });
            },
        });
        temporaryDirectories.add(clone.temporaryRoot);

        try {
            assert.equal(statSync(clone.executablePath).mode & 0o777, 0o755);
            const clonedPayloadPath = join(
                clone.packageRoot,
                'resources',
                'payload.bin'
            );
            assert.equal(
                readFileSync(clonedPayloadPath, 'utf8'),
                readFileSync(source.payloadPath, 'utf8')
            );
            assert.notEqual(
                statSync(clonedPayloadPath).ino,
                statSync(source.payloadPath).ino
            );
            assert.equal(statSync(clonedPayloadPath).mode & 0o777, 0o640);
        } finally {
            clone.cleanup();
            temporaryDirectories.delete(clone.temporaryRoot);
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
