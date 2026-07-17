import { unlinkSync, writeFileSync } from 'fs';
import {
    cloneManifest,
    createFixture,
    mirrorBundledManifestFields,
    writeManifest,
} from './runtime-fixtures.test-helpers';
import {
    createRuntimeTestContext,
    type RuntimeTestContext,
} from './runtime-harness.test-helpers';

describe('embedded-mpv frame-copy packaged manifest policy', () => {
    let context: RuntimeTestContext;

    beforeEach(() => {
        context = createRuntimeTestContext();
    });

    afterEach(() => {
        context.dispose();
    });

    it('rejects a missing or malformed manifest without throwing', () => {
        const missing = createFixture(context.rootDir);
        unlinkSync(missing.manifestPath);
        expect(context.createProbe()(missing.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-missing',
        });

        const malformed = createFixture(context.rootDir, 'portable');
        writeFileSync(malformed.manifestPath, '{broken\n', { mode: 0o644 });
        expect(context.createProbe()(malformed.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it.each([
        ['origin', 'system-libmpv-frame-copy'],
        ['arch', 'arm64'],
        ['runtimeMode', 'system'],
        ['targets', ['deb']],
        ['unexpectedField', true],
    ])('rejects a bundled profile mismatch in %s', (field, value) => {
        const fixture = createFixture(context.rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        manifest[field] = value;
        writeManifest(fixture.manifestPath, manifest);

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it.each([
        ['system', ['deb', 'pacman']],
        ['portable', ['appimage']],
    ] as const)(
        'rejects an allowed subset of the exact %s profile targets',
        (profile, targets) => {
            const fixture = createFixture(context.rootDir, profile);
            const manifest = cloneManifest(fixture.manifest);
            manifest.targets = targets;
            writeManifest(fixture.manifestPath, manifest);

            expect(context.createProbe()(fixture.helperPath)).toEqual({
                usable: false,
                reason: 'runtime-manifest-invalid',
            });
            expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
        }
    );

    it('rejects a bundled closure dependency outside the deterministic system allowlist', () => {
        const fixture = createFixture(context.rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        const closure = manifest.runtimeDependencyClosure as {
            entries: Array<{ needed: string[] }>;
            externalDependencies: string[];
        };
        closure.entries[0].needed = ['libambient-only.so.1'];
        closure.externalDependencies = ['libambient-only.so.1'];
        mirrorBundledManifestFields(manifest);
        writeManifest(fixture.manifestPath, manifest);

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('requires externalDependencies to exactly equal the sorted external closure', () => {
        const fixture = createFixture(context.rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        const closure = manifest.runtimeDependencyClosure as {
            entries: Array<{ needed: string[] }>;
            externalDependencies: string[];
        };
        closure.entries[0].needed = ['libEGL.so.1', 'libc.so.6'];
        closure.externalDependencies = [];
        mirrorBundledManifestFields(manifest);
        writeManifest(fixture.manifestPath, manifest);

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('accepts only the exact deterministic external-system library declaration', () => {
        const fixture = createFixture(context.rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        (manifest.externalSystemLibraries as unknown[]).pop();
        mirrorBundledManifestFields(manifest);
        writeManifest(fixture.manifestPath, manifest);

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('accepts bundled dependencies on declared system interfaces and the glibc toolchain', () => {
        const fixture = createFixture(context.rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        const closure = manifest.runtimeDependencyClosure as {
            entries: Array<{ needed: string[] }>;
            externalDependencies: string[];
        };
        closure.entries[0].needed = ['libEGL.so.1', 'libc.so.6'];
        closure.externalDependencies = ['libEGL.so.1', 'libc.so.6'];
        mirrorBundledManifestFields(manifest);
        writeManifest(fixture.manifestPath, manifest);

        expect(context.createProbe()(fixture.helperPath)).toEqual(
            expect.objectContaining({ usable: true, runtimeMode: 'bundled' })
        );
        expect(context.spawnRuntimeProbe).toHaveBeenCalledTimes(1);
    });
});
