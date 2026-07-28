import type { MakeDirectoryOptions } from 'node:fs';
import { lstat, mkdir, rmdir } from 'node:fs/promises';
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from 'node:path';

import { assertXtreamSafePathIdentifier } from './xtream-exact-schema';

export const XTREAM_BENCHMARK_FORMAL_CDP_PORT = 9222;

const OUTPUT_TIMESTAMP =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(?:-[a-z][a-z0-9-]{0,63})?$/u;

export interface XtreamBenchmarkOutputLayout {
    readonly outputDirectory: string;
    readonly outputRoot: string;
    readonly performanceRoot: string;
}

export type XtreamMkdir = (
    path: string,
    options?: MakeDirectoryOptions
) => Promise<string | undefined | void>;

export function resolveXtreamBenchmarkOutputLayout(
    repositoryRoot: string,
    requestedRoot: string,
    variant: string
): XtreamBenchmarkOutputLayout {
    const root = resolve(repositoryRoot);
    const performanceRoot = join(root, 'dist', 'performance');
    const outputRoot = resolve(requestedRoot);
    if (
        !isAbsolute(repositoryRoot) ||
        !isAbsolute(requestedRoot) ||
        requestedRoot !== outputRoot ||
        dirname(outputRoot) !== performanceRoot ||
        !isValidTimestampDirectory(basename(outputRoot))
    ) {
        throw new Error(
            'Performance output must be an absolute fresh timestamp path below dist/performance'
        );
    }
    try {
        assertXtreamSafePathIdentifier(variant, 'variant');
    } catch {
        throw new Error('IPTVNATOR_PERF_VARIANT must be a safe Xtream variant');
    }
    const outputDirectory = join(outputRoot, variant);
    if (!isStrictDescendant(outputRoot, outputDirectory)) {
        throw new Error('IPTVNATOR_PERF_VARIANT must be a safe Xtream variant');
    }
    return Object.freeze({ outputDirectory, outputRoot, performanceRoot });
}

export function resolveXtreamBenchmarkCdpPort(
    mode: 'formal' | 'smoke',
    requestedPort: string | undefined
): number {
    const port =
        requestedPort === undefined
            ? XTREAM_BENCHMARK_FORMAL_CDP_PORT
            : Number(requestedPort);
    if (
        (requestedPort !== undefined && !/^[1-9]\d*$/u.test(requestedPort)) ||
        !Number.isSafeInteger(port) ||
        port < 1024 ||
        port > 65_535
    ) {
        throw new Error('IPTVNATOR_PERF_CDP_PORT is invalid');
    }
    if (mode === 'formal' && port !== XTREAM_BENCHMARK_FORMAL_CDP_PORT) {
        throw new Error(
            `Formal Xtream performance runs require CDP port ${XTREAM_BENCHMARK_FORMAL_CDP_PORT}`
        );
    }
    return port;
}

export async function assertXtreamBenchmarkOutputPathHasNoSymlinks(
    repositoryRoot: string,
    outputRoot: string
): Promise<void> {
    const root = resolve(repositoryRoot);
    const output = resolve(outputRoot);
    if (!isStrictDescendant(root, output)) {
        throw new Error('Xtream performance output escapes the repository');
    }
    const components = relative(root, output).split(sep);
    let current = root;
    for (const component of ['', ...components]) {
        current = component ? join(current, component) : current;
        try {
            if ((await lstat(current)).isSymbolicLink()) {
                throw new Error(
                    `Xtream performance output contains a symbolic link: ${current}`
                );
            }
        } catch (error) {
            if (isMissingPath(error)) return;
            throw error;
        }
    }
}

export async function createExclusiveXtreamBenchmarkOutputLayout(
    repositoryRoot: string,
    layout: XtreamBenchmarkOutputLayout,
    createDirectory: XtreamMkdir = mkdir
): Promise<void> {
    await createDirectory(layout.performanceRoot, {
        mode: 0o700,
        recursive: true,
    });
    await assertXtreamBenchmarkOutputPathHasNoSymlinks(
        repositoryRoot,
        layout.outputRoot
    );
    await createDirectory(layout.outputRoot, {
        mode: 0o700,
        recursive: false,
    });
    try {
        await createDirectory(layout.outputDirectory, {
            mode: 0o700,
            recursive: false,
        });
    } catch (error) {
        await rmdir(layout.outputRoot).catch(() => undefined);
        throw error;
    }
    await assertXtreamBenchmarkOutputPathHasNoSymlinks(
        repositoryRoot,
        layout.outputDirectory
    );
}

function isValidTimestampDirectory(value: string): boolean {
    const match = OUTPUT_TIMESTAMP.exec(value);
    if (!match) return false;
    const [, year, month, day, hour, minute, second] = match;
    const timestamp = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
    );
    return (
        Number.isFinite(timestamp) &&
        new Date(timestamp).toISOString().replace(/[-:]/gu, '').slice(0, 15) ===
            `${year}${month}${day}T${hour}${minute}${second}`
    );
}

function isStrictDescendant(parent: string, candidate: string): boolean {
    const pathFromParent = relative(resolve(parent), resolve(candidate));
    return (
        pathFromParent.length > 0 &&
        pathFromParent !== '..' &&
        !pathFromParent.startsWith(`..${sep}`) &&
        !isAbsolute(pathFromParent)
    );
}

function isMissingPath(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
    );
}
