import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { workspaceRoot as defaultWorkspaceRoot } from '../electron-test-fixtures';
import type {
    XtreamBenchmarkManifest,
    XtreamBenchmarkRuntime,
    XtreamBenchmarkSource,
    XtreamPerformanceManifest,
} from './xtream-benchmark-contract';
import { parseXtreamBenchmarkManifest } from './xtream-benchmark-manifest-schema';
import {
    captureXtreamBuildIdentity,
    type XtreamBenchmarkBuildIdentity,
} from './xtream-build-identity';
import { parseXtreamBenchmarkBuildIdentity } from './xtream-build-identity-schema';
import { parseXtreamManifest } from './xtream-control-state-schema';
import {
    assertXtreamBenchmarkOutputPathHasNoSymlinks,
    createExclusiveXtreamBenchmarkOutputLayout,
    resolveXtreamBenchmarkCdpPort,
    resolveXtreamBenchmarkOutputLayout,
    type XtreamMkdir,
} from './xtream-benchmark-output-configuration';
import {
    assertPerformanceArtifactCapacity,
    type PerformanceArtifactCapacity,
} from './performance-artifact-preflight';
import { XTREAM_MEMORY_ACCOUNTING } from './xtream-summary-contract';

export const XTREAM_BENCHMARK_MOCK_ORIGIN = 'http://127.0.0.1:3221';
const CONTROL_TOKEN = /^[A-Za-z0-9_-]{43,128}$/u;

export {
    assertXtreamBenchmarkOutputPathHasNoSymlinks,
    resolveXtreamBenchmarkCdpPort,
    resolveXtreamBenchmarkOutputLayout,
    XTREAM_BENCHMARK_FORMAL_CDP_PORT,
} from './xtream-benchmark-output-configuration';

export interface XtreamBenchmarkConfiguration {
    readonly build: XtreamBenchmarkBuildIdentity;
    readonly cdpPort: number;
    /** Control-plane secret. Never serialize or log this field. */
    readonly controlToken: string;
    readonly electronVersion: string;
    readonly measuredRuns: 1 | 5;
    readonly mockOrigin: typeof XTREAM_BENCHMARK_MOCK_ORIGIN;
    readonly mode: 'formal' | 'smoke';
    readonly outputDirectory: string;
    readonly outputRoot: string;
    readonly runtime: XtreamBenchmarkRuntime;
    readonly smoke: boolean;
    readonly source: XtreamBenchmarkSource;
    readonly variant: string;
    readonly workspaceRoot: string;
}

type XtreamGitSourceState = XtreamBenchmarkSource;

interface XtreamConfigurationDependencies {
    readonly assertCapacity?: (
        targetPath: string
    ) => Promise<PerformanceArtifactCapacity>;
    readonly captureBuildIdentity?: (
        workspaceRoot: string
    ) => Promise<XtreamBenchmarkBuildIdentity>;
    readonly mkdir?: XtreamMkdir;
    readonly readElectronVersion?: (workspaceRoot: string) => Promise<string>;
    readonly readGitSourceState?: (
        workspaceRoot: string
    ) => XtreamGitSourceState;
}

export interface ResolveXtreamBenchmarkConfigurationOptions {
    readonly dependencies?: XtreamConfigurationDependencies;
    readonly environment?: NodeJS.ProcessEnv;
    readonly workspaceRoot?: string;
}

export async function resolveXtreamBenchmarkConfiguration(
    options: ResolveXtreamBenchmarkConfigurationOptions = {}
): Promise<XtreamBenchmarkConfiguration> {
    const environment = options.environment ?? process.env;
    const repositoryRoot = resolve(
        options.workspaceRoot ?? defaultWorkspaceRoot
    );
    const requestedRoot = environment['IPTVNATOR_PERF_OUTPUT_DIR'];
    if (!requestedRoot) {
        throw new Error('IPTVNATOR_PERF_OUTPUT_DIR is required');
    }
    const smoke = resolveSmokeMode(environment['IPTVNATOR_PERF_SMOKE']);
    const mode = smoke ? 'smoke' : 'formal';
    const variant = environment['IPTVNATOR_PERF_VARIANT'] ?? 'baseline';
    const layout = resolveXtreamBenchmarkOutputLayout(
        repositoryRoot,
        requestedRoot,
        variant
    );
    const cdpPort = resolveXtreamBenchmarkCdpPort(
        mode,
        environment['IPTVNATOR_PERF_CDP_PORT']
    );
    const controlToken =
        environment['IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN'] ?? '';
    if (!CONTROL_TOKEN.test(controlToken)) {
        throw new Error(
            'Xtream benchmark requires a high-entropy mock control token'
        );
    }

    const dependencies = options.dependencies ?? {};
    const readSource = dependencies.readGitSourceState ?? readGitSourceState;
    const source = Object.freeze(readSource(repositoryRoot));
    assertSourceState(mode, source);
    const captureBuild =
        dependencies.captureBuildIdentity ?? captureXtreamBuildIdentity;
    const build = parseXtreamBenchmarkBuildIdentity(
        await captureBuild(repositoryRoot)
    );
    const electronVersion = await (
        dependencies.readElectronVersion ?? readElectronRuntimeVersion
    )(repositoryRoot);
    if (!electronVersion.trim()) {
        throw new Error('Unable to resolve the Electron runtime version');
    }

    await assertXtreamBenchmarkOutputPathHasNoSymlinks(
        repositoryRoot,
        layout.outputRoot
    );
    await (dependencies.assertCapacity ?? assertPerformanceArtifactCapacity)(
        layout.outputDirectory
    );
    await createExclusiveXtreamBenchmarkOutputLayout(
        repositoryRoot,
        layout,
        dependencies.mkdir ?? mkdir
    );

    const runtime = Object.freeze({
        arch: process.arch,
        electronVersion,
        harnessNodeVersion: process.versions.node,
        platform: process.platform,
    });
    return Object.freeze({
        build,
        cdpPort,
        controlToken,
        electronVersion,
        measuredRuns: smoke ? 1 : 5,
        mockOrigin: XTREAM_BENCHMARK_MOCK_ORIGIN,
        mode,
        outputDirectory: layout.outputDirectory,
        outputRoot: layout.outputRoot,
        runtime,
        smoke,
        source,
        variant,
        workspaceRoot: repositoryRoot,
    });
}

export function createXtreamBenchmarkManifest(
    configuration: XtreamBenchmarkConfiguration,
    preparedFixture: unknown
): XtreamBenchmarkManifest {
    let fixture: XtreamPerformanceManifest;
    try {
        fixture = parseXtreamManifest(preparedFixture);
    } catch {
        throw new Error('invalid Xtream performance fixture');
    }
    return parseXtreamBenchmarkManifest({
        build: configuration.build,
        environment: {
            cdpAddress: '127.0.0.1',
            cdpPort: configuration.cdpPort,
            databaseWorkerBatchDelayMs: 0,
            exposeGc: true,
            freshUserDataPerIteration: true,
            perfCapture: '1',
            perfWorkerProfiling: '1',
            traceRendererConsole: '0',
        },
        fixture: {
            bytes: fixture.bytes,
            catalogSha256: fixture.catalogSha256,
            categories: fixture.counts.categories.total,
            items: fixture.counts.items.total,
            scenario: fixture.scenario,
            seed: fixture.seed,
        },
        memoryAccounting: XTREAM_MEMORY_ACCOUNTING,
        mode: configuration.mode,
        runtime: configuration.runtime,
        source: configuration.source,
        suite: 'xtream-performance-100k',
        variant: configuration.variant,
    });
}

export async function assertXtreamBenchmarkBuildUnchanged(
    configuration: XtreamBenchmarkConfiguration,
    capture: (
        workspaceRoot: string
    ) => Promise<XtreamBenchmarkBuildIdentity> = captureXtreamBuildIdentity
): Promise<void> {
    let current: XtreamBenchmarkBuildIdentity;
    try {
        current = parseXtreamBenchmarkBuildIdentity(
            await capture(configuration.workspaceRoot)
        );
    } catch {
        throw new Error('Xtream performance build changed during the suite');
    }
    if (!isDeepStrictEqual(configuration.build, current)) {
        throw new Error('Xtream performance build changed during the suite');
    }
}

function resolveSmokeMode(value: string | undefined): boolean {
    if (value === undefined) return false;
    if (value === '1') return true;
    throw new Error('IPTVNATOR_PERF_SMOKE is invalid');
}

function assertSourceState(
    mode: 'formal' | 'smoke',
    source: XtreamGitSourceState
): void {
    if (mode === 'formal' && source.gitDirty) {
        throw new Error(
            'Formal Xtream performance runs require a clean Git worktree'
        );
    }
}

function readGitSourceState(repositoryRoot: string): XtreamGitSourceState {
    const git = (arguments_: readonly string[]): string =>
        execFileSync('git', [...arguments_], {
            cwd: repositoryRoot,
            encoding: 'utf8',
        });
    const gitCommit = git(['rev-parse', 'HEAD']).trim();
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    const gitDiffSha256 = createHash('sha256')
        .update(status)
        .update('\0')
        .update(git(['diff', '--binary', 'HEAD']))
        .update('\0')
        .update(git(['diff', '--binary', '--cached', 'HEAD']))
        .digest('hex');
    return Object.freeze({
        gitCommit,
        gitDiffSha256,
        gitDirty: status.trim().length > 0,
    });
}

async function readElectronRuntimeVersion(
    repositoryRoot: string
): Promise<string> {
    const value = JSON.parse(
        await readFile(
            join(repositoryRoot, 'node_modules', 'electron', 'package.json'),
            'utf8'
        )
    ) as { version?: unknown };
    if (typeof value.version !== 'string' || !value.version.trim()) {
        throw new Error('Unable to resolve the Electron runtime version');
    }
    return value.version;
}
