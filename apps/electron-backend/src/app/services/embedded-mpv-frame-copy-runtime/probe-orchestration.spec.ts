import {
    accessSync,
    chmodSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'fs';
import path from 'path';
import {
    cloneManifest,
    createFixture,
    writeManifest,
} from './runtime-fixtures.test-helpers';
import {
    createRuntimeTestContext,
    type RuntimeTestContext,
} from './runtime-harness.test-helpers';

describe('embedded-mpv frame-copy runtime probe orchestration', () => {
    let context: RuntimeTestContext;

    beforeEach(() => {
        context = createRuntimeTestContext();
    });

    afterEach(() => {
        context.dispose();
    });

    it('validates a system package, sanitizes loader overrides, and caches by helper/manifest identity', () => {
        const fixture = createFixture(context.rootDir);
        const probeRuntime = context.createProbe({
            env: {
                PATH: '/usr/bin',
                LIBGL_ALWAYS_SOFTWARE: '1',
                GALLIUM_DRIVER: 'llvmpipe',
                BASH_ENV: '/tmp/hostile-bash-env',
                ENV: '/tmp/hostile-shell-env',
                BASHOPTS: 'extdebug',
                SHELLOPTS: 'xtrace',
                PS4: '$(/tmp/hostile-trace-hook)',
                BASH_XTRACEFD: '9',
                CDPATH: '/tmp/hostile-cdpath',
                'BASH_FUNC_dirname%%':
                    '() { printf /tmp/hostile-provider-root; exit 0; }',
                LD_AUDIT: '/tmp/audit.so',
                LD_LIBRARY_PATH: '/ambient/libs',
                LD_ORIGIN_PATH: '/tmp/hostile-origin',
                LD_PRELOAD: '/tmp/inject.so',
                __EGL_VENDOR_LIBRARY_FILENAMES: '/tmp/hostile-egl-vendor.json',
                __EGL_VENDOR_LIBRARY_DIRS: '/tmp/hostile-egl-vendor-dir',
                __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                    '/tmp/hostile-egl-platform',
                __EGL_EXTERNAL_PLATFORM_CONFIG_FILENAMES:
                    '/tmp/hostile-egl-platform.json',
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
                VK_ADD_IMPLICIT_LAYER_PATH:
                    '/tmp/hostile-vulkan-add-implicit-layers',
                VK_LAYER_PATH: '/tmp/hostile-vulkan-layer-path',
            },
        });

        expect(probeRuntime(fixture.helperPath)).toEqual({
            usable: true,
            profile: 'system',
            runtimeMode: 'system',
            libmpv: '2.3',
            renderApi: 'egl',
        });
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);
        expect(context.spawnRuntimeProbe).toHaveBeenCalledTimes(1);
        expect(context.spawnRuntimeProbe).toHaveBeenCalledWith(
            fixture.helperPath,
            ['--runtime-probe'],
            {
                encoding: 'utf8',
                timeout: 3000,
                killSignal: 'SIGKILL',
                windowsHide: true,
                maxBuffer: 16 * 1024 * 1024,
                env: {
                    PATH: '/usr/bin',
                    LIBGL_ALWAYS_SOFTWARE: '1',
                    GALLIUM_DRIVER: 'llvmpipe',
                },
            }
        );
        expect(context.fileSystem.readFileSync).toHaveBeenCalled();
    });

    it('invalidates a cached result when helper or manifest bytes change under identical stats', () => {
        const fixture = createFixture(context.rootDir);
        const fixedStats = new Map([
            [fixture.helperPath, lstatSync(fixture.helperPath)],
            [fixture.manifestPath, lstatSync(fixture.manifestPath)],
        ]);
        context.fileSystem = {
            ...context.fileSystem,
            lstatSync: jest.fn(
                (filePath: string) =>
                    fixedStats.get(filePath) ?? lstatSync(filePath)
            ),
        };
        const probeRuntime = context.createProbe();

        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        const changedHelper = readFileSync(fixture.helperPath);
        changedHelper[0] ^= 0xff;
        writeFileSync(fixture.helperPath, changedHelper);
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        fixture.manifest.generatedAt = '2026-07-18T00:00:00.000Z';
        writeManifest(fixture.manifestPath, fixture.manifest);
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        expect(context.spawnRuntimeProbe).toHaveBeenCalledTimes(3);
    });

    it.each(['portable', 'flatpak'] as const)(
        'validates the exact %s bundled closure and uses only its private library directory',
        (profile) => {
            const fixture = createFixture(context.rootDir, profile);
            const probeRuntime = context.createProbe();

            expect(probeRuntime(fixture.helperPath)).toEqual(
                expect.objectContaining({
                    usable: true,
                    profile,
                    runtimeMode: 'bundled',
                })
            );
            expect(context.spawnRuntimeProbe).toHaveBeenCalledWith(
                fixture.helperPath,
                ['--runtime-probe'],
                expect.objectContaining({
                    env: {
                        PATH: '/usr/bin',
                        LD_LIBRARY_PATH: path.join(fixture.nativeDir, 'lib'),
                    },
                })
            );
        }
    );

    it('runs a packaged Snap probe through the connected graphics provider wrapper', () => {
        const actualSnapRoot = path.join(context.rootDir, 'snap-root');
        const actualFixtureRoot = path.join(actualSnapRoot, 'fixture');
        const fixture = createFixture(actualFixtureRoot, 'portable');
        const actualGraphicsRoot = path.join(actualSnapRoot, 'graphics');
        const actualProviderWrapper = path.join(
            actualGraphicsRoot,
            'bin',
            'graphics-core22-provider-wrapper'
        );
        mkdirSync(path.dirname(actualProviderWrapper), { recursive: true });
        writeFileSync(actualProviderWrapper, '#!/bin/sh\nexec "$@"\n', {
            mode: 0o755,
        });

        const virtualSnapRoot = '/snap/iptvnator/42';
        const linuxTriplet = 'x86_64-linux-gnu';
        const snapLibraries = (...relativePaths: string[]): string[] =>
            relativePaths.map((relativePath) =>
                path.join(virtualSnapRoot, relativePath)
            );
        const virtualNativeDir = path.join(
            virtualSnapRoot,
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        const virtualHelperPath = path.join(
            virtualNativeDir,
            'iptvnator_mpv_helper'
        );
        const virtualGraphicsRoot = path.join(virtualSnapRoot, 'graphics');
        const virtualProviderWrapper = path.join(
            virtualGraphicsRoot,
            'bin',
            'graphics-core22-provider-wrapper'
        );
        const translatePath = (candidatePath: string): string => {
            if (
                candidatePath === virtualNativeDir ||
                candidatePath.startsWith(`${virtualNativeDir}${path.sep}`)
            ) {
                return path.join(
                    fixture.nativeDir,
                    path.relative(virtualNativeDir, candidatePath)
                );
            }
            if (
                candidatePath === virtualGraphicsRoot ||
                candidatePath.startsWith(`${virtualGraphicsRoot}${path.sep}`)
            ) {
                return path.join(
                    actualGraphicsRoot,
                    path.relative(virtualGraphicsRoot, candidatePath)
                );
            }
            return candidatePath;
        };
        const virtualFileSystem = {
            accessSync: jest.fn((candidatePath: string, mode: number) =>
                accessSync(translatePath(candidatePath), mode)
            ),
            lstatSync: jest.fn((candidatePath: string) =>
                lstatSync(translatePath(candidatePath))
            ),
            readFileSync: jest.fn((candidatePath: string) =>
                readFileSync(translatePath(candidatePath))
            ),
            readdirSync: jest.fn((candidatePath: string) =>
                readdirSync(translatePath(candidatePath))
            ),
        };
        const probeRuntime = context.createProbe({
            env: {
                PATH: '/snap/bin:/usr/bin',
                SNAP: virtualSnapRoot,
                SNAP_DESKTOP_RUNTIME: path.join(
                    virtualSnapRoot,
                    'gnome-platform'
                ),
                SNAP_LIBRARY_PATH:
                    '/var/lib/snapd/lib/gl:/var/lib/snapd/lib/gl/nvidia',
            },
            fileSystem: virtualFileSystem,
        });

        expect(probeRuntime(virtualHelperPath)).toEqual(
            expect.objectContaining({
                usable: true,
                profile: 'portable',
                runtimeMode: 'bundled',
            })
        );
        expect(context.spawnRuntimeProbe).toHaveBeenCalledWith(
            virtualProviderWrapper,
            [virtualHelperPath, '--runtime-probe'],
            expect.objectContaining({
                env: expect.objectContaining({
                    SNAP: virtualSnapRoot,
                    LD_LIBRARY_PATH: [
                        path.join(virtualNativeDir, 'lib'),
                        '/var/lib/snapd/lib/gl',
                        '/var/lib/snapd/lib/gl/nvidia',
                        ...snapLibraries(
                            `graphics/usr/lib/${linuxTriplet}`,
                            `graphics/usr/lib/${linuxTriplet}/vdpau`
                        ),
                        '/usr/lib/x86_64-linux-gnu',
                        ...snapLibraries(
                            `gnome-platform/lib/${linuxTriplet}`,
                            `gnome-platform/usr/lib/${linuxTriplet}`,
                            `gnome-platform/usr/lib/${linuxTriplet}/mesa`,
                            `gnome-platform/usr/lib/${linuxTriplet}/mesa-egl`,
                            `gnome-platform/usr/lib/${linuxTriplet}/dri`,
                            `gnome-platform/usr/lib/${linuxTriplet}/pulseaudio`,
                            'lib',
                            'usr/lib',
                            `lib/${linuxTriplet}`,
                            `usr/lib/${linuxTriplet}`
                        ),
                    ].join(':'),
                }),
            })
        );
    });

    it('reports a stable unavailable reason when the Snap graphics provider is disconnected', () => {
        const actualSnapRoot = path.join(context.rootDir, 'snap-root');
        const fixture = createFixture(
            path.join(actualSnapRoot, 'fixture'),
            'portable'
        );
        const actualGraphicsRoot = path.join(actualSnapRoot, 'graphics');
        mkdirSync(actualGraphicsRoot, { recursive: true });

        const virtualSnapRoot = '/snap/iptvnator/42';
        const virtualNativeDir = path.join(
            virtualSnapRoot,
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        const translatePath = (candidatePath: string): string => {
            if (
                candidatePath === virtualNativeDir ||
                candidatePath.startsWith(`${virtualNativeDir}${path.sep}`)
            ) {
                return path.join(
                    fixture.nativeDir,
                    path.relative(virtualNativeDir, candidatePath)
                );
            }
            const virtualGraphicsRoot = path.join(virtualSnapRoot, 'graphics');
            if (
                candidatePath === virtualGraphicsRoot ||
                candidatePath.startsWith(`${virtualGraphicsRoot}${path.sep}`)
            ) {
                return path.join(
                    actualGraphicsRoot,
                    path.relative(virtualGraphicsRoot, candidatePath)
                );
            }
            return candidatePath;
        };
        const probeRuntime = context.createProbe({
            env: { SNAP: virtualSnapRoot },
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

        expect(
            probeRuntime(path.join(virtualNativeDir, 'iptvnator_mpv_helper'))
        ).toEqual({
            usable: false,
            reason: 'snap-graphics-provider-unavailable',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('reprobes when the helper identity changes', () => {
        const fixture = createFixture(context.rootDir);
        const probeRuntime = context.createProbe();
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        writeFileSync(fixture.helperPath, '#!/bin/sh\n# changed\n');
        chmodSync(fixture.helperPath, 0o755);

        expect(probeRuntime(fixture.helperPath).usable).toBe(true);
        expect(context.spawnRuntimeProbe).toHaveBeenCalledTimes(2);
    });

    it('reprobes when the manifest identity changes', () => {
        const fixture = createFixture(context.rootDir);
        const probeRuntime = context.createProbe();
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        const manifest = cloneManifest(fixture.manifest);
        manifest.generatedAt = '2026-07-17T00:01:00.000Z';
        writeManifest(fixture.manifestPath, manifest);

        expect(probeRuntime(fixture.helperPath).usable).toBe(true);
        expect(context.spawnRuntimeProbe).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['linux', 'arm64', 'unsupported-architecture'],
        ['linux', 'arm', 'unsupported-architecture'],
        ['darwin', 'x64', 'unsupported-platform'],
    ] as const)(
        'does not probe unsupported %s/%s runtimes',
        (platform, arch, reason) => {
            const fixture = createFixture(context.rootDir);

            expect(
                context.createProbe({ platform, arch })(fixture.helperPath)
            ).toEqual({
                usable: false,
                reason,
            });
            expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
        }
    );
});
