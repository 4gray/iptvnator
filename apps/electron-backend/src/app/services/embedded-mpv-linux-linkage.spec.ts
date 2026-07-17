import {
    existsSync,
    mkdtempSync,
    mkdirSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const linkageModulePath = path.resolve(
    __dirname,
    '../../../embedded-mpv-linux-linkage.cjs'
);
const requireBuildHelper = createRequire(__filename);

interface RuntimeFileRecord {
    name: string;
    size: number;
    sha256: string;
}

interface SonameFixture {
    exactPath: string;
    outputLibDir: string;
    runtimeDependencyClosure: {
        entries: Array<{
            name: string;
            needed: string[];
            rpath: string[];
            runpath: string[];
            soname: string | null;
        }>;
    };
    runtimeFiles: RuntimeFileRecord[];
}

function loadLinkageModule(): {
    parseReadelfDynamic: (output: string) => {
        needed: string[];
        rpath: string[];
        runpath: string[];
        soname: string[];
    };
    resolveVerifiedLinuxLibMpvSoname: (options: {
        outputLibDir: string;
        readDynamicSection: (filePath: string) => string;
        runtimeDependencyClosure: SonameFixture['runtimeDependencyClosure'];
        runtimeFiles: RuntimeFileRecord[];
    }) => string;
    runWithCleanup: <T>(operation: () => T, cleanup: () => void) => T;
    validateLinuxFrameCopyLinkage: (options: {
        expectedLibmpvSoname: string;
        outputDir: string;
        readDynamicSection: (filePath: string) => string;
    }) => void;
} {
    expect(existsSync(linkageModulePath)).toBe(true);
    return requireBuildHelper(linkageModulePath);
}

function sha256(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

function runtimeFile(name: string, contents: Buffer): RuntimeFileRecord {
    return {
        name,
        size: contents.byteLength,
        sha256: sha256(contents),
    };
}

function readelfDynamic(
    entries: Array<['NEEDED' | 'RPATH' | 'RUNPATH' | 'SONAME', string]>
): string {
    return entries
        .map(
            ([tag, value], index) =>
                ` 0x${index
                    .toString(16)
                    .padStart(16, '0')} (${tag}) Library value: [${value}]`
        )
        .join('\n');
}

describe('Linux Embedded MPV linkage verification', () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        for (const directory of temporaryDirectories.splice(0)) {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    function temporaryDirectory(): string {
        const directory = mkdtempSync(
            path.join(tmpdir(), 'iptvnator-mpv-linkage-')
        );
        temporaryDirectories.push(directory);
        return directory;
    }

    function createSonameFixture(soname = 'libmpv.so.2'): SonameFixture {
        const outputLibDir = path.join(temporaryDirectory(), 'lib');
        mkdirSync(outputLibDir, { recursive: true });
        const contents = Buffer.from('verified libmpv ELF contents');
        const aliasPath = path.join(outputLibDir, 'libmpv.so');
        const exactPath = path.join(outputLibDir, soname);
        writeFileSync(aliasPath, contents);
        writeFileSync(exactPath, contents);

        return {
            exactPath,
            outputLibDir,
            runtimeFiles: [
                runtimeFile('libmpv.so', contents),
                runtimeFile(soname, contents),
            ],
            runtimeDependencyClosure: {
                entries: [
                    {
                        name: 'libmpv.so',
                        needed: [],
                        rpath: [],
                        runpath: ['$ORIGIN'],
                        soname,
                    },
                    {
                        name: soname,
                        needed: [],
                        rpath: [],
                        runpath: ['$ORIGIN'],
                        soname,
                    },
                ],
            },
        };
    }

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

    function createArtifactFixture(): {
        outputDir: string;
        readDynamicSection: (filePath: string) => string;
        outputs: Record<string, string>;
    } {
        const outputDir = temporaryDirectory();
        const outputs: Record<string, string> = {
            'embedded_mpv.node': readelfDynamic([['NEEDED', 'libX11.so.6']]),
            'embedded_mpv_frame_reader.node': readelfDynamic([]),
            iptvnator_mpv_helper: readelfDynamic([
                ['NEEDED', 'libmpv.so.2'],
                ['NEEDED', 'libEGL.so.1'],
                ['RUNPATH', '$ORIGIN/lib'],
            ]),
        };
        for (const artifact of Object.keys(outputs)) {
            writeFileSync(path.join(outputDir, artifact), 'ELF');
        }
        return {
            outputDir,
            outputs,
            readDynamicSection: (filePath: string) =>
                outputs[path.basename(filePath)],
        };
    }

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
