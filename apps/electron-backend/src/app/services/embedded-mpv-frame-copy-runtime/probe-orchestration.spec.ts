import { chmodSync, lstatSync, readFileSync, writeFileSync } from 'fs';
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
        const probeRuntime = context.createProbe();

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
                env: {
                    PATH: '/usr/bin',
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
