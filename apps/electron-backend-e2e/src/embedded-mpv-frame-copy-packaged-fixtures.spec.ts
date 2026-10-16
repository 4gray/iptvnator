import assert = require('node:assert/strict');
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
    createWavFixture,
    isMeaningfulNativePlaybackSnapshot,
} from './embedded-mpv-frame-copy-packaged-fixtures';
import { describeFrameRing } from './embedded-mpv-frame-copy-packaged-diagnostics';
import './embedded-mpv-frame-copy-packaged-filesystem.tests';
import { resolvePackagedElectronLaunchArgs } from './electron-test-fixtures';
import packagedPlaywrightConfig from '../playwright.packaged.config';

const projectRoot = resolve(__dirname, '..');

describe('packaged Electron launch arguments', () => {
    it('keeps WebGL enabled for software rendering while disabling the sandbox only as root', () => {
        assert.deepEqual(
            resolvePackagedElectronLaunchArgs(() => 1000),
            ['--ignore-gpu-blocklist']
        );
        assert.deepEqual(resolvePackagedElectronLaunchArgs(undefined), [
            '--ignore-gpu-blocklist',
        ]);
        assert.deepEqual(
            resolvePackagedElectronLaunchArgs(() => 0),
            ['--ignore-gpu-blocklist', '--no-sandbox']
        );
    });
});

describe('audio-only MPV fixture', () => {
    it('declares the full mono PCM body and sample rate', () => {
        const wav = createWavFixture();
        assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
        assert.equal(wav.readUInt32LE(4), wav.length - 8);
        assert.equal(wav.readUInt16LE(20), 1);
        assert.equal(wav.readUInt16LE(22), 1);
        assert.equal(wav.readUInt32LE(24), 8000);
        assert.equal(wav.readUInt32LE(40), wav.length - 44);
        assert.equal(wav.length - 44, 8000 * 2 * 30);
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
        assert.deepEqual(target.dependsOn, [
            'test-packaged-frame-copy-fixtures',
        ]);
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

describe('frame ring diagnostics', () => {
    // FrameShmHeader (native/helper/frame_shm.h) for a 4x2 ring whose newest
    // frame (seq 4, slot 1) has three non-black BGRA pixels.
    function createRing(): Buffer {
        const width = 4;
        const height = 2;
        const frameBytes = width * height * 4;
        const dataOffset = 4096;
        const ring = Buffer.alloc(dataOffset + 3 * frameBytes);
        ring.writeUInt32LE(0x564d5046, 0);
        ring.writeUInt32LE(1, 4);
        ring.writeUInt32LE(width, 8);
        ring.writeUInt32LE(height, 12);
        ring.writeUInt32LE(width * 4, 16);
        ring.writeUInt32LE(2, 20);
        ring.writeBigUInt64LE(BigInt(frameBytes), 24);
        ring.writeBigUInt64LE(BigInt(dataOffset), 32);
        ring.writeBigUInt64LE(BigInt(4), 40);
        ring.writeBigUInt64LE(BigInt(1000000000), 48);
        [BigInt(3), BigInt(4), BigInt(2)].forEach((seq, slot) =>
            ring.writeBigUInt64LE(seq, 56 + slot * 16)
        );
        const latest = dataOffset + frameBytes;
        for (const pixel of [0, 3, 7]) {
            ring[latest + pixel * 4 + 2] = 255; // red channel of BGRA
        }
        // Slot 0 holds a fully visible older frame; it must not leak into the
        // newest frame's signal.
        ring.fill(255, dataOffset, dataOffset + frameBytes);
        return ring;
    }

    it('reports the newest published frame and its visible signal', () => {
        assert.deepEqual(
            describeFrameRing(
                'impv-fc-test-g2',
                createRing(),
                BigInt(1250000000)
            ),
            {
                name: 'impv-fc-test-g2',
                valid: true,
                width: 4,
                height: 2,
                generation: 2,
                latestSeq: 4,
                slotSeqs: [3, 4, 2],
                slotSignals: [8, 3, 0],
                heartbeatAgeMs: 250,
                latestFrameSignal: 3,
            }
        );
    });

    it('distinguishes an unpublished or uninitialised ring', () => {
        const unpublished = createRing();
        unpublished.writeBigUInt64LE(BigInt(0), 40);
        assert.equal(
            describeFrameRing('ring', unpublished, BigInt(0)).latestFrameSignal,
            null
        );
        assert.deepEqual(
            describeFrameRing('ring', Buffer.alloc(8), BigInt(0)),
            {
                name: 'ring',
                valid: false,
            }
        );
    });
});
