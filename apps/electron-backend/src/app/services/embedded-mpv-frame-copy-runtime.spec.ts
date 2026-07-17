import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import {
    accessSync,
    chmodSync,
    constants as fsConstants,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
    createLinuxFrameCopyHelperEnvironment,
    createEmbeddedMpvFrameCopyRuntimeProbe,
    EmbeddedMpvFrameCopyRuntimeDependencies,
} from './embedded-mpv-frame-copy-runtime';

const SUCCESS_OUTPUT =
    '{"protocol":1,"usable":true,"libmpv":"2.3","renderApi":"egl"}\n';

const EXTERNAL_SYSTEM_LIBRARIES = [
    {
        name: 'libEGL.so.1',
        interface: 'EGL',
        reason: 'System graphics-driver interface used by the frame-copy helper.',
    },
    {
        name: 'libGL.so.1',
        interface: 'OpenGL',
        reason: 'System OpenGL compatibility interface supplied by the graphics stack.',
    },
    {
        name: 'libGLX.so.0',
        interface: 'OpenGL',
        reason: 'GLVND OpenGL dispatch interface supplied by the graphics stack.',
    },
    {
        name: 'libOpenGL.so.0',
        interface: 'OpenGL',
        reason: 'GLVND OpenGL interface supplied by the graphics stack.',
    },
    {
        name: 'libasound.so.2',
        interface: 'ALSA',
        reason: 'Linux system audio interface intentionally used by libmpv.',
    },
    {
        name: 'libdrm.so.2',
        interface: 'DRM',
        reason: 'Kernel graphics interface used by system GBM and VA-API drivers.',
    },
    {
        name: 'libgbm.so.1',
        interface: 'GBM',
        reason: 'System graphics-buffer interface used by headless EGL rendering.',
    },
    {
        name: 'libpulse.so.0',
        interface: 'PulseAudio',
        reason: 'Linux desktop audio interface intentionally used by libmpv.',
    },
    {
        name: 'libva-drm.so.2',
        interface: 'VA-API DRM',
        reason: 'System VA-API DRM interface used for hardware decoding.',
    },
    {
        name: 'libva.so.2',
        interface: 'VA-API',
        reason: 'System video-acceleration interface used for hardware decoding.',
    },
];

const PINNED_SOURCE_PACKAGE_IDENTITIES = {
    freetype: {
        version: '2.13.3',
        sourceUrl:
            'https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz',
        sourceSha256:
            '0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289',
        license: 'FreeType License (FTL)',
    },
    fribidi: {
        version: '1.0.16',
        sourceUrl:
            'https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz',
        sourceSha256:
            '1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c',
        license: 'LGPL-2.1-or-later',
    },
    harfbuzz: {
        version: '8.5.0',
        sourceUrl:
            'https://github.com/harfbuzz/harfbuzz/releases/download/8.5.0/harfbuzz-8.5.0.tar.xz',
        sourceSha256:
            '77e4f7f98f3d86bf8788b53e6832fb96279956e1c3961988ea3d4b7ca41ddc27',
        license: 'MIT',
    },
    expat: {
        version: '2.8.2',
        sourceUrl:
            'https://github.com/libexpat/libexpat/releases/download/R_2_8_2/expat-2.8.2.tar.xz',
        sourceSha256:
            '3ad89b8588e6644bd4e49981480d48b21289eebbcd4f0a1a4afb1c29f99b6ab4',
        license: 'MIT',
    },
    fontconfig: {
        version: '2.16.0',
        sourceUrl:
            'https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.16.0.tar.xz',
        sourceSha256:
            '6a33dc555cc9ba8b10caf7695878ef134eeb36d0af366041f639b1da9b6ed220',
        license: 'MIT',
    },
    libass: {
        version: '0.17.3',
        sourceUrl:
            'https://github.com/libass/libass/releases/download/0.17.3/libass-0.17.3.tar.xz',
        sourceSha256:
            'eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959',
        license: 'ISC',
    },
    openssl: {
        version: '3.5.7',
        sourceUrl:
            'https://github.com/openssl/openssl/releases/download/openssl-3.5.7/openssl-3.5.7.tar.gz',
        sourceSha256:
            'a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8',
        license: 'Apache-2.0',
    },
    ffmpeg: {
        version: '8.1',
        sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz',
        sourceSha256:
            'b072aed6871998cce9b36e7774033105ca29e33632be5b6347f3206898e0756a',
        license: 'LGPL-2.1-or-later',
    },
    libplacebo: {
        version: '7.360.1',
        sourceUrl: 'https://github.com/haasn/libplacebo.git',
        sourceTag: 'v7.360.1',
        sourceGitCommit: 'cee9b076f2c63104ccfd497fa79c39a867293ec4',
        license: 'LGPL-2.1-or-later',
    },
    hwdata: {
        version: '0.409',
        sourceUrl:
            'https://github.com/vcrhonek/hwdata/archive/refs/tags/v0.409.tar.gz',
        sourceSha256:
            '23006accc0f931dd5187d0307a57d0744e2b8feb85e73c37bc0f5229fb31eadd',
        buildInput: {
            consumer: 'libdisplay-info',
            relativePath: 'pnp.ids',
            purpose: 'PNP vendor lookup table compiled into libdisplay-info.',
        },
        license: 'GPL-2.0-or-later OR XFree86-1.0',
    },
    'libdisplay-info': {
        version: '0.1.1',
        sourceUrl:
            'https://gitlab.freedesktop.org/emersion/libdisplay-info/-/releases/0.1.1/downloads/libdisplay-info-0.1.1.tar.xz',
        sourceSha256:
            '0d8731588e9f82a9cac96324a3d7c82e2ba5b1b5e006143fefe692c74069fb60',
        license: 'MIT',
    },
    mpv: {
        version: '0.41.0',
        sourceUrl:
            'https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz',
        sourceSha256:
            'ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209',
        license: 'LGPL-2.1-or-later with -Dgpl=false',
    },
};

interface RuntimeFile {
    name: string;
    size: number;
    sha256: string;
}

interface RuntimeFixture {
    nativeDir: string;
    helperPath: string;
    manifestPath: string;
    manifest: Record<string, unknown>;
    runtimeContents: Record<string, Buffer>;
}

function sha256(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

function createRuntimeFiles(
    runtimeContents: Record<string, Buffer>
): RuntimeFile[] {
    return Object.entries(runtimeContents)
        .map(([name, contents]) => ({
            name,
            size: contents.length,
            sha256: sha256(contents),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

function createSourceRuntime(
    runtimeFiles: RuntimeFile[],
    runtimeDependencyClosure: Record<string, unknown>
): Record<string, unknown> {
    const packages = cloneManifest(PINNED_SOURCE_PACKAGE_IDENTITIES);
    (
        packages.libplacebo as typeof packages.libplacebo & {
            sourceSubmodules: string[];
        }
    ).sourceSubmodules = [`${'a'.repeat(40)} 3rdparty/example`];
    return {
        schemaVersion: 1,
        origin: 'vendored-lgpl-source-build',
        platform: 'linux',
        arch: 'x64',
        packages,
        ffmpeg: {
            ...(packages.ffmpeg as Record<string, unknown>),
            configureFlags: ['--disable-gpl', '--disable-nonfree'],
        },
        mpv: {
            ...(packages.mpv as Record<string, unknown>),
            mesonFlags: ['-Dgpl=false', '-Dlibmpv=true'],
        },
        sourceDistribution:
            'Publish the exact hwdata archive and pnp.ids with the libdisplay-info source.',
        runtimeFiles,
        runtimeTotalBytes: runtimeFiles.reduce(
            (total, runtimeFile) => total + runtimeFile.size,
            0
        ),
        runtimeAbi: {
            baseline: {
                distribution: 'Ubuntu 22.04',
                glibcMaximum: '2.35',
                glibcxxMaximum: '3.4.30',
            },
            files: runtimeFiles.map(({ name }) => ({
                name,
                requiredGlibc: '2.34',
                requiredGlibcxx: null,
            })),
        },
        runtimeDependencyClosure,
        externalSystemLibraries: cloneManifest(EXTERNAL_SYSTEM_LIBRARIES),
    };
}

function createFixture(
    rootDir: string,
    profile: 'system' | 'portable' | 'flatpak' = 'system'
): RuntimeFixture {
    const nativeDir = path.join(rootDir, profile, 'native');
    const helperPath = path.join(nativeDir, 'iptvnator_mpv_helper');
    const manifestPath = path.join(nativeDir, 'embedded-mpv-runtime.json');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(path.join(nativeDir, 'embedded_mpv.node'), 'addon', {
        mode: 0o644,
    });
    writeFileSync(
        path.join(nativeDir, 'embedded_mpv_frame_reader.node'),
        'reader',
        { mode: 0o644 }
    );
    writeFileSync(helperPath, '#!/bin/sh\n', { mode: 0o755 });

    const bundled = profile !== 'system';
    const runtimeContents = bundled
        ? {
              'libmpv.so': Buffer.from('libmpv-linker-alias'),
              'libmpv.so.2': Buffer.from('libmpv-soname'),
          }
        : {};
    const runtimeFiles = createRuntimeFiles(runtimeContents);
    const runtimeDependencyClosure = {
        entries: runtimeFiles.map(({ name }) => ({
            name,
            soname: name === 'libmpv.so' ? 'libmpv.so.2' : name,
            needed: [],
            rpath: [],
            runpath: ['$ORIGIN'],
        })),
        externalDependencies: [],
    };
    const externalSystemLibraries = cloneManifest(EXTERNAL_SYSTEM_LIBRARIES);
    const sourceRuntime = createSourceRuntime(
        runtimeFiles,
        runtimeDependencyClosure
    );
    const manifest: Record<string, unknown> = {
        schemaVersion: 1,
        origin: bundled
            ? 'bundled-lgpl-frame-copy'
            : 'system-libmpv-frame-copy',
        generatedAt: '2026-07-17T00:00:00.000Z',
        platform: 'linux',
        arch: 'x64',
        profile,
        runtimeMode: bundled ? 'bundled' : 'system',
        targets:
            profile === 'system'
                ? ['deb', 'pacman', 'rpm']
                : profile === 'portable'
                  ? ['appimage', 'snap']
                  : ['flatpak'],
        artifacts: {
            addon: {
                name: 'embedded_mpv.node',
                regularFile: true,
                readable: true,
            },
            frameReader: {
                name: 'embedded_mpv_frame_reader.node',
                regularFile: true,
                readable: true,
            },
            helper: {
                name: 'iptvnator_mpv_helper',
                regularFile: true,
                readable: true,
                executable: true,
            },
        },
        processIsolation: {
            addonLoadsLibmpv: false,
            readerLoadsLibmpv: false,
            electronLoadsLibmpv: false,
            helperLinksLibmpv: true,
            helperRunpath: ['$ORIGIN/lib'],
        },
        nativeViewFallback: 'process-isolated mpv --wid',
        libmpvSoname: 'libmpv.so.2',
        packageDependencies: bundled
            ? {}
            : {
                  deb: 'libmpv2',
                  rpm: 'mpv-libs',
                  pacman: 'mpv',
              },
        runtimeFiles,
        runtimeTotalBytes: runtimeFiles.reduce(
            (total, runtimeFile) => total + runtimeFile.size,
            0
        ),
        ...(bundled
            ? {
                  runtimeDependencyClosure,
                  externalSystemLibraries,
                  sourceRuntime,
              }
            : {}),
    };
    writeManifest(manifestPath, manifest);
    if (bundled) {
        const libDir = path.join(nativeDir, 'lib');
        mkdirSync(libDir);
        for (const [name, contents] of Object.entries(runtimeContents)) {
            writeFileSync(path.join(libDir, name), contents, {
                mode: 0o644,
            });
        }
    }
    return {
        nativeDir,
        helperPath,
        manifestPath,
        manifest,
        runtimeContents,
    };
}

function createDevelopmentFixture(
    rootDir: string,
    buildInputMode: 'system-dev' | 'system-build-inputs' | 'bundled-runtime'
): RuntimeFixture {
    const bundled = buildInputMode === 'bundled-runtime';
    const fixture = createFixture(rootDir, bundled ? 'portable' : 'system');
    const packagedSourceRuntime = fixture.manifest.sourceRuntime;
    const sourceRuntime =
        buildInputMode === 'system-dev'
            ? {
                  linuxBackend: 'process-isolated mpv --wid',
                  warning:
                      'Development-only unmanaged system libmpv toolchain.',
              }
            : buildInputMode === 'system-build-inputs'
              ? {
                    linuxBackend: 'process-isolated mpv --wid',
                    buildInputs: {
                        libmpvDevPackage: 'libmpv-dev',
                        mpvPackage: 'mpv',
                    },
                    sourceDistribution:
                        'Linux development inputs are supplied by the host package manager.',
                }
              : packagedSourceRuntime;
    const manifest: Record<string, unknown> = {
        schemaVersion: 1,
        origin: 'linux-frame-copy-build',
        generatedAt: '2026-07-17T00:00:00.000Z',
        platform: 'linux',
        arch: 'x64',
        buildInputMode,
        sourceRuntimeValidated: bundled,
        allowedPackageRuntimeModes: ['system', 'bundled'],
        packageRuntimeAvailability: {
            system: bundled,
            bundled,
        },
        artifacts: {
            addon: 'embedded_mpv.node',
            frameReader: 'embedded_mpv_frame_reader.node',
            helper: 'iptvnator_mpv_helper',
        },
        processIsolation: {
            addonLoadsLibmpv: false,
            helperLinksLibmpv: true,
            helperRunpath: ['$ORIGIN/lib'],
        },
        nativeViewFallback: 'process-isolated mpv --wid',
        libmpvSoname: bundled ? 'libmpv.so.2' : null,
        runtimeFiles: fixture.manifest.runtimeFiles,
        runtimeTotalBytes: fixture.manifest.runtimeTotalBytes,
        sourceRuntime,
    };
    fixture.manifest = manifest;
    writeManifest(fixture.manifestPath, manifest);
    return fixture;
}

function probeDevelopmentRuntime(
    probeRuntime: ReturnType<typeof createEmbeddedMpvFrameCopyRuntimeProbe>,
    helperPath: string
) {
    return (
        probeRuntime as unknown as (
            path: string,
            contract: 'development'
        ) => ReturnType<typeof probeRuntime>
    )(helperPath, 'development');
}

function mirrorBundledManifestFields(manifest: Record<string, unknown>): void {
    const sourceRuntime = manifest.sourceRuntime as Record<string, unknown>;
    sourceRuntime.runtimeFiles = cloneManifest(manifest.runtimeFiles);
    sourceRuntime.runtimeTotalBytes = manifest.runtimeTotalBytes;
    sourceRuntime.runtimeDependencyClosure = cloneManifest(
        manifest.runtimeDependencyClosure
    );
    sourceRuntime.externalSystemLibraries = cloneManifest(
        manifest.externalSystemLibraries
    );
}

function writeManifest(
    manifestPath: string,
    manifest: Record<string, unknown>
): void {
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, {
        mode: 0o644,
    });
    chmodSync(manifestPath, 0o644);
}

function cloneManifest<T>(manifest: T): T {
    return JSON.parse(JSON.stringify(manifest)) as T;
}

describe('createLinuxFrameCopyHelperEnvironment', () => {
    it('removes ambient loader overrides for system packages', () => {
        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/usr/bin',
                    HOME: '/home/user',
                    LD_LIBRARY_PATH: '/tmp/hostile-libs',
                    LD_PRELOAD: '/tmp/inject.so',
                },
                '/opt/iptvnator/native',
                'system'
            )
        ).toEqual({
            PATH: '/usr/bin',
            HOME: '/home/user',
        });
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
                    LD_LIBRARY_PATH: '/tmp/hostile-libs',
                    LD_PRELOAD: '/tmp/inject.so',
                },
                nativeDir,
                'bundled'
            )
        ).toEqual({
            PATH: '/snap/bin:/usr/bin',
            SNAP: snapRoot,
            SNAP_LIBRARY_PATH: [
                '/var/lib/snapd/lib/gl',
                '/tmp/hostile-gl',
                '/var/lib/snapd/lib/gl/nvidia',
                '/var/lib/snapd/lib/gl-evil',
            ].join(':'),
            LD_LIBRARY_PATH: [
                path.join(nativeDir, 'lib'),
                '/var/lib/snapd/lib/gl',
                '/var/lib/snapd/lib/gl/nvidia',
                path.join(snapRoot, 'lib'),
                path.join(snapRoot, 'usr', 'lib'),
                path.join(snapRoot, 'lib', 'x86_64-linux-gnu'),
                path.join(snapRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
            ].join(':'),
        });
    });

    it('does not trust Snap loader paths when nativeDir is outside the declared mount', () => {
        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/usr/bin',
                    SNAP: '/snap/iptvnator/42',
                    SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl:/tmp/hostile-gl',
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

describe('embedded-mpv-frame-copy-runtime', () => {
    let rootDir: string;
    let spawnRuntimeProbe: jest.Mock;
    let fileSystem: EmbeddedMpvFrameCopyRuntimeDependencies['fileSystem'];

    beforeEach(() => {
        rootDir = mkdtempSync(path.join(tmpdir(), 'iptvnator-fc-runtime-'));
        spawnRuntimeProbe = jest.fn(() => ({
            status: 0,
            signal: null,
            stdout: SUCCESS_OUTPUT,
            stderr: '',
        }));
        fileSystem = {
            accessSync: jest.fn((filePath: string, mode: number) =>
                accessSync(filePath, mode)
            ),
            lstatSync: jest.fn((filePath: string) => lstatSync(filePath)),
            readFileSync: jest.fn((filePath: string) => readFileSync(filePath)),
            readdirSync: jest.fn((filePath: string) => readdirSync(filePath)),
        };
    });

    afterEach(() => {
        rmSync(rootDir, { recursive: true, force: true });
    });

    function createProbe(
        overrides: Partial<EmbeddedMpvFrameCopyRuntimeDependencies> = {}
    ) {
        return createEmbeddedMpvFrameCopyRuntimeProbe({
            platform: 'linux',
            arch: 'x64',
            env: {
                PATH: '/usr/bin',
                LD_LIBRARY_PATH: '/ambient/libs',
                LD_PRELOAD: '/tmp/inject.so',
            },
            fileSystem,
            spawnSync: spawnRuntimeProbe as typeof spawnSync,
            ...overrides,
        });
    }

    it('validates a system package, sanitizes loader overrides, and caches by helper/manifest identity', () => {
        const fixture = createFixture(rootDir);
        const probeRuntime = createProbe();

        expect(probeRuntime(fixture.helperPath)).toEqual({
            usable: true,
            profile: 'system',
            runtimeMode: 'system',
            libmpv: '2.3',
            renderApi: 'egl',
        });
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);
        expect(spawnRuntimeProbe).toHaveBeenCalledTimes(1);
        expect(spawnRuntimeProbe).toHaveBeenCalledWith(
            fixture.helperPath,
            ['--runtime-probe'],
            {
                encoding: 'utf8',
                timeout: 3000,
                killSignal: 'SIGKILL',
                windowsHide: true,
                env: {
                    PATH: '/usr/bin',
                },
            }
        );
        expect(fileSystem?.readFileSync).toHaveBeenCalled();
    });

    it.each(['portable', 'flatpak'] as const)(
        'validates the exact %s bundled closure and uses only its private library directory',
        (profile) => {
            const fixture = createFixture(rootDir, profile);
            const probeRuntime = createProbe();

            expect(probeRuntime(fixture.helperPath)).toEqual(
                expect.objectContaining({
                    usable: true,
                    profile,
                    runtimeMode: 'bundled',
                })
            );
            expect(spawnRuntimeProbe).toHaveBeenCalledWith(
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

    it.each(['system-dev', 'system-build-inputs', 'bundled-runtime'] as const)(
        'accepts an exact unpackaged %s build manifest and still runs the helper probe',
        (buildInputMode) => {
            const fixture = createDevelopmentFixture(rootDir, buildInputMode);

            expect(
                probeDevelopmentRuntime(createProbe(), fixture.helperPath)
            ).toEqual(
                expect.objectContaining({
                    usable: true,
                    runtimeMode:
                        buildInputMode === 'bundled-runtime'
                            ? 'bundled'
                            : 'system',
                })
            );
            expect(spawnRuntimeProbe).toHaveBeenCalledWith(
                fixture.helperPath,
                ['--runtime-probe'],
                expect.objectContaining({
                    env:
                        buildInputMode === 'bundled-runtime'
                            ? {
                                  PATH: '/usr/bin',
                                  LD_LIBRARY_PATH: path.join(
                                      fixture.nativeDir,
                                      'lib'
                                  ),
                              }
                            : {
                                  PATH: '/usr/bin',
                              },
                })
            );
        }
    );

    it('keeps the packaged manifest contract strict when a development manifest is present', () => {
        const fixture = createDevelopmentFixture(rootDir, 'bundled-runtime');

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it.each([
        {
            label: 'origin',
            mutate(manifest: Record<string, unknown>) {
                manifest.origin = 'system-libmpv-frame-copy';
            },
        },
        {
            label: 'architecture',
            mutate(manifest: Record<string, unknown>) {
                manifest.arch = 'arm64';
            },
        },
        {
            label: 'artifact set',
            mutate(manifest: Record<string, unknown>) {
                const artifacts = manifest.artifacts as Record<string, unknown>;
                artifacts.helper = 'other-helper';
            },
        },
        {
            label: 'package availability',
            mutate(manifest: Record<string, unknown>) {
                manifest.packageRuntimeAvailability = {
                    system: true,
                    bundled: false,
                };
            },
        },
        {
            label: 'unexpected field',
            mutate(manifest: Record<string, unknown>) {
                manifest.manifestContract = 'packaged';
            },
        },
    ])(
        'rejects a development manifest with an invalid $label',
        ({ mutate }) => {
            const fixture = createDevelopmentFixture(rootDir, 'system-dev');
            const manifest = cloneManifest(fixture.manifest);
            mutate(manifest);
            writeManifest(fixture.manifestPath, manifest);

            expect(
                probeDevelopmentRuntime(createProbe(), fixture.helperPath)
            ).toEqual({
                usable: false,
                reason: 'runtime-manifest-invalid',
            });
            expect(spawnRuntimeProbe).not.toHaveBeenCalled();
        }
    );

    it('rejects a system development manifest with a private runtime directory', () => {
        const fixture = createDevelopmentFixture(rootDir, 'system-dev');
        mkdirSync(path.join(fixture.nativeDir, 'lib'));

        expect(
            probeDevelopmentRuntime(createProbe(), fixture.helperPath)
        ).toEqual({
            usable: false,
            reason: 'runtime-library-directory-invalid',
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('reprobes when the helper identity changes', () => {
        const fixture = createFixture(rootDir);
        const probeRuntime = createProbe();
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        writeFileSync(fixture.helperPath, '#!/bin/sh\n# changed\n');
        chmodSync(fixture.helperPath, 0o755);

        expect(probeRuntime(fixture.helperPath).usable).toBe(true);
        expect(spawnRuntimeProbe).toHaveBeenCalledTimes(2);
    });

    it('reprobes when the manifest identity changes', () => {
        const fixture = createFixture(rootDir);
        const probeRuntime = createProbe();
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        const manifest = cloneManifest(fixture.manifest);
        manifest.generatedAt = '2026-07-17T00:01:00.000Z';
        writeManifest(fixture.manifestPath, manifest);

        expect(probeRuntime(fixture.helperPath).usable).toBe(true);
        expect(spawnRuntimeProbe).toHaveBeenCalledTimes(2);
    });

    it('converts a thrown spawn failure into a stable result', () => {
        const fixture = createFixture(rootDir);
        spawnRuntimeProbe.mockImplementation(() => {
            throw new Error('spawn exploded');
        });

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'helper-probe-spawn-error',
        });
    });

    it.each([
        {
            label: 'timeout',
            spawnResult: {
                status: null,
                signal: 'SIGTERM',
                stdout: '',
                stderr: '',
                error: Object.assign(new Error('timed out'), {
                    code: 'ETIMEDOUT',
                }),
            },
            reason: 'helper-probe-timeout',
        },
        {
            label: 'spawn error',
            spawnResult: {
                status: null,
                signal: null,
                stdout: '',
                stderr: '',
                error: Object.assign(new Error('spawn failed'), {
                    code: 'EACCES',
                }),
            },
            reason: 'helper-probe-spawn-error',
        },
        {
            label: 'nonzero exit',
            spawnResult: {
                status: 1,
                signal: null,
                stdout: '{"protocol":1,"usable":false,"reason":"egl-unavailable"}\n',
                stderr: '',
            },
            reason: 'helper-probe-failed',
        },
        {
            label: 'signal',
            spawnResult: {
                status: null,
                signal: 'SIGKILL',
                stdout: '',
                stderr: '',
            },
            reason: 'helper-probe-signaled',
        },
        {
            label: 'invalid JSON',
            spawnResult: {
                status: 0,
                signal: null,
                stdout: 'not-json\n',
                stderr: '',
            },
            reason: 'helper-probe-invalid-output',
        },
        {
            label: 'multiple lines',
            spawnResult: {
                status: 0,
                signal: null,
                stdout: `${SUCCESS_OUTPUT}${SUCCESS_OUTPUT}`,
                stderr: '',
            },
            reason: 'helper-probe-invalid-output',
        },
        {
            label: 'wrong protocol',
            spawnResult: {
                status: 0,
                signal: null,
                stdout: '{"protocol":2,"usable":true,"libmpv":"2.3","renderApi":"egl"}\n',
                stderr: '',
            },
            reason: 'helper-probe-protocol-mismatch',
        },
        {
            label: 'unusable success',
            spawnResult: {
                status: 0,
                signal: null,
                stdout: '{"protocol":1,"usable":false,"reason":"egl-unavailable"}\n',
                stderr: '',
            },
            reason: 'helper-probe-unusable',
        },
    ])('fails closed on helper $label', ({ spawnResult, reason }) => {
        const fixture = createFixture(rootDir);
        spawnRuntimeProbe.mockReturnValue(spawnResult);

        expect(createProbe()(fixture.helperPath)).toEqual(
            expect.objectContaining({ usable: false, reason })
        );
    });

    it.each([
        ['linux', 'arm64', 'unsupported-architecture'],
        ['linux', 'arm', 'unsupported-architecture'],
        ['darwin', 'x64', 'unsupported-platform'],
    ] as const)(
        'does not probe unsupported %s/%s runtimes',
        (platform, arch, reason) => {
            const fixture = createFixture(rootDir);

            expect(createProbe({ platform, arch })(fixture.helperPath)).toEqual(
                {
                    usable: false,
                    reason,
                }
            );
            expect(spawnRuntimeProbe).not.toHaveBeenCalled();
        }
    );

    it('rejects a missing or malformed manifest without throwing', () => {
        const missing = createFixture(rootDir);
        unlinkSync(missing.manifestPath);
        expect(createProbe()(missing.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-missing',
        });

        const malformed = createFixture(rootDir, 'portable');
        writeFileSync(malformed.manifestPath, '{broken\n', { mode: 0o644 });
        expect(createProbe()(malformed.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it.each([
        ['origin', 'system-libmpv-frame-copy'],
        ['arch', 'arm64'],
        ['runtimeMode', 'system'],
        ['targets', ['deb']],
        ['unexpectedField', true],
    ])('rejects a bundled profile mismatch in %s', (field, value) => {
        const fixture = createFixture(rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        manifest[field] = value;
        writeManifest(fixture.manifestPath, manifest);

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it.each([
        ['system', ['deb', 'pacman']],
        ['portable', ['appimage']],
    ] as const)(
        'rejects an allowed subset of the exact %s profile targets',
        (profile, targets) => {
            const fixture = createFixture(rootDir, profile);
            const manifest = cloneManifest(fixture.manifest);
            manifest.targets = targets;
            writeManifest(fixture.manifestPath, manifest);

            expect(createProbe()(fixture.helperPath)).toEqual({
                usable: false,
                reason: 'runtime-manifest-invalid',
            });
            expect(spawnRuntimeProbe).not.toHaveBeenCalled();
        }
    );

    it('rejects a bundled closure dependency outside the deterministic system allowlist', () => {
        const fixture = createFixture(rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        const closure = manifest.runtimeDependencyClosure as {
            entries: Array<{ needed: string[] }>;
            externalDependencies: string[];
        };
        closure.entries[0].needed = ['libambient-only.so.1'];
        closure.externalDependencies = ['libambient-only.so.1'];
        mirrorBundledManifestFields(manifest);
        writeManifest(fixture.manifestPath, manifest);

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('requires externalDependencies to exactly equal the sorted external closure', () => {
        const fixture = createFixture(rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        const closure = manifest.runtimeDependencyClosure as {
            entries: Array<{ needed: string[] }>;
            externalDependencies: string[];
        };
        closure.entries[0].needed = ['libEGL.so.1', 'libc.so.6'];
        closure.externalDependencies = [];
        mirrorBundledManifestFields(manifest);
        writeManifest(fixture.manifestPath, manifest);

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('accepts only the exact deterministic external-system library declaration', () => {
        const fixture = createFixture(rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        (manifest.externalSystemLibraries as unknown[]).pop();
        mirrorBundledManifestFields(manifest);
        writeManifest(fixture.manifestPath, manifest);

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('accepts bundled dependencies on declared system interfaces and the glibc toolchain', () => {
        const fixture = createFixture(rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        const closure = manifest.runtimeDependencyClosure as {
            entries: Array<{ needed: string[] }>;
            externalDependencies: string[];
        };
        closure.entries[0].needed = ['libEGL.so.1', 'libc.so.6'];
        closure.externalDependencies = ['libEGL.so.1', 'libc.so.6'];
        mirrorBundledManifestFields(manifest);
        writeManifest(fixture.manifestPath, manifest);

        expect(createProbe()(fixture.helperPath)).toEqual(
            expect.objectContaining({ usable: true, runtimeMode: 'bundled' })
        );
        expect(spawnRuntimeProbe).toHaveBeenCalledTimes(1);
    });

    it.each([
        {
            label: 'pinned source identity',
            mutate(sourceRuntime: Record<string, unknown>) {
                const packages = sourceRuntime.packages as Record<
                    string,
                    Record<string, unknown>
                >;
                packages.mpv.sourceSha256 = '0'.repeat(64);
            },
        },
        {
            label: 'pinned source URL',
            mutate(sourceRuntime: Record<string, unknown>) {
                const packages = sourceRuntime.packages as Record<
                    string,
                    Record<string, unknown>
                >;
                packages.freetype.sourceUrl =
                    'https://example.invalid/freetype.tar.xz';
            },
        },
        {
            label: 'pinned git tag',
            mutate(sourceRuntime: Record<string, unknown>) {
                const packages = sourceRuntime.packages as Record<
                    string,
                    Record<string, unknown>
                >;
                packages.libplacebo.sourceTag = 'main';
            },
        },
        {
            label: 'pinned hwdata build input',
            mutate(sourceRuntime: Record<string, unknown>) {
                const packages = sourceRuntime.packages as Record<
                    string,
                    Record<string, unknown>
                >;
                packages.hwdata.buildInput = {
                    consumer: 'libdisplay-info',
                    relativePath: '../pnp.ids',
                    purpose:
                        'PNP vendor lookup table compiled into libdisplay-info.',
                };
            },
        },
        {
            label: 'git submodule record',
            mutate(sourceRuntime: Record<string, unknown>) {
                const packages = sourceRuntime.packages as Record<
                    string,
                    Record<string, unknown>
                >;
                packages.libplacebo.sourceSubmodules = [
                    `${'a'.repeat(40)} ../outside`,
                ];
            },
        },
        {
            label: 'duplicate git submodule records',
            mutate(sourceRuntime: Record<string, unknown>) {
                const packages = sourceRuntime.packages as Record<
                    string,
                    Record<string, unknown>
                >;
                const record = `${'a'.repeat(40)} 3rdparty/example`;
                packages.libplacebo.sourceSubmodules = [record, record];
            },
        },
        {
            label: 'portable ABI baseline',
            mutate(sourceRuntime: Record<string, unknown>) {
                const runtimeAbi = sourceRuntime.runtimeAbi as {
                    baseline: Record<string, unknown>;
                };
                runtimeAbi.baseline.glibcMaximum = '9.99';
            },
        },
        {
            label: 'source-distribution obligation',
            mutate(sourceRuntime: Record<string, unknown>) {
                sourceRuntime.sourceDistribution = 'Sources available.';
            },
        },
        {
            label: 'FFmpeg LGPL flags',
            mutate(sourceRuntime: Record<string, unknown>) {
                const ffmpeg = sourceRuntime.ffmpeg as {
                    configureFlags: string[];
                };
                ffmpeg.configureFlags = ['--disable-nonfree', '--enable-gpl'];
            },
        },
        {
            label: 'mpv LGPL flags',
            mutate(sourceRuntime: Record<string, unknown>) {
                const mpv = sourceRuntime.mpv as {
                    mesonFlags: string[];
                };
                mpv.mesonFlags = ['-Dgpl=true', '-Dlibmpv=true'];
            },
        },
    ])('rejects an invalid $label', ({ mutate }) => {
        const fixture = createFixture(rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        mutate(manifest.sourceRuntime as Record<string, unknown>);
        writeManifest(fixture.manifestPath, manifest);

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('rejects system manifests with a private library directory', () => {
        const fixture = createFixture(rootDir);
        mkdirSync(path.join(fixture.nativeDir, 'lib'));

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-library-directory-invalid',
        });
    });

    it.each([
        {
            label: 'missing addon',
            mutate(fixture: RuntimeFixture) {
                unlinkSync(path.join(fixture.nativeDir, 'embedded_mpv.node'));
            },
            reason: 'runtime-artifact-missing',
        },
        {
            label: 'non-executable helper',
            mutate(fixture: RuntimeFixture) {
                chmodSync(fixture.helperPath, 0o644);
            },
            reason: 'runtime-artifact-invalid',
        },
        {
            label: 'wrong reader mode',
            mutate(fixture: RuntimeFixture) {
                chmodSync(
                    path.join(
                        fixture.nativeDir,
                        'embedded_mpv_frame_reader.node'
                    ),
                    0o600
                );
            },
            reason: 'runtime-artifact-invalid',
        },
        {
            label: 'symlinked helper',
            mutate(fixture: RuntimeFixture) {
                const target = `${fixture.helperPath}.real`;
                writeFileSync(target, '#!/bin/sh\n', { mode: 0o755 });
                unlinkSync(fixture.helperPath);
                symlinkSync(target, fixture.helperPath);
            },
            reason: 'runtime-artifact-invalid',
        },
        {
            label: 'reader directory',
            mutate(fixture: RuntimeFixture) {
                const readerPath = path.join(
                    fixture.nativeDir,
                    'embedded_mpv_frame_reader.node'
                );
                unlinkSync(readerPath);
                mkdirSync(readerPath);
            },
            reason: 'runtime-artifact-invalid',
        },
    ])('rejects a $label', ({ mutate, reason }) => {
        const fixture = createFixture(rootDir);
        mutate(fixture);

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason,
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it.each([
        {
            label: 'missing declared library',
            mutate(fixture: RuntimeFixture) {
                unlinkSync(path.join(fixture.nativeDir, 'lib', 'libmpv.so.2'));
            },
            reason: 'runtime-library-missing',
        },
        {
            label: 'undeclared library',
            mutate(fixture: RuntimeFixture) {
                writeFileSync(
                    path.join(fixture.nativeDir, 'lib', 'libextra.so'),
                    'extra'
                );
            },
            reason: 'runtime-library-undeclared',
        },
        {
            label: 'library size mismatch',
            mutate(fixture: RuntimeFixture) {
                writeFileSync(
                    path.join(fixture.nativeDir, 'lib', 'libmpv.so.2'),
                    'different-length'
                );
            },
            reason: 'runtime-library-size-mismatch',
        },
        {
            label: 'library hash mismatch',
            mutate(fixture: RuntimeFixture) {
                const runtimePath = path.join(
                    fixture.nativeDir,
                    'lib',
                    'libmpv.so.2'
                );
                const original = readFileSync(runtimePath);
                writeFileSync(
                    runtimePath,
                    Buffer.from(original.map((value) => value ^ 0xff))
                );
            },
            reason: 'runtime-library-hash-mismatch',
        },
        {
            label: 'symlinked library',
            mutate(fixture: RuntimeFixture) {
                const runtimePath = path.join(
                    fixture.nativeDir,
                    'lib',
                    'libmpv.so.2'
                );
                const targetPath = path.join(
                    fixture.nativeDir,
                    'libmpv-real.so.2'
                );
                writeFileSync(
                    targetPath,
                    fixture.runtimeContents['libmpv.so.2']
                );
                unlinkSync(runtimePath);
                symlinkSync(targetPath, runtimePath);
            },
            reason: 'runtime-library-invalid',
        },
        {
            label: 'library directory',
            mutate(fixture: RuntimeFixture) {
                const runtimePath = path.join(
                    fixture.nativeDir,
                    'lib',
                    'libmpv.so.2'
                );
                unlinkSync(runtimePath);
                mkdirSync(runtimePath);
            },
            reason: 'runtime-library-invalid',
        },
    ])('rejects a $label', ({ mutate, reason }) => {
        const fixture = createFixture(rootDir, 'portable');
        mutate(fixture);

        expect(createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason,
        });
        expect(spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it.each(['../libmpv.so.2', '/tmp/libmpv.so.2', 'sub/libmpv.so.2'])(
        'rejects unsafe runtime path %s',
        (unsafeName) => {
            const fixture = createFixture(rootDir, 'portable');
            const manifest = cloneManifest(fixture.manifest);
            const runtimeFiles = manifest.runtimeFiles as RuntimeFile[];
            runtimeFiles[0].name = unsafeName;
            writeManifest(fixture.manifestPath, manifest);

            expect(createProbe()(fixture.helperPath)).toEqual({
                usable: false,
                reason: 'runtime-manifest-invalid',
            });
            expect(spawnRuntimeProbe).not.toHaveBeenCalled();
        }
    );

    it('uses read and execute access checks for declared artifacts', () => {
        const fixture = createFixture(rootDir);
        const probeRuntime = createProbe();
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        const accessMock = fileSystem?.accessSync as jest.Mock;
        expect(accessMock).toHaveBeenCalledWith(
            fixture.helperPath,
            fsConstants.R_OK | fsConstants.X_OK
        );
        expect(accessMock).toHaveBeenCalledWith(
            path.join(fixture.nativeDir, 'embedded_mpv_frame_reader.node'),
            fsConstants.R_OK
        );
    });
});
