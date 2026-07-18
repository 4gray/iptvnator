import {
    cloneManifest,
    createFixture,
    writeManifest,
} from './runtime-fixtures.test-helpers';
import {
    createRuntimeTestContext,
    type RuntimeTestContext,
} from './runtime-harness.test-helpers';

describe('embedded-mpv frame-copy source runtime policy', () => {
    let context: RuntimeTestContext;

    beforeEach(() => {
        context = createRuntimeTestContext();
    });

    afterEach(() => {
        context.dispose();
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
            label: 'unpinned git submodule commit',
            mutate(sourceRuntime: Record<string, unknown>) {
                const packages = sourceRuntime.packages as Record<
                    string,
                    Record<string, unknown>
                >;
                packages.libplacebo.sourceSubmodules = [
                    `${'f'.repeat(40)} 3rdparty/Vulkan-Headers (v1.4.337)`,
                    `${'e'.repeat(40)} 3rdparty/fast_float (v6.1.0-275-g97b54ca)`,
                ];
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
        const fixture = createFixture(context.rootDir, 'portable');
        const manifest = cloneManifest(fixture.manifest);
        mutate(manifest.sourceRuntime as Record<string, unknown>);
        writeManifest(fixture.manifestPath, manifest);

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'runtime-manifest-invalid',
        });
        expect(context.spawnRuntimeProbe).not.toHaveBeenCalled();
    });
});
