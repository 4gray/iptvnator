import { existsSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

const WORKER_RELATIVE_PATH = [
    'dist',
    'apps',
    'electron-backend',
    'workers',
] as const;

const NATIVE_MODULE_RELATIVE_PATHS = [
    ['app.asar.unpacked', 'node_modules'],
    ['app.asar.unpacked', 'electron-backend', 'node_modules'],
    ['app.asar.unpacked', 'dist', 'apps', 'electron-backend', 'node_modules'],
] as const;

type FileExists = (filePath: string) => boolean;
type ModuleRequireFactory = typeof createRequire;
type NodeModuleApi = {
    globalPaths: string[];
    _initPaths?: () => void;
};

export interface WorkerBootstrapData {
    nativeModuleSearchPaths?: string[];
}

export interface ResolveWorkerRuntimeBootstrapOptions {
    isPackaged: boolean;
    workerFilename: string;
    developmentWorkerDir: string;
    resourcesPath?: string;
    appPath?: string;
    fileExists?: FileExists;
}

export interface WorkerRuntimeBootstrap {
    workerPath: string;
    workerPathCandidates: string[];
    nativeModuleSearchPaths?: string[];
}

export interface LoadNativeModuleOptions<TModule> {
    moduleName: string;
    searchPaths: string[];
    loggerLabel: string;
    fallbackRequire?: () => TModule;
    fileExists?: FileExists;
    requireFactory?: ModuleRequireFactory;
}

function dedupePaths(paths: Array<string | undefined>): string[] {
    return [...new Set(paths.filter((value): value is string => Boolean(value)))];
}

export function registerNativeModuleSearchPaths(
    searchPaths: string[],
    options?: {
        env?: NodeJS.ProcessEnv;
        moduleApi?: NodeModuleApi;
    }
): string[] {
    const env = options?.env ?? process.env;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const moduleApi =
        options?.moduleApi ??
        (require('module') as NodeModuleApi);

    const mergedPaths = dedupePaths([
        ...searchPaths,
        ...(env.NODE_PATH?.split(path.delimiter) ?? []),
        ...moduleApi.globalPaths,
    ]);

    if (mergedPaths.length === 0) {
        return [];
    }

    env.NODE_PATH = mergedPaths.join(path.delimiter);

    if (typeof moduleApi._initPaths === 'function') {
        moduleApi._initPaths();
    } else {
        moduleApi.globalPaths.splice(0, moduleApi.globalPaths.length, ...mergedPaths);
    }

    for (let index = mergedPaths.length - 1; index >= 0; index -= 1) {
        const currentPath = mergedPaths[index];

        if (!moduleApi.globalPaths.includes(currentPath)) {
            moduleApi.globalPaths.unshift(currentPath);
        }
    }

    return mergedPaths;
}

export function getPackagedResourceRoots(options: {
    resourcesPath?: string;
    appPath?: string;
}): string[] {
    return dedupePaths([
        options.resourcesPath,
        options.appPath ? path.dirname(options.appPath) : undefined,
    ]);
}

export function getNativeModuleSearchPaths(options: {
    resourcesPath?: string;
    appPath?: string;
}): string[] {
    return dedupePaths(
        getPackagedResourceRoots(options).flatMap((root) =>
            NATIVE_MODULE_RELATIVE_PATHS.map((segments) =>
                path.join(root, ...segments)
            )
        )
    );
}

export function getPackagedWorkerPathCandidates(options: {
    workerFilename: string;
    resourcesPath?: string;
    appPath?: string;
}): string[] {
    return dedupePaths(
        getPackagedResourceRoots(options).map((root) =>
            path.join(root, ...WORKER_RELATIVE_PATH, options.workerFilename)
        )
    );
}

function createWorkerResolutionError(
    workerFilename: string,
    workerPathCandidates: string[]
): Error {
    const error = new Error(
        [
            `Unable to resolve worker "${workerFilename}".`,
            'Tried:',
            ...workerPathCandidates.map((candidate) => `- ${candidate}`),
        ].join('\n')
    );
    error.name = 'WorkerPathResolutionError';
    return error;
}

export function resolveWorkerRuntimeBootstrap(
    options: ResolveWorkerRuntimeBootstrapOptions
): WorkerRuntimeBootstrap {
    const fileExists = options.fileExists ?? existsSync;

    if (!options.isPackaged) {
        const workerPath = path.join(
            options.developmentWorkerDir,
            options.workerFilename
        );
        const workerPathCandidates = [workerPath];

        if (!fileExists(workerPath)) {
            throw createWorkerResolutionError(
                options.workerFilename,
                workerPathCandidates
            );
        }

        return { workerPath, workerPathCandidates };
    }

    const workerPathCandidates = getPackagedWorkerPathCandidates(options);
    const workerPath = workerPathCandidates.find((candidate) =>
        fileExists(candidate)
    );

    if (!workerPath) {
        throw createWorkerResolutionError(
            options.workerFilename,
            workerPathCandidates
        );
    }

    return {
        workerPath,
        workerPathCandidates,
        nativeModuleSearchPaths: getNativeModuleSearchPaths(options),
    };
}

export function getWorkerDataNativeModuleSearchPaths(
    value: unknown
): string[] {
    if (!value || typeof value !== 'object') {
        return [];
    }

    if (!('nativeModuleSearchPaths' in value)) {
        return [];
    }

    const searchPaths = value.nativeModuleSearchPaths;
    if (!Array.isArray(searchPaths)) {
        return [];
    }

    return dedupePaths(
        searchPaths.filter(
            (searchPath): searchPath is string => typeof searchPath === 'string'
        )
    );
}

export function loadNativeModuleFromSearchPaths<TModule>(
    options: LoadNativeModuleOptions<TModule>
): TModule {
    const fileExists = options.fileExists ?? existsSync;
    const requireFactory = options.requireFactory ?? createRequire;
    const attemptedPaths: string[] = [];
    const failedPaths: string[] = [];

    for (const searchPath of dedupePaths(options.searchPaths)) {
        attemptedPaths.push(searchPath);

        if (!fileExists(searchPath)) {
            failedPaths.push(`${searchPath} (missing)`);
            continue;
        }

        try {
            const nativeRequire = requireFactory(
                path.join(searchPath, 'index.js')
            );
            return nativeRequire(options.moduleName) as TModule;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            failedPaths.push(`${searchPath} (${message})`);
        }
    }

    if (options.fallbackRequire) {
        try {
            return options.fallbackRequire();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            failedPaths.push(`require(${options.moduleName}) (${message})`);
        }
    }

    const error = new Error(
        [
            `${options.loggerLabel} Unable to load native module "${options.moduleName}".`,
            'Tried:',
            ...attemptedPaths.map((searchPath) => `- ${searchPath}`),
            ...(failedPaths.length > 0 ? ['Failures:', ...failedPaths.map((failure) => `- ${failure}`)] : []),
        ].join('\n')
    );
    error.name = 'NativeModuleResolutionError';
    throw error;
}
