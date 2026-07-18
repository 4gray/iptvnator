import path from 'path';
import { createLinuxFrameCopyHelperEnvironment } from '../embedded-mpv-frame-copy-runtime';

const HOSTILE_LOADER_ENVIRONMENT = {
    BASH_ENV: '/tmp/hostile-bash-env',
    ENV: '/tmp/hostile-shell-env',
    BASHOPTS: 'extdebug',
    SHELLOPTS: 'xtrace',
    PS4: '$(/tmp/hostile-trace-hook)',
    BASH_XTRACEFD: '9',
    CDPATH: '/tmp/hostile-cdpath',
    'BASH_FUNC_dirname%%': '() { printf /tmp/hostile-provider-root; exit 0; }',
    LD_AUDIT: '/tmp/audit.so',
    LD_LIBRARY_PATH: '/tmp/hostile-libs',
    LD_ORIGIN_PATH: '/tmp/hostile-origin',
    LD_PRELOAD: '/tmp/inject.so',
    __EGL_VENDOR_LIBRARY_FILENAMES: '/tmp/hostile-egl-vendor.json',
    __EGL_VENDOR_LIBRARY_DIRS: '/tmp/hostile-egl-vendor-dir',
    __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS: '/tmp/hostile-egl-platform',
    __EGL_EXTERNAL_PLATFORM_CONFIG_FILENAMES: '/tmp/hostile-egl-platform.json',
    GBM_BACKEND: '../../../../../tmp/hostile-gbm',
    GBM_BACKENDS_PATH: '/tmp/hostile-gbm-path',
    LIBGL_DRIVERS_PATH: '/tmp/hostile-dri-path',
    MESA_LOADER_DRIVER_OVERRIDE: '../../../../../tmp/hostile-dri',
    LIBVA_DRIVER_NAME: '../../../../../tmp/hostile-va',
    LIBVA_DRIVERS_PATH: '/tmp/hostile-va-path',
    VDPAU_DRIVER_PATH: '/tmp/hostile-vdpau',
    VK_DRIVER_FILES: '/tmp/hostile-vulkan-driver.json',
    VK_ICD_FILENAMES: '/tmp/hostile-vulkan-icd.json',
    VK_ADD_DRIVER_FILES: '/tmp/hostile-vulkan-add-driver.json',
    VK_ADD_LAYER_PATH: '/tmp/hostile-vulkan-layers',
    VK_IMPLICIT_LAYER_PATH: '/tmp/hostile-vulkan-implicit-layers',
    VK_ADD_IMPLICIT_LAYER_PATH: '/tmp/hostile-vulkan-add-implicit-layers',
    VK_LAYER_PATH: '/tmp/hostile-vulkan-layer-path',
} as const;

const GRAPHICS_SELECTOR_ENVIRONMENT = {
    LIBGL_ALWAYS_SOFTWARE: '1',
    EGL_PLATFORM: 'x11',
    DRI_PRIME: '1',
    GALLIUM_DRIVER: 'llvmpipe',
    VDPAU_DRIVER: 'mesa',
    __GLX_VENDOR_LIBRARY_NAME: 'mesa',
    __GLX_FORCE_VENDOR_LIBRARY_0: 'mesa',
    VK_INSTANCE_LAYERS: 'VK_LAYER_MESA_overlay',
    VK_LOADER_DRIVERS_SELECT: '*mesa*',
} as const;

describe('createLinuxFrameCopyHelperEnvironment', () => {
    it('removes ambient loader overrides for system packages', () => {
        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/usr/bin',
                    HOME: '/home/user',
                    ...HOSTILE_LOADER_ENVIRONMENT,
                },
                '/opt/iptvnator/native',
                'system'
            )
        ).toEqual({
            PATH: '/usr/bin',
            HOME: '/home/user',
        });
    });

    it('preserves graphics feature and debug selectors', () => {
        expect(
            createLinuxFrameCopyHelperEnvironment(
                GRAPHICS_SELECTOR_ENVIRONMENT,
                '/opt/iptvnator/native',
                'system'
            )
        ).toEqual(GRAPHICS_SELECTOR_ENVIRONMENT);
    });

    it('keeps trusted Snap GL roots ahead of generic Snap libraries', () => {
        const snapRoot = '/snap/iptvnator/42';
        const nativeDir = path.join(
            snapRoot,
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );

        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/snap/bin:/usr/bin',
                    SNAP: snapRoot,
                    SNAP_LIBRARY_PATH: [
                        '/var/lib/snapd/lib/gl',
                        '/tmp/hostile-gl',
                        '/var/lib/snapd/lib/gl/nvidia',
                        '/var/lib/snapd/lib/gl-evil',
                    ].join(':'),
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
                nativeDir,
                'bundled'
            )
        ).toEqual({
            PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
            SNAP: snapRoot,
            SNAP_LIBRARY_PATH: [
                '/var/lib/snapd/lib/gl',
                '/var/lib/snapd/lib/gl/nvidia',
            ].join(':'),
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
                '/var/lib/snapd/lib/gl/nvidia',
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
        });
    });

    it.each([
        '/tmp/gnome-platform',
        '/snap/iptvnator/42/gnome-platform-evil',
        'gnome-platform',
    ])(
        'ignores an untrusted Snap desktop runtime declaration: %s',
        (declaredDesktopRuntime) => {
            const snapRoot = '/snap/iptvnator/42';
            const nativeDir = path.join(
                snapRoot,
                'resources',
                'app.asar.unpacked',
                'electron-backend',
                'native'
            );

            const helperEnvironment = createLinuxFrameCopyHelperEnvironment(
                {
                    SNAP: snapRoot,
                    SNAP_DESKTOP_ARCH_TRIPLET: 'hostile-linux-gnu',
                    SNAP_DESKTOP_RUNTIME: declaredDesktopRuntime,
                    GBM_BACKENDS_PATH: '/tmp/hostile-gbm',
                    LIBGL_DRIVERS_PATH: '/tmp/hostile-dri',
                    LIBVA_DRIVERS_PATH: '/tmp/hostile-va',
                    __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                        '/tmp/hostile-egl-platform',
                    __EGL_VENDOR_LIBRARY_DIRS: '/tmp/hostile-egl-vendor',
                    VK_LAYER_PATH: '/tmp/hostile-vulkan',
                    LD_LIBRARY_PATH: '/tmp/hostile-libs',
                },
                nativeDir,
                'bundled'
            );

            expect(helperEnvironment.LD_LIBRARY_PATH?.split(':')).toEqual([
                path.join(nativeDir, 'lib'),
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
                path.join(snapRoot, 'lib'),
                path.join(snapRoot, 'usr', 'lib'),
                path.join(snapRoot, 'lib', 'x86_64-linux-gnu'),
                path.join(snapRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
            ]);
            expect(helperEnvironment.LD_LIBRARY_PATH).not.toContain(
                declaredDesktopRuntime
            );
            expect(helperEnvironment.LD_LIBRARY_PATH).not.toContain(
                'hostile-linux-gnu'
            );
            expect(helperEnvironment.SNAP_DESKTOP_RUNTIME).toBeUndefined();
            expect(helperEnvironment.SNAP_DESKTOP_ARCH_TRIPLET).toBe(
                'x86_64-linux-gnu'
            );
            expect(helperEnvironment.SNAP_ARCH).toBe('amd64');
        }
    );

    it('does not trust Snap loader paths when nativeDir is outside the declared mount', () => {
        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/usr/bin',
                    SNAP: '/snap/iptvnator/42',
                    SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl:/tmp/hostile-gl',
                    LD_AUDIT: '/tmp/audit.so',
                    LD_LIBRARY_PATH: '/tmp/hostile-libs',
                    LD_PRELOAD: '/tmp/inject.so',
                },
                '/opt/iptvnator/native',
                'bundled'
            )
        ).toEqual({
            PATH: '/usr/bin',
            SNAP: '/snap/iptvnator/42',
            SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl:/tmp/hostile-gl',
            LD_LIBRARY_PATH: '/opt/iptvnator/native/lib',
        });
    });
});
