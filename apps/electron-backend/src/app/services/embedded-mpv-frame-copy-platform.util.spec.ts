import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const mockElectronApp = {
    isPackaged: false,
    getAppPath: jest.fn(() => ''),
};

jest.mock('electron', () => ({ app: mockElectronApp }));

import {
    isFrameCopyPlatformSupported,
    resolveFrameCopyHelperPath,
} from './embedded-mpv-frame-copy-platform.util';
import * as frameCopyPlatform from './embedded-mpv-frame-copy-platform.util';

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
            ['linux', 'x64', false],
            ['win32', 'x64', false],
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
        const helperPath = () =>
            path.join(releaseDir(), 'iptvnator_mpv_helper');
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
                'iptvnator_mpv_helper'
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

    it('promotes a stored opt-in only without an explicit env override and with a usable runtime', () => {
        const shouldPromote = (
            frameCopyPlatform as typeof frameCopyPlatform & {
                shouldPromotePersistedFrameCopyOptIn?: (
                    storedEnabled: boolean,
                    explicitEnv: string | undefined,
                    runtimeUsable: boolean
                ) => boolean;
            }
        ).shouldPromotePersistedFrameCopyOptIn;

        expect(shouldPromote).toBeDefined();
        expect(shouldPromote?.(true, undefined, true)).toBe(true);
        expect(shouldPromote?.(true, undefined, false)).toBe(false);
        expect(shouldPromote?.(true, '0', true)).toBe(false);
        expect(shouldPromote?.(true, '1', true)).toBe(false);
        expect(shouldPromote?.(false, undefined, true)).toBe(false);
    });
});
