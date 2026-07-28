import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { readXtreamSafeRegularFile } from './xtream-safe-file-read';

export interface XtreamBuildFileIdentity {
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
}

export interface XtreamBuildPairIdentity {
    readonly javascript: XtreamBuildFileIdentity;
    readonly sourceMap: XtreamBuildFileIdentity;
}

export interface XtreamBenchmarkBuildIdentity {
    readonly electron: {
        readonly databaseWorker: XtreamBuildPairIdentity;
        readonly main: XtreamBuildPairIdentity;
        readonly playlistRefreshWorker: XtreamBuildPairIdentity;
        readonly preload: XtreamBuildPairIdentity;
    };
    readonly renderer: {
        readonly aggregateSha256: string;
        readonly bytes: number;
        readonly executableJavaScriptCount: number;
        readonly files: readonly XtreamBuildFileIdentity[];
        readonly sourceMapCount: number;
    };
}

const BACKEND_ROOT = 'dist/apps/electron-backend';
const RENDERER_ROOT = 'dist/apps/web';
const ELECTRON_PATHS = {
    databaseWorker: `${BACKEND_ROOT}/workers/database.worker.js`,
    main: `${BACKEND_ROOT}/main.js`,
    playlistRefreshWorker: `${BACKEND_ROOT}/workers/playlist-refresh.worker.js`,
    preload: `${BACKEND_ROOT}/main.preload.js`,
} as const;

export async function captureXtreamBuildIdentity(
    workspaceRoot: string
): Promise<XtreamBenchmarkBuildIdentity> {
    try {
        if (!isAbsolute(workspaceRoot)) invalid();
        const [databaseWorker, main, playlistRefreshWorker, preload, renderer] =
            await Promise.all([
                readPair(workspaceRoot, ELECTRON_PATHS.databaseWorker),
                readPair(workspaceRoot, ELECTRON_PATHS.main),
                readPair(workspaceRoot, ELECTRON_PATHS.playlistRefreshWorker),
                readPair(workspaceRoot, ELECTRON_PATHS.preload),
                readRenderer(workspaceRoot),
            ]);
        return Object.freeze({
            electron: Object.freeze({
                databaseWorker,
                main,
                playlistRefreshWorker,
                preload,
            }),
            renderer,
        });
    } catch {
        throw new Error('invalid Xtream performance build');
    }
}

export function computeXtreamBuildFilesAggregate(
    files: readonly XtreamBuildFileIdentity[]
): string {
    try {
        const length = Reflect.get(files, 'length') as unknown;
        if (
            !Number.isSafeInteger(length) ||
            Number(length) <= 0 ||
            Number(length) > 10_000
        ) {
            invalid();
        }
        const snapshot = Array.from({ length: Number(length) }, (_, index) => {
            const value = Reflect.get(files, String(index)) as
                XtreamBuildFileIdentity | undefined;
            if (
                !value ||
                !Number.isSafeInteger(value.bytes) ||
                value.bytes < 0 ||
                typeof value.path !== 'string' ||
                value.path.length === 0 ||
                typeof value.sha256 !== 'string' ||
                !/^[a-f0-9]{64}$/u.test(value.sha256)
            ) {
                invalid();
            }
            return [value.path, value.bytes, value.sha256] as const;
        });
        return sha256(Buffer.from(JSON.stringify(snapshot), 'utf8'));
    } catch {
        throw new Error('invalid Xtream build file identity');
    }
}

async function readPair(
    workspaceRoot: string,
    javascriptPath: string
): Promise<XtreamBuildPairIdentity> {
    const [javascript, sourceMap] = await Promise.all([
        readIdentity(workspaceRoot, javascriptPath),
        readIdentity(workspaceRoot, `${javascriptPath}.map`),
    ]);
    return Object.freeze({ javascript, sourceMap });
}

async function readRenderer(
    workspaceRoot: string
): Promise<XtreamBenchmarkBuildIdentity['renderer']> {
    const rendererDirectory = join(workspaceRoot, RENDERER_ROOT);
    const namesBefore = await readRendererNames(rendererDirectory);
    assertRendererPairing(namesBefore);
    const relativePaths = namesBefore.map((name) => `${RENDERER_ROOT}/${name}`);
    const files = await Promise.all(
        relativePaths.map((path) => readIdentity(workspaceRoot, path))
    );
    const namesAfter = await readRendererNames(rendererDirectory);
    if (
        namesAfter.length !== namesBefore.length ||
        namesAfter.some((name, index) => name !== namesBefore[index])
    ) {
        invalid();
    }
    const executableJavaScriptCount = namesBefore.filter((name) =>
        name.endsWith('.js')
    ).length;
    const sourceMapCount = namesBefore.filter((name) =>
        name.endsWith('.js.map')
    ).length;
    const bytes = files.reduce((total, file) => total + file.bytes, 0);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) invalid();
    const frozenFiles = Object.freeze(files);
    return Object.freeze({
        aggregateSha256: computeXtreamBuildFilesAggregate(frozenFiles),
        bytes,
        executableJavaScriptCount,
        files: frozenFiles,
        sourceMapCount,
    });
}

async function readRendererNames(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const relevant = entries.filter(
        (entry) =>
            entry.name === 'index.html' ||
            entry.name.endsWith('.js') ||
            entry.name.endsWith('.js.map')
    );
    if (
        relevant.some((entry) => !entry.isFile()) ||
        relevant.filter((entry) => entry.name === 'index.html').length !== 1
    ) {
        invalid();
    }
    return relevant.map((entry) => entry.name).sort();
}

function assertRendererPairing(names: readonly string[]): void {
    const javascript = names.filter((name) => name.endsWith('.js'));
    const sourceMaps = names.filter((name) => name.endsWith('.js.map'));
    const javascriptSet = new Set(javascript);
    const sourceMapSet = new Set(sourceMaps);
    if (
        javascript.length === 0 ||
        javascript.length !== sourceMaps.length ||
        javascript.some((name) => !sourceMapSet.has(`${name}.map`)) ||
        sourceMaps.some((name) => !javascriptSet.has(name.slice(0, -4)))
    ) {
        invalid();
    }
}

async function readIdentity(
    workspaceRoot: string,
    relativePath: string
): Promise<XtreamBuildFileIdentity> {
    const { content } = await readXtreamSafeRegularFile(
        join(workspaceRoot, relativePath)
    );
    return Object.freeze({
        bytes: content.byteLength,
        path: relativePath,
        sha256: sha256(content),
    });
}

function sha256(value: Uint8Array): string {
    return createHash('sha256').update(value).digest('hex');
}

function invalid(): never {
    throw new Error('invalid');
}
