/**
 * V8 compile cache for the Electron main process.
 *
 * `dist/apps/electron-backend/main.js` is built from `main.entry.ts`. It
 * enables Node's on-disk compile cache and only then requires the real
 * application bundle, `main.app.js` (built from `main.ts`), so the bundle and
 * the packages it pulls in are compiled from cached bytecode on every launch
 * after the first. V8 produces a code cache for the script it is compiling,
 * which is why the call cannot live inside the bundle it is meant to cache.
 *
 * This module holds the decision logic so the entry stays a few lines and the
 * guards are unit-testable: an environment kill switch, an explicit cache
 * directory, and failure tolerance (a broken cache must never block startup).
 */
import { join } from 'node:path';

export const COMPILE_CACHE_DISABLE_ENV = 'IPTVNATOR_DISABLE_COMPILE_CACHE';
export const COMPILE_CACHE_DIR_ENV = 'IPTVNATOR_COMPILE_CACHE_DIR';
export const COMPILE_CACHE_DIR_NAME = 'v8-compile-cache';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const OUTCOME_KEY = Symbol.for('iptvnator.compileCacheOutcome');

/** `module.constants.compileCacheStatus` of Node 22.1+, by value. */
const NODE_STATUS = {
    FAILED: 0,
    ENABLED: 1,
    ALREADY_ENABLED: 2,
    DISABLED: 3,
} as const;

export type CompileCacheStatus =
    'enabled' | 'already-enabled' | 'disabled' | 'unavailable' | 'failed';

export interface CompileCacheOutcome {
    readonly status: CompileCacheStatus;
    readonly directory?: string;
    readonly reason?: string;
}

export interface CompileCacheEnableResult {
    readonly status: number;
    readonly directory?: string;
    readonly message?: string;
}

/** The slice of `node:module` the entry relies on; injectable for tests. */
export interface CompileCacheModule {
    enableCompileCache?: (directory?: string) => CompileCacheEnableResult;
}

export interface EnableCompileCacheOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly module: CompileCacheModule;
    /** Electron's `userData`; only consulted without an explicit directory. */
    readonly userDataPath: () => string;
}

export function isCompileCacheDisabled(
    env: NodeJS.ProcessEnv = process.env
): boolean {
    const value = env[COMPILE_CACHE_DISABLE_ENV]?.trim().toLowerCase();
    return value ? TRUE_VALUES.has(value) : false;
}

export function resolveCompileCacheDirectory(
    env: NodeJS.ProcessEnv,
    userDataPath: () => string
): string {
    const explicit = env[COMPILE_CACHE_DIR_ENV]?.trim();
    if (explicit) {
        return explicit;
    }

    // Mirrors getElectronUserDataPath() in @iptvnator/shared/database, which
    // profile bootstrap applies later. The entry cannot import that library
    // without loading the database stack ahead of the cache.
    const e2eDataDir = env.IPTVNATOR_E2E_DATA_DIR?.trim();
    const userData = e2eDataDir
        ? join(e2eDataDir, 'user-data')
        : userDataPath();
    return join(userData, COMPILE_CACHE_DIR_NAME);
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function enableStartupCompileCache(
    options: EnableCompileCacheOptions
): CompileCacheOutcome {
    const env = options.env ?? process.env;
    if (isCompileCacheDisabled(env)) {
        return { status: 'disabled', reason: COMPILE_CACHE_DISABLE_ENV };
    }

    const enable = options.module.enableCompileCache;
    if (typeof enable !== 'function') {
        return {
            status: 'unavailable',
            reason: 'module.enableCompileCache is missing',
        };
    }

    let directory: string | undefined;
    try {
        directory = resolveCompileCacheDirectory(env, options.userDataPath);
        const result = enable.call(options.module, directory);
        switch (result.status) {
            case NODE_STATUS.ENABLED:
                return {
                    status: 'enabled',
                    directory: result.directory ?? directory,
                };
            case NODE_STATUS.ALREADY_ENABLED:
                return {
                    status: 'already-enabled',
                    directory: result.directory ?? directory,
                };
            case NODE_STATUS.DISABLED:
                return {
                    status: 'disabled',
                    reason: result.message ?? 'NODE_DISABLE_COMPILE_CACHE',
                };
            default:
                return {
                    status: 'failed',
                    directory,
                    reason: result.message ?? `status ${result.status}`,
                };
        }
    } catch (error) {
        return { status: 'failed', directory, reason: describeError(error) };
    }
}

/** Hands the entry's outcome to the bundle, which owns the startup trace. */
export function publishCompileCacheOutcome(outcome: CompileCacheOutcome): void {
    (globalThis as Record<symbol, unknown>)[OUTCOME_KEY] = outcome;
}

export function readCompileCacheOutcome(): CompileCacheOutcome {
    const outcome = (globalThis as Record<symbol, unknown>)[OUTCOME_KEY] as
        CompileCacheOutcome | undefined;
    return (
        outcome ?? { status: 'unavailable', reason: 'main.entry did not run' }
    );
}
