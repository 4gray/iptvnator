import { createHash } from 'crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import type { createEmbeddedMpvFrameCopyRuntimeProbe } from '../embedded-mpv-frame-copy-runtime';
import {
    EXTERNAL_SYSTEM_LIBRARIES,
    PINNED_SOURCE_PACKAGE_IDENTITIES,
    type RuntimeFile,
    type RuntimeFixture,
} from './runtime.spec-data';

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

export function createFixture(
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
                  deb: ['libmpv2', 'libegl1', 'libgl1', 'libgbm1'],
                  rpm: [
                      'mpv-libs',
                      'libglvnd-egl',
                      'libglvnd-glx',
                      'mesa-libgbm',
                  ],
                  pacman: ['mpv', 'libglvnd', 'mesa'],
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

export function createDevelopmentFixture(
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

export function probeDevelopmentRuntime(
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

export function mirrorBundledManifestFields(
    manifest: Record<string, unknown>
): void {
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

export function writeManifest(
    manifestPath: string,
    manifest: Record<string, unknown>
): void {
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, {
        mode: 0o644,
    });
    chmodSync(manifestPath, 0o644);
}

export function cloneManifest<T>(manifest: T): T {
    return JSON.parse(JSON.stringify(manifest)) as T;
}
