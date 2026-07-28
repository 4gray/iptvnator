import {
    computeXtreamBuildFilesAggregate,
    type XtreamBenchmarkBuildIdentity,
    type XtreamBuildFileIdentity,
    type XtreamBuildPairIdentity,
} from './xtream-build-identity';

const SHA256 = /^[a-f0-9]{64}$/u;
const RENDERER_FILE =
    /^dist\/apps\/web\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.js(?:\.map)?$/u;
const BUILD_KEYS = ['electron', 'renderer'] as const;
const ELECTRON_KEYS = [
    'databaseWorker',
    'main',
    'playlistRefreshWorker',
    'preload',
] as const;
const PAIR_KEYS = ['javascript', 'sourceMap'] as const;
const FILE_KEYS = ['bytes', 'path', 'sha256'] as const;
const RENDERER_KEYS = [
    'aggregateSha256',
    'bytes',
    'executableJavaScriptCount',
    'files',
    'sourceMapCount',
] as const;
const ELECTRON_PATHS = {
    databaseWorker: 'dist/apps/electron-backend/workers/database.worker.js',
    main: 'dist/apps/electron-backend/main.js',
    playlistRefreshWorker:
        'dist/apps/electron-backend/workers/playlist-refresh.worker.js',
    preload: 'dist/apps/electron-backend/main.preload.js',
} as const;

export function parseXtreamBenchmarkBuildIdentity(
    value: unknown
): XtreamBenchmarkBuildIdentity {
    try {
        const input = exactRecord(value, BUILD_KEYS);
        const electronInput = exactRecord(input['electron'], ELECTRON_KEYS);
        const rendererInput = exactRecord(input['renderer'], RENDERER_KEYS);
        const electron = Object.freeze({
            databaseWorker: pair(
                electronInput['databaseWorker'],
                ELECTRON_PATHS.databaseWorker
            ),
            main: pair(electronInput['main'], ELECTRON_PATHS.main),
            playlistRefreshWorker: pair(
                electronInput['playlistRefreshWorker'],
                ELECTRON_PATHS.playlistRefreshWorker
            ),
            preload: pair(electronInput['preload'], ELECTRON_PATHS.preload),
        });
        const renderer = rendererIdentity(rendererInput);
        return Object.freeze({ electron, renderer });
    } catch {
        throw new Error('invalid Xtream benchmark build identity');
    }
}

function pair(value: unknown, javascriptPath: string): XtreamBuildPairIdentity {
    const input = exactRecord(value, PAIR_KEYS);
    return Object.freeze({
        javascript: fileIdentity(input['javascript'], javascriptPath),
        sourceMap: fileIdentity(input['sourceMap'], `${javascriptPath}.map`),
    });
}

function rendererIdentity(
    input: Record<string, unknown>
): XtreamBenchmarkBuildIdentity['renderer'] {
    const files = exactArray(input['files']).map((value) =>
        fileIdentity(value)
    );
    if (
        files.length < 3 ||
        files.length > 10_000 ||
        !isStrictlySorted(files.map((file) => file.path))
    ) {
        invalid();
    }
    const indexFiles = files.filter(
        (file) => file.path === 'dist/apps/web/index.html'
    );
    const javascript = files.filter((file) => file.path.endsWith('.js'));
    const sourceMaps = files.filter((file) => file.path.endsWith('.js.map'));
    if (
        indexFiles.length !== 1 ||
        javascript.length === 0 ||
        files.length !== 1 + javascript.length + sourceMaps.length ||
        javascript.length !== sourceMaps.length ||
        javascript.some(
            (file) =>
                !sourceMaps.some(
                    (sourceMap) => sourceMap.path === `${file.path}.map`
                )
        ) ||
        sourceMaps.some(
            (sourceMap) =>
                !javascript.some(
                    (file) => file.path === sourceMap.path.slice(0, -4)
                )
        )
    ) {
        invalid();
    }
    const bytes = files.reduce((total, file) => total + file.bytes, 0);
    if (
        !isPositiveSafeInteger(input['bytes']) ||
        input['bytes'] !== bytes ||
        input['executableJavaScriptCount'] !== javascript.length ||
        input['sourceMapCount'] !== sourceMaps.length ||
        typeof input['aggregateSha256'] !== 'string' ||
        !SHA256.test(input['aggregateSha256']) ||
        input['aggregateSha256'] !== computeXtreamBuildFilesAggregate(files)
    ) {
        invalid();
    }
    return Object.freeze({
        aggregateSha256: input['aggregateSha256'],
        bytes,
        executableJavaScriptCount: javascript.length,
        files: Object.freeze(files),
        sourceMapCount: sourceMaps.length,
    }) as XtreamBenchmarkBuildIdentity['renderer'];
}

function fileIdentity(
    value: unknown,
    expectedPath?: string
): XtreamBuildFileIdentity {
    const input = exactRecord(value, FILE_KEYS);
    const path = input['path'];
    const validRendererPath =
        path === 'dist/apps/web/index.html' ||
        (typeof path === 'string' && RENDERER_FILE.test(path));
    if (
        !isPositiveSafeInteger(input['bytes']) ||
        typeof path !== 'string' ||
        (expectedPath === undefined
            ? !validRendererPath
            : path !== expectedPath) ||
        typeof input['sha256'] !== 'string' ||
        !SHA256.test(input['sha256'])
    ) {
        invalid();
    }
    return Object.freeze({
        bytes: input['bytes'],
        path,
        sha256: input['sha256'],
    }) as XtreamBuildFileIdentity;
}

function exactArray(value: unknown): unknown[] {
    if (!Array.isArray(value)) invalid();
    const length = Reflect.get(value, 'length') as unknown;
    if (
        !Number.isSafeInteger(length) ||
        Number(length) < 0 ||
        Number(length) > 10_000
    ) {
        invalid();
    }
    const expectedKeys = new Set([
        'length',
        ...Array.from({ length: Number(length) }, (_, index) => String(index)),
    ]);
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== expectedKeys.size ||
        keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
        invalid();
    }
    return Array.from({ length: Number(length) }, (_, index) =>
        Reflect.get(value, String(index))
    );
}

function exactRecord(
    value: unknown,
    expectedKeys: readonly string[]
): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid();
    }
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== expectedKeys.length ||
        keys.some(
            (key) => typeof key !== 'string' || !expectedKeys.includes(key)
        )
    ) {
        invalid();
    }
    return Object.fromEntries(
        expectedKeys.map((key) => [key, Reflect.get(value, key)])
    );
}

function isStrictlySorted(values: readonly string[]): boolean {
    return values.every(
        (value, index) => index === 0 || (values[index - 1] ?? '') < value
    );
}

function isPositiveSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function invalid(): never {
    throw new Error('invalid');
}
