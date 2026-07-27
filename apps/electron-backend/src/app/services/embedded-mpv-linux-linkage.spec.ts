import { symlinkSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';

import {
    cleanupTemporaryDirectories,
    createSonameFixture,
    loadLinkageModule,
    readelfDynamic,
} from './embedded-mpv-linux-linkage.test-helpers';

/**
 * SONAME resolution and build-mode linker inputs. The artifact-level linkage
 * checks live in embedded-mpv-linux-linkage-validation.spec.ts.
 */
describe('Linux Embedded MPV linkage resolution', () => {
    afterEach(() => {
        cleanupTemporaryDirectories();
    });

    it('parses every dynamic tag without hiding duplicate SONAME entries', () => {
        const { parseReadelfDynamic } = loadLinkageModule();

        expect(
            parseReadelfDynamic(
                readelfDynamic([
                    ['NEEDED', 'libmpv.so.2'],
                    ['RPATH', '/forbidden'],
                    ['RUNPATH', '$ORIGIN/lib'],
                    ['SONAME', 'libmpv.so.2'],
                    ['SONAME', 'libmpv.so.3'],
                ])
            )
        ).toEqual({
            needed: ['libmpv.so.2'],
            rpath: ['/forbidden'],
            runpath: ['$ORIGIN/lib'],
            soname: ['libmpv.so.2', 'libmpv.so.3'],
        });
    });

    it('resolves the exact libmpv SONAME from closure metadata and verified copied files', () => {
        const { resolveVerifiedLinuxLibMpvSoname } = loadLinkageModule();
        const fixture = createSonameFixture();

        expect(
            resolveVerifiedLinuxLibMpvSoname({
                ...fixture,
                readDynamicSection: () =>
                    readelfDynamic([['SONAME', 'libmpv.so.2']]),
            })
        ).toBe('libmpv.so.2');
    });

    it('rejects missing and ambiguous closure SONAME metadata', () => {
        const { resolveVerifiedLinuxLibMpvSoname } = loadLinkageModule();
        const missingFixture = createSonameFixture();
        for (const entry of missingFixture.runtimeDependencyClosure.entries) {
            entry.soname = null;
        }

        expect(() =>
            resolveVerifiedLinuxLibMpvSoname({
                ...missingFixture,
                readDynamicSection: () =>
                    readelfDynamic([['SONAME', 'libmpv.so.2']]),
            })
        ).toThrow(/exactly one versioned libmpv SONAME/i);

        const ambiguousFixture = createSonameFixture();
        ambiguousFixture.runtimeDependencyClosure.entries.push({
            name: 'libmpv.so.3',
            needed: [],
            rpath: [],
            runpath: ['$ORIGIN'],
            soname: 'libmpv.so.3',
        });

        expect(() =>
            resolveVerifiedLinuxLibMpvSoname({
                ...ambiguousFixture,
                readDynamicSection: () =>
                    readelfDynamic([['SONAME', 'libmpv.so.2']]),
            })
        ).toThrow(/exactly one versioned libmpv SONAME/i);
    });

    it('rejects missing, ambiguous, and mismatched DT_SONAME values', () => {
        const { resolveVerifiedLinuxLibMpvSoname } = loadLinkageModule();
        const fixture = createSonameFixture();

        expect(() =>
            resolveVerifiedLinuxLibMpvSoname({
                ...fixture,
                readDynamicSection: () => readelfDynamic([]),
            })
        ).toThrow(/exactly one DT_SONAME/i);
        expect(() =>
            resolveVerifiedLinuxLibMpvSoname({
                ...fixture,
                readDynamicSection: () =>
                    readelfDynamic([
                        ['SONAME', 'libmpv.so.2'],
                        ['SONAME', 'libmpv.so.3'],
                    ]),
            })
        ).toThrow(/exactly one DT_SONAME/i);
        expect(() =>
            resolveVerifiedLinuxLibMpvSoname({
                ...fixture,
                readDynamicSection: () =>
                    readelfDynamic([['SONAME', 'libmpv.so.3']]),
            })
        ).toThrow(/does not match validated closure SONAME/i);
    });

    (process.platform === 'win32' ? it.skip : it)(
        'rejects a symlinked copied linker input',
        () => {
            const { resolveVerifiedLinuxLibMpvSoname } = loadLinkageModule();
            const fixture = createSonameFixture();
            const aliasPath = path.join(fixture.outputLibDir, 'libmpv.so');
            unlinkSync(aliasPath);
            symlinkSync(path.basename(fixture.exactPath), aliasPath);

            expect(() =>
                resolveVerifiedLinuxLibMpvSoname({
                    ...fixture,
                    readDynamicSection: () =>
                        readelfDynamic([['SONAME', 'libmpv.so.2']]),
                })
            ).toThrow(/must be a regular non-symbolic-link file/i);
        }
    );

    it('rejects a missing exact runtime record and a mismatched exact file hash', () => {
        const { resolveVerifiedLinuxLibMpvSoname } = loadLinkageModule();
        const missingRecordFixture = createSonameFixture();

        expect(() =>
            resolveVerifiedLinuxLibMpvSoname({
                ...missingRecordFixture,
                runtimeFiles: missingRecordFixture.runtimeFiles.filter(
                    ({ name }) => name !== 'libmpv.so.2'
                ),
                readDynamicSection: () =>
                    readelfDynamic([['SONAME', 'libmpv.so.2']]),
            })
        ).toThrow(/exact runtimeFiles record/i);

        const mismatchedFileFixture = createSonameFixture();
        writeFileSync(
            mismatchedFileFixture.exactPath,
            Buffer.from('tampered exact SONAME file')
        );

        expect(() =>
            resolveVerifiedLinuxLibMpvSoname({
                ...mismatchedFileFixture,
                readDynamicSection: () =>
                    readelfDynamic([['SONAME', 'libmpv.so.2']]),
            })
        ).toThrow(/size|SHA-256/i);
    });

    it('uses and identifies the unmanaged system libmpv only for system development', () => {
        const { resolveLinuxFrameCopyLinkageInputs } = loadLinkageModule();
        const readDynamicSection = jest.fn((filePath: string) => {
            expect(filePath).toBe('/opt/libmpv/lib/libmpv.so');
            return readelfDynamic([['SONAME', 'libmpv.so.2']]);
        });

        expect(
            resolveLinuxFrameCopyLinkageInputs({
                buildInputMode: 'system-dev',
                outputLibDir: '/native/build/Release/lib',
                packagedLibmpvSoname: null,
                readDynamicSection,
                runtimeLibDir: '/opt/libmpv/lib',
            })
        ).toEqual({
            expectedLibmpvSoname: 'libmpv.so.2',
            linkerLibraryDir: '/opt/libmpv/lib',
        });
        expect(readDynamicSection).toHaveBeenCalledTimes(1);
    });

    it('keeps bundled and untrusted build modes on the copied runtime directory', () => {
        const { resolveLinuxFrameCopyLinkageInputs } = loadLinkageModule();
        const readDynamicSection = jest.fn(() => {
            throw new Error('must not inspect the ambient system runtime');
        });

        for (const buildInputMode of [
            'bundled-runtime',
            'system-build-inputs',
            'unexpected-mode',
        ]) {
            expect(
                resolveLinuxFrameCopyLinkageInputs({
                    buildInputMode,
                    outputLibDir: '/native/build/Release/lib',
                    packagedLibmpvSoname:
                        buildInputMode === 'bundled-runtime'
                            ? 'libmpv.so.2'
                            : null,
                    readDynamicSection,
                    runtimeLibDir: '/usr/lib/x86_64-linux-gnu',
                })
            ).toEqual({
                expectedLibmpvSoname:
                    buildInputMode === 'bundled-runtime' ? 'libmpv.so.2' : null,
                linkerLibraryDir: '/native/build/Release/lib',
            });
        }
        expect(readDynamicSection).not.toHaveBeenCalled();
    });

    it('rejects ambiguous or unversioned system-development libmpv identities', () => {
        const { resolveLinuxFrameCopyLinkageInputs } = loadLinkageModule();
        const options = {
            buildInputMode: 'system-dev',
            outputLibDir: '/native/build/Release/lib',
            packagedLibmpvSoname: null,
            runtimeLibDir: '/usr/lib/x86_64-linux-gnu',
        };

        expect(() =>
            resolveLinuxFrameCopyLinkageInputs({
                ...options,
                readDynamicSection: () =>
                    readelfDynamic([['SONAME', 'libmpv.so']]),
            })
        ).toThrow(/system-development.*exactly one versioned libmpv SONAME/i);
        expect(() =>
            resolveLinuxFrameCopyLinkageInputs({
                ...options,
                readDynamicSection: () => readelfDynamic([]),
            })
        ).toThrow(/system-development.*exactly one versioned libmpv SONAME/i);
        expect(() =>
            resolveLinuxFrameCopyLinkageInputs({
                ...options,
                readDynamicSection: () =>
                    readelfDynamic([
                        ['SONAME', 'libmpv.so.1'],
                        ['SONAME', 'libmpv.so.2'],
                    ]),
            })
        ).toThrow(/system-development.*exactly one versioned libmpv SONAME/i);
    });
});
