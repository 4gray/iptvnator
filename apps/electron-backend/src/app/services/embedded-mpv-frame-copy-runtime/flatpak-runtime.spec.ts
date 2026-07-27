import { accessSync, lstatSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { createLinuxFrameCopyHelperEnvironment } from '../embedded-mpv-frame-copy-runtime';
import { createFixture } from './runtime-fixtures.test-helpers';
import {
    createRuntimeTestContext,
    type RuntimeTestContext,
} from './runtime-harness.test-helpers';

const FLATPAK_NATIVE_DIR =
    '/app/iptvnator/resources/app.asar.unpacked/electron-backend/native';
const FREEDESKTOP_EGL_EXTERNAL_PLATFORM_CONFIG_DIRS = [
    '/etc/egl/egl_external_platform.d',
    '/usr/lib/x86_64-linux-gnu/GL/egl/egl_external_platform.d',
    '/usr/share/egl/egl_external_platform.d',
].join(':');

describe('Flatpak embedded MPV frame-copy runtime', () => {
    it('reconstructs the immutable Freedesktop GL metadata inside the packaged app', () => {
        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/app/bin:/usr/bin',
                    FLATPAK_ID: 'com.fourgray.iptvnator',
                    __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                        '/tmp/hostile-egl-platform',
                    __EGL_EXTERNAL_PLATFORM_CONFIG_FILENAMES:
                        '/tmp/hostile-egl-platform.json',
                    GBM_BACKENDS_PATH: '/tmp/hostile-gbm',
                    LIBGL_DRIVERS_PATH: '/tmp/hostile-dri',
                    LIBVA_DRIVERS_PATH: '/tmp/hostile-va',
                    __EGL_VENDOR_LIBRARY_DIRS: '/tmp/hostile-egl-vendor',
                    VK_LAYER_PATH: '/tmp/hostile-vulkan',
                },
                FLATPAK_NATIVE_DIR,
                'bundled'
            )
        ).toEqual({
            PATH: '/app/bin:/usr/bin',
            FLATPAK_ID: 'com.fourgray.iptvnator',
            __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                FREEDESKTOP_EGL_EXTERNAL_PLATFORM_CONFIG_DIRS,
            LD_LIBRARY_PATH: path.join(FLATPAK_NATIVE_DIR, 'lib'),
        });
    });

    it.each([
        ['wrong app id', 'com.example.other', '/app/iptvnator/native'],
        [
            'helper outside /app',
            'com.fourgray.iptvnator',
            '/opt/iptvnator/native',
        ],
    ])(
        'does not reconstruct Flatpak GL metadata for %s',
        (_label, flatpakId, nativeDir) => {
            expect(
                createLinuxFrameCopyHelperEnvironment(
                    {
                        FLATPAK_ID: flatpakId,
                        __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                            '/tmp/hostile-egl-platform',
                    },
                    nativeDir,
                    'bundled'
                )
            ).toEqual({
                FLATPAK_ID: flatpakId,
                LD_LIBRARY_PATH: path.join(nativeDir, 'lib'),
            });
        }
    );

    describe('packaged capability probe', () => {
        let context: RuntimeTestContext;

        beforeEach(() => {
            context = createRuntimeTestContext();
        });

        afterEach(() => {
            context.dispose();
        });

        it('uses reconstructed Freedesktop GL metadata through the application gate', () => {
            const fixture = createFixture(context.rootDir, 'flatpak');
            const virtualHelperPath = path.join(
                FLATPAK_NATIVE_DIR,
                'iptvnator_mpv_helper'
            );
            const translatePath = (candidatePath: string): string => {
                if (
                    candidatePath === FLATPAK_NATIVE_DIR ||
                    candidatePath.startsWith(`${FLATPAK_NATIVE_DIR}${path.sep}`)
                ) {
                    return path.join(
                        fixture.nativeDir,
                        path.relative(FLATPAK_NATIVE_DIR, candidatePath)
                    );
                }
                return candidatePath;
            };
            const probeRuntime = context.createProbe({
                env: {
                    PATH: '/app/bin:/usr/bin',
                    FLATPAK_ID: 'com.fourgray.iptvnator',
                    __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                        '/tmp/hostile-egl-platform',
                    __EGL_EXTERNAL_PLATFORM_CONFIG_FILENAMES:
                        '/tmp/hostile-egl-platform.json',
                    GBM_BACKENDS_PATH: '/tmp/hostile-gbm',
                    LIBGL_DRIVERS_PATH: '/tmp/hostile-dri',
                },
                fileSystem: {
                    accessSync: (candidatePath, mode) =>
                        accessSync(translatePath(candidatePath), mode),
                    lstatSync: (candidatePath) =>
                        lstatSync(translatePath(candidatePath)),
                    readFileSync: (candidatePath) =>
                        readFileSync(translatePath(candidatePath)),
                    readdirSync: (candidatePath) =>
                        readdirSync(translatePath(candidatePath)),
                },
            });

            expect(probeRuntime(virtualHelperPath)).toEqual(
                expect.objectContaining({
                    usable: true,
                    profile: 'flatpak',
                    runtimeMode: 'bundled',
                })
            );
            expect(context.spawnRuntimeProbe).toHaveBeenCalledWith(
                virtualHelperPath,
                ['--runtime-probe'],
                expect.objectContaining({
                    env: {
                        PATH: '/app/bin:/usr/bin',
                        FLATPAK_ID: 'com.fourgray.iptvnator',
                        __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                            FREEDESKTOP_EGL_EXTERNAL_PLATFORM_CONFIG_DIRS,
                        LD_LIBRARY_PATH: path.join(FLATPAK_NATIVE_DIR, 'lib'),
                    },
                })
            );
        });
    });
});
