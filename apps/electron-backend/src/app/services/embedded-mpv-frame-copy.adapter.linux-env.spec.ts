import type { Stats } from 'fs';
import path from 'path';

// The adapter reaches `electron` through the platform util for packaged
// paths only; mocking it keeps this suite independent of the Electron binary
// being present (a CI runner can restore node_modules without it).
jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/mock/app',
        getPath: () => '/mock/user-data',
    },
}));

const spawnMock = jest.fn();
jest.mock('child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

import type { EmbeddedMpvFrameCopyAdapter } from './embedded-mpv-frame-copy.adapter';
import {
    createFrameCopyAdapter,
    createFrameCopySession,
    fakeStat,
    FakeHelperProcess,
    GRAPHICS_SELECTOR_ENVIRONMENT,
    HOSTILE_LOADER_ENVIRONMENT,
} from './embedded-mpv-frame-copy.adapter.test-helpers';

/**
 * The Linux side of session creation: probe/playback must share one sanitized
 * loader environment, and a bundled Snap runtime must launch through the
 * graphics provider wrapper with trusted GL roots ahead of generic Snap
 * libraries. General adapter behavior lives in
 * embedded-mpv-frame-copy.adapter.spec.ts.
 */
describe('EmbeddedMpvFrameCopyAdapter Linux loader environment', () => {
    const originalPlatform = process.platform;
    const originalArch = process.arch;
    let child: FakeHelperProcess;
    let adapter: EmbeddedMpvFrameCopyAdapter;

    beforeEach(() => {
        jest.useFakeTimers();
        child = new FakeHelperProcess();
        spawnMock.mockReset();
        spawnMock.mockReturnValue(child);
        Object.defineProperty(process, 'platform', { value: 'linux' });
        Object.defineProperty(process, 'arch', { value: 'x64' });
    });

    afterEach(() => {
        jest.useRealTimers();
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        Object.defineProperty(process, 'arch', { value: originalArch });
    });

    const createSession = () => createFrameCopySession(adapter);

    it('uses a sanitized system environment for the real helper session', () => {
        ({ adapter } = createFrameCopyAdapter('/opt/iptvnator/native/helper', {
            runtimeMode: 'system',
            environment: {
                PATH: '/usr/bin',
                HOME: '/home/user',
                ...HOSTILE_LOADER_ENVIRONMENT,
                ...GRAPHICS_SELECTOR_ENVIRONMENT,
            },
        }));

        createSession();

        expect(spawnMock.mock.calls[0][2]).toEqual({
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                PATH: '/usr/bin',
                HOME: '/home/user',
                ...GRAPHICS_SELECTOR_ENVIRONMENT,
            },
        });
    });

    it('keeps trusted Snap GL roots ahead of generic Snap libraries for playback', () => {
        const snapRoot = '/snap/iptvnator/42';
        const nativeDir = path.join(
            snapRoot,
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        ({ adapter } = createFrameCopyAdapter(path.join(nativeDir, 'helper'), {
            runtimeMode: 'bundled',
            helperLaunchFileSystem: {
                lstatSync: (candidatePath) =>
                    fakeStat(
                        candidatePath.endsWith('/graphics')
                            ? 'directory'
                            : 'file'
                    ) as Stats,
                accessSync: () => undefined,
            },
            environment: {
                PATH: '/snap/bin:/usr/bin',
                SNAP: snapRoot,
                SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl:/tmp/hostile-gl',
                SNAP_DESKTOP_ARCH_TRIPLET: 'hostile-linux-gnu',
                SNAP_DESKTOP_RUNTIME: path.join(snapRoot, 'gnome-platform'),
                GBM_BACKENDS_PATH: '/tmp/hostile-gbm',
                LIBGL_DRIVERS_PATH: '/tmp/hostile-dri',
                LIBVA_DRIVERS_PATH: '/tmp/hostile-va',
                __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                    '/tmp/hostile-egl-platform',
                __EGL_VENDOR_LIBRARY_DIRS: '/tmp/hostile-egl-vendor',
                VK_LAYER_PATH: '/tmp/hostile-vulkan',
                XDG_CONFIG_HOME: '/tmp/hostile-xdg-config-home',
                XDG_CONFIG_DIRS: '/tmp/hostile-xdg-config-dirs',
                XDG_DATA_HOME: '/tmp/hostile-xdg-data-home',
                XDG_DATA_DIRS: '/tmp/hostile-xdg-data-dirs',
                ...HOSTILE_LOADER_ENVIRONMENT,
                ...GRAPHICS_SELECTOR_ENVIRONMENT,
            },
        }));

        createSession();

        expect(spawnMock.mock.calls[0][0]).toBe(
            path.join(
                snapRoot,
                'graphics',
                'bin',
                'graphics-core22-provider-wrapper'
            )
        );
        expect(spawnMock.mock.calls[0][1][0]).toBe(
            path.join(nativeDir, 'helper')
        );
        expect(spawnMock.mock.calls[0][2]).toEqual({
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
                SNAP: snapRoot,
                SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl',
                SNAP_ARCH: 'amd64',
                SNAP_DESKTOP_ARCH_TRIPLET: 'x86_64-linux-gnu',
                SNAP_DESKTOP_RUNTIME: path.join(snapRoot, 'gnome-platform'),
                ...GRAPHICS_SELECTOR_ENVIRONMENT,
                GBM_BACKENDS_PATH: [
                    path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu',
                        'gbm'
                    ),
                    '/var/lib/snapd/lib/gl/gbm',
                ].join(':'),
                LIBGL_DRIVERS_PATH: path.join(
                    snapRoot,
                    'graphics',
                    'usr',
                    'lib',
                    'x86_64-linux-gnu',
                    'dri'
                ),
                LIBVA_DRIVERS_PATH: path.join(
                    snapRoot,
                    'graphics',
                    'usr',
                    'lib',
                    'x86_64-linux-gnu',
                    'dri'
                ),
                __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS: path.join(
                    snapRoot,
                    'graphics',
                    'usr',
                    'share',
                    'egl',
                    'egl_external_platform.d'
                ),
                __EGL_VENDOR_LIBRARY_DIRS: [
                    '/var/lib/snapd/lib/glvnd/egl_vendor.d',
                    path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'share',
                        'glvnd',
                        'egl_vendor.d'
                    ),
                ].join(':'),
                VK_LAYER_PATH: [
                    path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'share',
                        'vulkan',
                        'implicit_layer.d'
                    ),
                    path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'share',
                        'vulkan',
                        'explicit_layer.d'
                    ),
                ].join(':'),
                XDG_CONFIG_HOME: path.join(snapRoot, 'etc', 'xdg'),
                XDG_CONFIG_DIRS: [
                    path.join(snapRoot, 'etc', 'xdg'),
                    '/etc/xdg',
                ].join(':'),
                XDG_DATA_HOME: path.join(snapRoot, 'usr', 'share'),
                XDG_DATA_DIRS: [
                    path.join(snapRoot, 'graphics', 'usr', 'share'),
                    path.join(snapRoot, 'gnome-platform', 'usr', 'share'),
                    path.join(snapRoot, 'usr', 'share'),
                    '/usr/share',
                ].join(':'),
                LD_LIBRARY_PATH: [
                    path.join(nativeDir, 'lib'),
                    '/var/lib/snapd/lib/gl',
                    path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu'
                    ),
                    path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu',
                        'vdpau'
                    ),
                    '/usr/lib/x86_64-linux-gnu',
                    path.join(
                        snapRoot,
                        'gnome-platform',
                        'lib',
                        'x86_64-linux-gnu'
                    ),
                    path.join(
                        snapRoot,
                        'gnome-platform',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu'
                    ),
                    path.join(
                        snapRoot,
                        'gnome-platform',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu',
                        'mesa'
                    ),
                    path.join(
                        snapRoot,
                        'gnome-platform',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu',
                        'mesa-egl'
                    ),
                    path.join(
                        snapRoot,
                        'gnome-platform',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu',
                        'dri'
                    ),
                    path.join(
                        snapRoot,
                        'gnome-platform',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu',
                        'pulseaudio'
                    ),
                    path.join(snapRoot, 'lib'),
                    path.join(snapRoot, 'usr', 'lib'),
                    path.join(snapRoot, 'lib', 'x86_64-linux-gnu'),
                    path.join(snapRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
                ].join(':'),
            },
        });
    });

    it('refuses a Linux session without a validated runtime mode', () => {
        ({ adapter } = createFrameCopyAdapter('/native/helper', {
            runtimeMode: null,
        }));

        expect(() => createSession()).toThrow(
            'validated Linux frame-copy runtime'
        );
        expect(spawnMock).not.toHaveBeenCalled();
    });
});
