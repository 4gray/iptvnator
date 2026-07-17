import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const mockElectronApp = {
    isPackaged: false,
    getAppPath: jest.fn(() => ''),
};

jest.mock('electron', () => ({ app: mockElectronApp }));

import {
    getFrameCopyRuntimeAvailability,
    isFrameCopyPlatformSupported,
    isFrameCopyRuntimeUsable,
    resolveFrameCopyHelperPath,
    shouldPromotePersistedFrameCopyOptIn,
} from './embedded-mpv-frame-copy-platform.util';
import type {
    EmbeddedMpvFrameCopyManifestContract,
    EmbeddedMpvFrameCopyRuntimeResult,
} from './embedded-mpv-frame-copy-runtime';

describe('embedded-mpv-frame-copy-platform.util', () => {
    describe('isFrameCopyPlatformSupported', () => {
        const originalPlatform = process.platform;
        const originalArch = process.arch;

        afterEach(() => {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
            });
            Object.defineProperty(process, 'arch', { value: originalArch });
        });

        it.each<[NodeJS.Platform, string, boolean]>([
            ['darwin', 'arm64', true],
            ['darwin', 'x64', false],
            ['linux', 'x64', true],
            ['linux', 'arm64', false],
            ['linux', 'arm', false],
            ['win32', 'x64', true],
            ['freebsd', 'x64', false],
        ])('%s/%s -> %s', (platform, arch, expected) => {
            Object.defineProperty(process, 'platform', { value: platform });
            Object.defineProperty(process, 'arch', { value: arch });
            expect(isFrameCopyPlatformSupported()).toBe(expected);
        });
    });

    describe('resolveFrameCopyHelperPath', () => {
        let tempDir: string;
        let cwdSpy: jest.SpyInstance<string, []>;
        let originalResourcesPath: string | undefined;

        const releaseDir = () =>
            path.join(
                tempDir,
                'apps',
                'electron-backend',
                'native',
                'build',
                'Release'
            );
        // The resolver looks for the host platform's binary name, so the
        // fixture must follow it for the spec to stay host-agnostic.
        const helperFileName = () =>
            process.platform === 'win32'
                ? 'iptvnator_mpv_helper.exe'
                : 'iptvnator_mpv_helper';
        const helperPath = () => path.join(releaseDir(), helperFileName());
        const readerPath = () =>
            path.join(releaseDir(), 'embedded_mpv_frame_reader.node');

        beforeEach(() => {
            tempDir = mkdtempSync(path.join(tmpdir(), 'impv-fc-util-'));
            mkdirSync(releaseDir(), { recursive: true });
            cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
            mockElectronApp.isPackaged = false;
            mockElectronApp.getAppPath.mockReturnValue('');
            originalResourcesPath = (
                process as NodeJS.Process & { resourcesPath?: string }
            ).resourcesPath;
        });

        afterEach(() => {
            cwdSpy.mockRestore();
            Object.defineProperty(process, 'resourcesPath', {
                configurable: true,
                value: originalResourcesPath,
            });
            rmSync(tempDir, { recursive: true, force: true });
        });

        it('returns null when no helper exists', () => {
            expect(resolveFrameCopyHelperPath()).toBeNull();
        });

        it('returns an executable helper next to the local-build addon path', () => {
            writeFileSync(helperPath(), '#!/bin/sh\n');
            chmodSync(helperPath(), 0o755);
            writeFileSync(readerPath(), 'reader');

            expect(resolveFrameCopyHelperPath()).toBe(helperPath());
        });

        it('ignores an executable helper without its frame reader addon', () => {
            writeFileSync(helperPath(), '#!/bin/sh\n');
            chmodSync(helperPath(), 0o755);

            expect(resolveFrameCopyHelperPath()).toBeNull();
        });

        (process.platform === 'win32' ? it.skip : it)(
            'ignores a helper without the execute bit',
            () => {
                writeFileSync(helperPath(), '#!/bin/sh\n');
                chmodSync(helperPath(), 0o644);
                writeFileSync(readerPath(), 'reader');

                expect(resolveFrameCopyHelperPath()).toBeNull();
            }
        );

        it('does not fall back to cwd build artifacts in a packaged app', () => {
            writeFileSync(helperPath(), '#!/bin/sh\n');
            chmodSync(helperPath(), 0o755);
            writeFileSync(readerPath(), 'reader');
            mockElectronApp.isPackaged = true;
            const resourcesPath = path.join(tempDir, 'IPTVnator', 'Resources');
            Object.defineProperty(process, 'resourcesPath', {
                configurable: true,
                value: resourcesPath,
            });
            mockElectronApp.getAppPath.mockReturnValue(
                path.join(resourcesPath, 'app.asar')
            );

            expect(resolveFrameCopyHelperPath()).toBeNull();

            const packagedNativeDir = path.join(
                resourcesPath,
                'app.asar.unpacked',
                'electron-backend',
                'native'
            );
            mkdirSync(packagedNativeDir, { recursive: true });
            const packagedHelper = path.join(
                packagedNativeDir,
                helperFileName()
            );
            writeFileSync(packagedHelper, '#!/bin/sh\n');
            chmodSync(packagedHelper, 0o755);
            writeFileSync(
                path.join(packagedNativeDir, 'embedded_mpv_frame_reader.node'),
                'reader'
            );

            expect(resolveFrameCopyHelperPath()).toBe(packagedHelper);
        });
    });

    describe('isFrameCopyRuntimeUsable', () => {
        const originalPlatform = process.platform;
        const originalArch = process.arch;

        beforeEach(() => {
            mockElectronApp.isPackaged = false;
        });

        afterEach(() => {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
            });
            Object.defineProperty(process, 'arch', { value: originalArch });
            mockElectronApp.isPackaged = false;
        });

        it('requires a successful Linux x64 runtime probe', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            const resolveHelper = jest.fn(() => '/native/iptvnator_mpv_helper');
            const probeRuntime = jest.fn<
                EmbeddedMpvFrameCopyRuntimeResult,
                [string, EmbeddedMpvFrameCopyManifestContract]
            >(() => ({
                usable: true,
                profile: 'system',
                runtimeMode: 'system',
                libmpv: '2.3',
                renderApi: 'egl',
            }));

            expect(isFrameCopyRuntimeUsable(resolveHelper, probeRuntime)).toBe(
                true
            );
            expect(probeRuntime).toHaveBeenCalledWith(
                '/native/iptvnator_mpv_helper',
                'development'
            );

            probeRuntime.mockReturnValueOnce({
                usable: false,
                reason: 'helper-probe-failed',
            });
            expect(
                getFrameCopyRuntimeAvailability(resolveHelper, probeRuntime)
            ).toEqual({
                usable: false,
                reason: 'helper-probe-failed',
            });
        });

        it('selects the packaged manifest contract only from app.isPackaged', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            mockElectronApp.isPackaged = true;
            const resolveHelper = jest.fn(() => '/native/iptvnator_mpv_helper');
            const probeRuntime = jest.fn<
                EmbeddedMpvFrameCopyRuntimeResult,
                [string, EmbeddedMpvFrameCopyManifestContract]
            >(() => ({
                usable: true,
                profile: 'system',
                runtimeMode: 'system',
                libmpv: '2.3',
                renderApi: 'egl',
            }));

            expect(isFrameCopyRuntimeUsable(resolveHelper, probeRuntime)).toBe(
                true
            );
            expect(probeRuntime).toHaveBeenCalledWith(
                '/native/iptvnator_mpv_helper',
                'packaged'
            );
        });

        it.each<[NodeJS.Platform, string]>([
            ['darwin', 'arm64'],
            ['win32', 'x64'],
        ])(
            'keeps the existing helper-presence gate on %s',
            (platform, arch) => {
                Object.defineProperty(process, 'platform', {
                    value: platform,
                });
                Object.defineProperty(process, 'arch', { value: arch });
                const resolveHelper = jest.fn(
                    () => '/native/iptvnator_mpv_helper'
                );
                const probeRuntime = jest.fn();

                expect(
                    isFrameCopyRuntimeUsable(resolveHelper, probeRuntime)
                ).toBe(true);
                expect(probeRuntime).not.toHaveBeenCalled();
            }
        );

        it('rejects Linux ARM before helper discovery or probing', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            const resolveHelper = jest.fn(() => '/native/iptvnator_mpv_helper');
            const probeRuntime = jest.fn();

            expect(isFrameCopyRuntimeUsable(resolveHelper, probeRuntime)).toBe(
                false
            );
            expect(resolveHelper).not.toHaveBeenCalled();
            expect(probeRuntime).not.toHaveBeenCalled();
        });

        it('reports unsupported architecture for Intel macOS', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            const resolveHelper = jest.fn(() => '/native/iptvnator_mpv_helper');
            const probeRuntime = jest.fn();

            expect(
                getFrameCopyRuntimeAvailability(resolveHelper, probeRuntime)
            ).toEqual({
                usable: false,
                reason: 'unsupported-architecture',
            });
            expect(resolveHelper).not.toHaveBeenCalled();
            expect(probeRuntime).not.toHaveBeenCalled();
        });
    });

    it('lazily probes only a stored opt-in without an explicit env override', () => {
        const runtimeUsable = jest.fn(() => true);
        expect(
            shouldPromotePersistedFrameCopyOptIn(
                false,
                undefined,
                runtimeUsable
            )
        ).toBe(false);
        expect(
            shouldPromotePersistedFrameCopyOptIn(true, '0', runtimeUsable)
        ).toBe(false);
        expect(
            shouldPromotePersistedFrameCopyOptIn(true, '1', runtimeUsable)
        ).toBe(false);
        expect(runtimeUsable).not.toHaveBeenCalled();

        expect(
            shouldPromotePersistedFrameCopyOptIn(true, undefined, runtimeUsable)
        ).toBe(true);
        expect(runtimeUsable).toHaveBeenCalledTimes(1);

        runtimeUsable.mockReturnValue(false);
        expect(
            shouldPromotePersistedFrameCopyOptIn(true, undefined, runtimeUsable)
        ).toBe(false);
        expect(runtimeUsable).toHaveBeenCalledTimes(2);
    });
});
