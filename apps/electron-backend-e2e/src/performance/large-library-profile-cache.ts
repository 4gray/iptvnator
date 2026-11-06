import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

import {
    LARGE_LIBRARY_MANIFEST_FILE_NAME,
    LARGE_LIBRARY_MANIFEST_PREFIX,
    LARGE_LIBRARY_PROFILE_VERSION,
    resolveLargeLibraryProfileSpec,
    type LargeLibraryProfileManifest,
    type LargeLibraryProfileSpec,
} from './large-library-profile';

/**
 * Builds the large-library profile once per content hash and keeps it under
 * the cache root, so a run on an unchanged generator reuses the directory
 * instead of writing millions of rows again. The key covers everything the
 * rows depend on: the profile version and spec, the generator's own sources,
 * the database library's non-test sources (the schema and migrations the
 * profile is written through, so a schema change rebuilds the profile), and
 * the Electron, better-sqlite3 and drizzle-orm versions. CI restores the
 * directory from `actions/cache` with the same key (`--print-cache-key`).
 */
export const LARGE_LIBRARY_PROFILE_CACHE_ENV =
    'IPTVNATOR_LARGE_LIBRARY_PROFILE_CACHE';
export const LARGE_LIBRARY_PROFILE_CACHE_DEFAULT =
    'node_modules/.cache/iptvnator/large-library-profile';
const DATABASE_LIBRARY = 'libs/shared/database/src';
const GENERATOR_SOURCES = [
    'apps/electron-backend-e2e/src/performance/large-library-profile.ts',
    'apps/electron-backend-e2e/src/performance/large-library-profile-generator.ts',
];
const VERSIONED_PACKAGES = ['electron', 'better-sqlite3', 'drizzle-orm'];
/** A few million rows through the FTS triggers; generous for a slow runner. */
const GENERATION_TIMEOUT_MS = 30 * 60 * 1_000;

export interface LargeLibraryProfile {
    readonly cached: boolean;
    readonly cacheKey: string;
    /** The data directory holding `databases/iptvnator.db`; copy, never launch on it. */
    readonly directory: string;
    readonly manifest: LargeLibraryProfileManifest;
}

export interface LargeLibraryProfileCacheKeyInputs {
    readonly databaseLibrarySha256: string;
    readonly generatorSha256: string;
    readonly packages: Readonly<Record<string, string>>;
    readonly spec: LargeLibraryProfileSpec;
    readonly version: number;
}

function listSourceFiles(root: string): string[] {
    const files: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'testing') walk(path);
            } else if (
                entry.name.endsWith('.ts') &&
                !entry.name.endsWith('.spec.ts')
            ) {
                files.push(path);
            }
        }
    };
    walk(root);
    return files.sort();
}

function hashFiles(workspaceRoot: string, files: readonly string[]): string {
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(relative(workspaceRoot, file));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
    }
    return hash.digest('hex');
}

/** Read from the installed package: `exports` maps hide package.json. */
function packageVersion(workspaceRoot: string, name: string): string {
    const manifest = JSON.parse(
        readFileSync(
            join(workspaceRoot, 'node_modules', name, 'package.json'),
            'utf8'
        )
    ) as { version?: unknown };
    if (typeof manifest.version !== 'string') {
        throw new Error(`large-library-package-version-missing: ${name}`);
    }
    return manifest.version;
}

export function largeLibraryProfileCacheKeyInputs(
    workspaceRoot: string,
    spec: LargeLibraryProfileSpec
): LargeLibraryProfileCacheKeyInputs {
    return {
        databaseLibrarySha256: hashFiles(
            workspaceRoot,
            listSourceFiles(join(workspaceRoot, DATABASE_LIBRARY))
        ),
        generatorSha256: hashFiles(
            workspaceRoot,
            GENERATOR_SOURCES.map((file) => join(workspaceRoot, file))
        ),
        packages: Object.fromEntries(
            VERSIONED_PACKAGES.map((name) => [
                name,
                packageVersion(workspaceRoot, name),
            ])
        ),
        spec,
        version: LARGE_LIBRARY_PROFILE_VERSION,
    };
}

/** Pure: the key of a set of inputs, for the tests and the CLI alike. */
export function largeLibraryProfileCacheKey(
    inputs: LargeLibraryProfileCacheKeyInputs
): string {
    return createHash('sha256')
        .update(JSON.stringify(inputs))
        .digest('hex')
        .slice(0, 32);
}

export function resolveLargeLibraryProfileCacheRoot(
    workspaceRoot: string,
    env: Readonly<Record<string, string | undefined>> = process.env
): string {
    const override = env[LARGE_LIBRARY_PROFILE_CACHE_ENV]?.trim();
    return override
        ? resolve(workspaceRoot, override)
        : join(workspaceRoot, LARGE_LIBRARY_PROFILE_CACHE_DEFAULT);
}

export function readLargeLibraryProfileManifest(
    directory: string
): LargeLibraryProfileManifest | null {
    const manifestPath = join(directory, LARGE_LIBRARY_MANIFEST_FILE_NAME);
    const databasePath = join(directory, 'databases', 'iptvnator.db');
    if (!existsSync(manifestPath) || !existsSync(databasePath)) {
        return null;
    }
    const manifest = JSON.parse(
        readFileSync(manifestPath, 'utf8')
    ) as LargeLibraryProfileManifest;
    if (statSync(databasePath).size !== manifest.databaseBytes) {
        return null;
    }
    return manifest;
}

/** The last stdout line of the generator, as the manifest it printed. */
export function parseGeneratorManifest(
    stdout: string
): LargeLibraryProfileManifest {
    const line = stdout
        .split('\n')
        .reverse()
        .find((candidate) =>
            candidate.startsWith(LARGE_LIBRARY_MANIFEST_PREFIX)
        );
    if (line === undefined) {
        throw new Error('large-library-generator-manifest-missing');
    }
    return JSON.parse(
        line.slice(LARGE_LIBRARY_MANIFEST_PREFIX.length)
    ) as LargeLibraryProfileManifest;
}

async function runGenerator(
    workspaceRoot: string,
    outputDirectory: string,
    cacheKey: string,
    env: Readonly<Record<string, string | undefined>>
): Promise<LargeLibraryProfileManifest> {
    const electronPath = createRequire(join(workspaceRoot, 'package.json'))(
        'electron'
    ) as string;
    const generator = join(workspaceRoot, GENERATOR_SOURCES[1] as string);
    const stdout = await new Promise<string>((resolvePromise, reject) => {
        const child = execFile(
            electronPath,
            ['--import', 'tsx', generator, cacheKey],
            {
                cwd: workspaceRoot,
                encoding: 'utf8',
                env: {
                    ...env,
                    ELECTRON_RUN_AS_NODE: '1',
                    IPTVNATOR_E2E_DATA_DIR: outputDirectory,
                    TSX_TSCONFIG_PATH: join(
                        workspaceRoot,
                        'tsconfig.base.json'
                    ),
                },
                maxBuffer: 64 * 1024 * 1024,
                timeout: GENERATION_TIMEOUT_MS,
            },
            (error, out, err) => {
                if (error) {
                    reject(
                        new Error(
                            `large-library-generator-failed: ${error.message}\n${err}`
                        )
                    );
                    return;
                }
                resolvePromise(out);
            }
        );
        child.stderr?.on('data', (chunk: string) => {
            process.stderr.write(chunk);
        });
    });
    return parseGeneratorManifest(stdout);
}

/**
 * Returns the cached profile for the current inputs, generating it first
 * when the cache has none. A generation writes to a temporary sibling and
 * renames it into place only when it completed, so an interrupted run never
 * leaves a half-written profile under the key.
 */
export async function ensureLargeLibraryProfile(
    workspaceRoot: string,
    env: Readonly<Record<string, string | undefined>> = process.env
): Promise<LargeLibraryProfile> {
    const spec = resolveLargeLibraryProfileSpec(env);
    const cacheKey = largeLibraryProfileCacheKey(
        largeLibraryProfileCacheKeyInputs(workspaceRoot, spec)
    );
    const cacheRoot = resolveLargeLibraryProfileCacheRoot(workspaceRoot, env);
    const directory = join(cacheRoot, cacheKey);
    const cached = readLargeLibraryProfileManifest(directory);
    if (cached !== null && cached.cacheKey === cacheKey) {
        return { cached: true, cacheKey, directory, manifest: cached };
    }
    rmSync(directory, { force: true, recursive: true });
    const staging = join(cacheRoot, `.staging-${cacheKey}-${process.pid}`);
    rmSync(staging, { force: true, recursive: true });
    mkdirSync(staging, { recursive: true });
    try {
        const manifest = await runGenerator(
            workspaceRoot,
            staging,
            cacheKey,
            env
        );
        renameSync(staging, directory);
        return { cached: false, cacheKey, directory, manifest };
    } catch (failure) {
        rmSync(staging, { force: true, recursive: true });
        throw failure;
    }
}
