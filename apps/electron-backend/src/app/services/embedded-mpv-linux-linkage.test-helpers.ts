import {
    existsSync,
    mkdtempSync,
    mkdirSync,
    rmSync,
    writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Shared fixtures for the Linux frame-copy linkage specs. The module under
 * test is the CommonJS build helper `embedded-mpv-linux-linkage.cjs`, loaded
 * through `createRequire` because it is packaging tooling rather than app code.
 */

const linkageModulePath = path.resolve(
    __dirname,
    '../../../embedded-mpv-linux-linkage.cjs'
);
const requireBuildHelper = createRequire(__filename);

export interface RuntimeFileRecord {
    name: string;
    size: number;
    sha256: string;
}

export interface SonameFixture {
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

export interface ArtifactFixture {
    outputDir: string;
    readDynamicSection: (filePath: string) => string;
    outputs: Record<string, string>;
}

export interface LinkageModule {
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
    resolveLinuxFrameCopyLinkageInputs: (options: {
        buildInputMode: string;
        outputLibDir: string;
        packagedLibmpvSoname: string | null;
        readDynamicSection: (filePath: string) => string;
        runtimeLibDir: string;
    }) => {
        expectedLibmpvSoname: string | null;
        linkerLibraryDir: string;
    };
    runWithCleanup: <T>(operation: () => T, cleanup: () => void) => T;
    validateLinuxFrameCopyLinkage: (options: {
        expectedLibmpvSoname: string;
        outputDir: string;
        readDynamicSection: (filePath: string) => string;
    }) => void;
}

export function loadLinkageModule(): LinkageModule {
    expect(existsSync(linkageModulePath)).toBe(true);
    return requireBuildHelper(linkageModulePath);
}

function sha256(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

export function runtimeFile(
    name: string,
    contents: Buffer
): RuntimeFileRecord {
    return {
        name,
        size: contents.byteLength,
        sha256: sha256(contents),
    };
}

/** Render a `readelf -d` style dynamic section from tag/value pairs. */
export function readelfDynamic(
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

/**
 * Temporary-directory registry. Specs call `createTemporaryDirectory()` while
 * building fixtures and `cleanupTemporaryDirectories()` from their `afterEach`.
 */
const temporaryDirectories: string[] = [];

export function createTemporaryDirectory(): string {
    const directory = mkdtempSync(
        path.join(tmpdir(), 'iptvnator-mpv-linkage-')
    );
    temporaryDirectories.push(directory);
    return directory;
}

export function cleanupTemporaryDirectories(): void {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
}

/** A verified libmpv copy: matching alias + exact-SONAME regular files. */
export function createSonameFixture(soname = 'libmpv.so.2'): SonameFixture {
    const outputLibDir = path.join(createTemporaryDirectory(), 'lib');
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

/** A built output directory with process-isolated linkage. */
export function createArtifactFixture(): ArtifactFixture {
    const outputDir = createTemporaryDirectory();
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
