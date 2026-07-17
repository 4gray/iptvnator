import {
    chmodSync,
    constants as fsConstants,
    mkdirSync,
    readFileSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'fs';
import path from 'path';
import type { RuntimeFile, RuntimeFixture } from './runtime.spec-data';
import {
    cloneManifest,
    createFixture,
    writeManifest,
} from './runtime-fixtures.test-helpers';
import {
    createRuntimeTestContext,
    type RuntimeTestContext,
} from './runtime-harness.test-helpers';

describe('embedded-mpv frame-copy package integrity', () => {
    let context: RuntimeTestContext;

    beforeEach(() => {
        context = createRuntimeTestContext();
    });

    afterEach(() => {
        context.dispose();
    });

    it('rejects system manifests with a private library directory', () => {
        const fixture = createFixture(context.rootDir);
        mkdirSync(path.join(fixture.nativeDir, 'lib'));

        expect(context.createProbe()(fixture.helperPath)).toEqual({
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
        const fixture = createFixture(context.rootDir);
        mutate(fixture);

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason,
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
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
        const fixture = createFixture(context.rootDir, 'portable');
        mutate(fixture);

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason,
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it.each(['../libmpv.so.2', '/tmp/libmpv.so.2', 'sub/libmpv.so.2'])(
        'rejects unsafe runtime path %s',
        (unsafeName) => {
            const fixture = createFixture(context.rootDir, 'portable');
            const manifest = cloneManifest(fixture.manifest);
            const runtimeFiles = manifest.runtimeFiles as RuntimeFile[];
            runtimeFiles[0].name = unsafeName;
            writeManifest(fixture.manifestPath, manifest);

            expect(context.createProbe()(fixture.helperPath)).toEqual({
                usable: false,
                reason: 'runtime-manifest-invalid',
            });
            expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
        }
    );

    it('uses read and execute access checks for declared artifacts', () => {
        const fixture = createFixture(context.rootDir);
        const probeRuntime = context.createProbe();
        expect(probeRuntime(fixture.helperPath).usable).toBe(true);

        const accessMock = context.fileSystem.accessSync as jest.Mock;
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
