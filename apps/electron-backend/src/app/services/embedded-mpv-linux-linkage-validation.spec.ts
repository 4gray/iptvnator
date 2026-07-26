import { unlinkSync } from 'fs';
import path from 'path';

import {
    cleanupTemporaryDirectories,
    createArtifactFixture,
    loadLinkageModule,
    readelfDynamic,
} from './embedded-mpv-linux-linkage.test-helpers';

/**
 * Artifact-level linkage validation: only the helper may link libmpv, and it
 * must do so through `$ORIGIN/lib` with no RPATH. SONAME resolution and build
 * mode inputs live in embedded-mpv-linux-linkage.spec.ts.
 */
describe('Linux Embedded MPV linkage validation', () => {
    afterEach(() => {
        cleanupTemporaryDirectories();
    });

    it('accepts only process-isolated Linux frame-copy linkage', () => {
        const { validateLinuxFrameCopyLinkage } = loadLinkageModule();
        const fixture = createArtifactFixture();

        expect(() =>
            validateLinuxFrameCopyLinkage({
                expectedLibmpvSoname: 'libmpv.so.2',
                outputDir: fixture.outputDir,
                readDynamicSection: fixture.readDynamicSection,
            })
        ).not.toThrow();
    });

    it('rejects a helper linked to the wrong libmpv SONAME', () => {
        const { validateLinuxFrameCopyLinkage } = loadLinkageModule();
        const fixture = createArtifactFixture();

        fixture.outputs.iptvnator_mpv_helper = readelfDynamic([
            ['NEEDED', 'libmpv.so.3'],
            ['RUNPATH', '$ORIGIN/lib'],
        ]);

        expect(() =>
            validateLinuxFrameCopyLinkage({
                expectedLibmpvSoname: 'libmpv.so.2',
                outputDir: fixture.outputDir,
                readDynamicSection: fixture.readDynamicSection,
            })
        ).toThrow(/helper.*DT_NEEDED must contain exactly libmpv\.so\.2/i);
    });

    it('rejects helper RPATH and any RUNPATH other than $ORIGIN/lib', () => {
        const { validateLinuxFrameCopyLinkage } = loadLinkageModule();
        const rpathFixture = createArtifactFixture();
        rpathFixture.outputs.iptvnator_mpv_helper = readelfDynamic([
            ['NEEDED', 'libmpv.so.2'],
            ['RPATH', '/host/lib'],
            ['RUNPATH', '$ORIGIN/lib'],
        ]);

        expect(() =>
            validateLinuxFrameCopyLinkage({
                expectedLibmpvSoname: 'libmpv.so.2',
                outputDir: rpathFixture.outputDir,
                readDynamicSection: rpathFixture.readDynamicSection,
            })
        ).toThrow(/helper must not contain RPATH/i);

        const runpathFixture = createArtifactFixture();
        runpathFixture.outputs.iptvnator_mpv_helper = readelfDynamic([
            ['NEEDED', 'libmpv.so.2'],
            ['RUNPATH', '$ORIGIN'],
        ]);

        expect(() =>
            validateLinuxFrameCopyLinkage({
                expectedLibmpvSoname: 'libmpv.so.2',
                outputDir: runpathFixture.outputDir,
                readDynamicSection: runpathFixture.readDynamicSection,
            })
        ).toThrow(/helper RUNPATH must be exactly \$ORIGIN\/lib/i);
    });

    it.each([
        ['embedded_mpv.node', 'addon'],
        ['embedded_mpv_frame_reader.node', 'frame reader'],
    ])('rejects Electron-side libmpv linkage from %s', (fileName, label) => {
        const { validateLinuxFrameCopyLinkage } = loadLinkageModule();
        const fixture = createArtifactFixture();
        fixture.outputs[fileName] = readelfDynamic([['NEEDED', 'libmpv.so.2']]);

        expect(() =>
            validateLinuxFrameCopyLinkage({
                expectedLibmpvSoname: 'libmpv.so.2',
                outputDir: fixture.outputDir,
                readDynamicSection: fixture.readDynamicSection,
            })
        ).toThrow(new RegExp(`${label} must not have a direct libmpv`, 'i'));
    });

    it('rejects missing artifacts and readelf failures', () => {
        const { validateLinuxFrameCopyLinkage } = loadLinkageModule();
        const missingArtifactFixture = createArtifactFixture();
        unlinkSync(
            path.join(
                missingArtifactFixture.outputDir,
                'embedded_mpv_frame_reader.node'
            )
        );

        expect(() =>
            validateLinuxFrameCopyLinkage({
                expectedLibmpvSoname: 'libmpv.so.2',
                outputDir: missingArtifactFixture.outputDir,
                readDynamicSection: missingArtifactFixture.readDynamicSection,
            })
        ).toThrow(/missing.*frame reader/i);

        const readelfFailureFixture = createArtifactFixture();
        expect(() =>
            validateLinuxFrameCopyLinkage({
                expectedLibmpvSoname: 'libmpv.so.2',
                outputDir: readelfFailureFixture.outputDir,
                readDynamicSection: () => {
                    throw new Error('readelf is unavailable');
                },
            })
        ).toThrow(/readelf is unavailable/);
    });

    it('runs cleanup before rethrowing the original transaction failure', () => {
        const { runWithCleanup } = loadLinkageModule();
        const calls: string[] = [];
        const failure = new Error('post-link validation failed');

        expect(() =>
            runWithCleanup(
                () => {
                    calls.push('operation');
                    throw failure;
                },
                () => calls.push('cleanup')
            )
        ).toThrow(failure);
        expect(calls).toEqual(['operation', 'cleanup']);
    });
});
