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
    createEmbeddedMpvFrameCopyRuntimeProbe,
    EmbeddedMpvFrameCopyRuntimeDependencies,
} from './embedded-mpv-frame-copy-runtime';

const SUCCESS_OUTPUT =
    '{"protocol":1,"usable":true,"libmpv":"2.3","renderApi":"egl"}\n';

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
    const externalSystemLibraries: unknown[] = [];
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
                  sourceRuntime: {
                      schemaVersion: 1,
                      origin: 'vendored-lgpl-source-build',
                      platform: 'linux',
                      arch: 'x64',
                      runtimeFiles,
                      runtimeTotalBytes: runtimeFiles.reduce(
                          (total, runtimeFile) => total + runtimeFile.size,
                          0
                      ),
                      runtimeDependencyClosure,
                      externalSystemLibraries,
                  },
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

function writeManifest(
    manifestPath: string,
    manifest: Record<string, unknown>
): void {
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, {
        mode: 0o644,
    });
    chmodSync(manifestPath, 0o644);
}

function cloneManifest(
    manifest: Record<string, unknown>
): Record<string, unknown> {
    return JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
}

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
            env: { PATH: '/usr/bin', LD_LIBRARY_PATH: '/system/libs' },
            fileSystem,
            spawnSync: spawnRuntimeProbe as typeof spawnSync,
            ...overrides,
        });
    }

    it('validates a system package, preserves its environment, and caches by helper/manifest identity', () => {
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
                windowsHide: true,
                env: {
                    PATH: '/usr/bin',
                    LD_LIBRARY_PATH: '/system/libs',
                },
            }
        );
        expect(fileSystem?.readFileSync).toHaveBeenCalled();
    });

    it.each(['portable', 'flatpak'] as const)(
        'validates the exact %s bundled closure and prepends only its private library directory',
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
                        LD_LIBRARY_PATH: `${path.join(
                            fixture.nativeDir,
                            'lib'
                        )}:/system/libs`,
                    },
                })
            );
        }
    );

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
