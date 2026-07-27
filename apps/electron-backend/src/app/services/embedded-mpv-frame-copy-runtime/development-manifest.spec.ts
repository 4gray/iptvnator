import { mkdirSync } from 'fs';
import path from 'path';
import {
    cloneManifest,
    createDevelopmentFixture,
    probeDevelopmentRuntime,
    writeManifest,
} from './runtime-fixtures.test-helpers';
import {
    createRuntimeTestContext,
    type RuntimeTestContext,
} from './runtime-harness.test-helpers';

describe('embedded-mpv frame-copy development manifest', () => {
    let context: RuntimeTestContext;

    beforeEach(() => {
        context = createRuntimeTestContext();
    });

    afterEach(() => {
        context.dispose();
    });

    it.each(['system-dev', 'system-build-inputs', 'bundled-runtime'] as const)(
        'accepts an exact unpackaged %s build manifest and still runs the helper probe',
        (buildInputMode) => {
            const fixture = createDevelopmentFixture(
                context.rootDir,
                buildInputMode
            );

            expect(
                probeDevelopmentRuntime(
                    context.createProbe(),
                    fixture.helperPath
                )
            ).toEqual(
                expect.objectContaining({
                    usable: true,
                    runtimeMode:
                        buildInputMode === 'bundled-runtime'
                            ? 'bundled'
                            : 'system',
                })
            );
            expect(context.spawnRuntimeProbe).toHaveBeenCalledWith(
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
        const fixture = createDevelopmentFixture(
            context.rootDir,
            'bundled-runtime'
        );

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });

    it('accepts a local bundled runtime before a release source archive is assembled', () => {
        const fixture = createDevelopmentFixture(
            context.rootDir,
            'bundled-runtime'
        );
        const manifest = cloneManifest(fixture.manifest);
        manifest.sourceArchive = null;
        writeManifest(fixture.manifestPath, manifest);

        expect(
            probeDevelopmentRuntime(context.createProbe(), fixture.helperPath)
        ).toEqual(
            expect.objectContaining({
                usable: true,
                runtimeMode: 'bundled',
            })
        );
        expect(context.spawnRuntimeProbe).toHaveBeenCalled();
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
            const fixture = createDevelopmentFixture(
                context.rootDir,
                'system-dev'
            );
            const manifest = cloneManifest(fixture.manifest);
            mutate(manifest);
            writeManifest(fixture.manifestPath, manifest);

            expect(
                probeDevelopmentRuntime(
                    context.createProbe(),
                    fixture.helperPath
                )
            ).toEqual({
                usable: false,
                reason: 'runtime-manifest-invalid',
            });
            expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
        }
    );

    it('rejects a system development manifest with a private runtime directory', () => {
        const fixture = createDevelopmentFixture(context.rootDir, 'system-dev');
        mkdirSync(path.join(fixture.nativeDir, 'lib'));

        expect(
            probeDevelopmentRuntime(context.createProbe(), fixture.helperPath)
        ).toEqual({
            usable: false,
            reason: 'runtime-library-directory-invalid',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });
});
