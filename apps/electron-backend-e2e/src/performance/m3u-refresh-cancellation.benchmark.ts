/* eslint-disable max-lines -- Benchmark lifecycle, local fixture server, and artifact safeguards stay auditable in one entry point. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    access,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { expect, type ConsoleMessage, type Page } from '@playwright/test';

import {
    closeElectronApp,
    launchElectronApp,
    openSources,
    sourceRowByTitle,
    waitForM3uCatalog,
    type LaunchedElectronApp,
} from '../electron-test-fixtures';
import type {
    CancellationBenchmarkManifest,
    CancellationIterationResult,
    PerformanceIterationKind,
} from './m3u-refresh-cancellation-contract';
import { PERFORMANCE_ITERATION_KIND } from './m3u-refresh-cancellation-contract';
import {
    createCancellationBenchmarkSummary,
    createCancellationIterationResult,
} from './m3u-refresh-cancellation-report';
import { assertPerformanceArtifactCapacity } from './performance-artifact-preflight';
import {
    installMainCapture,
    readMainCaptureStatus,
    startMainCapture,
    stopMainCapture,
} from './m3u-refresh-main-capture';
import { startRendererCapture } from './m3u-refresh-renderer-capture';
import type { RendererWindowIdentity } from './renderer-window-rss-session';
import {
    createSyntheticM3uFixture,
    SYNTHETIC_M3U_CHANNEL_COUNT,
    SYNTHETIC_M3U_SEED,
    type SyntheticM3uFixture,
} from './synthetic-m3u';

const SCENARIO = 'm3u-refresh-cancel';
const SOURCE_TITLE = 'Synthetic M3U cancellation 100k';
const RESOURCE_PATH = '/synthetic-performance.m3u';
const DEFAULT_MEASURED_RUNS = 5;
const DEFAULT_WARMUP_RUNS = 1;
const OUTPUT_VARIANT_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const RENDERER_CDP_PORT = 9222;

interface SyntheticServer {
    readonly resourceUrl: string;
    close(): Promise<void>;
    serveLargeFixture(): void;
    serveSeedFixture(): void;
}

interface BenchmarkConfiguration {
    readonly electronVersion: string;
    readonly gitCommit: string;
    readonly gitDiffSha256: string;
    readonly gitDirty: boolean;
    readonly measuredRuns: number;
    readonly outputDirectory: string;
    readonly variant: string;
    readonly warmupRuns: number;
    readonly workspaceRoot: string;
}

interface IterationDefinition {
    readonly kind: PerformanceIterationKind;
    readonly runId: string;
}

export async function runM3uRefreshCancellationBenchmark(): Promise<void> {
    const config = await resolveConfiguration();
    const fixture = createSyntheticM3uFixture();
    const server = await startSyntheticServer(fixture);
    const iterations: CancellationIterationResult[] = [];

    try {
        for (const definition of createIterationDefinitions(config)) {
            console.log(
                `[performance] ${config.variant}/${definition.runId} starting`
            );
            const result = await runIteration(config, definition, server);
            iterations.push(result);
            console.log(
                `[performance] ${definition.runId} total=${
                    result.phases.totalMs?.toFixed(3) ?? 'n/a'
                }ms cancelEffect=${result.cancellationEffectObserved}`
            );
        }
    } finally {
        await server.close();
    }

    const manifest: CancellationBenchmarkManifest = Object.freeze({
        channelCount: SYNTHETIC_M3U_CHANNEL_COUNT,
        fixtureBytes: fixture.bytes,
        fixtureSha256: fixture.sha256,
        gitCommit: config.gitCommit,
        gitDiffSha256: config.gitDiffSha256,
        gitDirty: config.gitDirty,
        measuredRuns: config.measuredRuns,
        memoryAccounting: Object.freeze({
            mainRss:
                'electron-main-process-including-worker-threads-and-native-memory',
            rendererRss: 'separate-renderer-process',
            workerJsHeap: 'separate-v8-isolate',
            workerRss: 'unavailable-per-thread',
        }),
        scenario: SCENARIO,
        syntheticSeed: SYNTHETIC_M3U_SEED,
        runtime: Object.freeze({
            arch: process.arch,
            electronVersion: config.electronVersion,
            harnessNodeVersion: process.versions.node,
            platform: process.platform,
        }),
        variant: config.variant,
        warmupRuns: config.warmupRuns,
    });
    const summary = createCancellationBenchmarkSummary(manifest, iterations);
    await writeJson(join(config.outputDirectory, 'manifest.json'), manifest);
    await writeJson(join(config.outputDirectory, 'summary.json'), summary);
    console.log(
        `[performance] completed: ${join(
            config.outputDirectory,
            'summary.json'
        )}`
    );
}

async function runIteration(
    config: BenchmarkConfiguration,
    definition: IterationDefinition,
    server: SyntheticServer
): Promise<CancellationIterationResult> {
    const iterationDirectory = join(config.outputDirectory, definition.runId);
    await assertPerformanceArtifactCapacity(iterationDirectory);
    await mkdir(iterationDirectory, { recursive: false });
    const dataDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-m3u-performance-')
    );
    let app: LaunchedElectronApp | null = null;
    let rendererConsoleListener: ((message: ConsoleMessage) => void) | null =
        null;

    try {
        await assertTcpPortAvailable(RENDERER_CDP_PORT);
        server.serveSeedFixture();
        app = await launchElectronApp(dataDirectory, {
            args: [
                '--js-flags=--expose-gc',
                '--remote-debugging-address=127.0.0.1',
                `--remote-debugging-port=${RENDERER_CDP_PORT}`,
                `--user-data-dir=${join(dataDirectory, 'user-data')}`,
            ],
            env: {
                IPTVNATOR_DB_WORKER_BATCH_DELAY_MS: '0',
                IPTVNATOR_PERF_CAPTURE: '1',
                IPTVNATOR_PERF_WORKER_PROFILING: '1',
                IPTVNATOR_TRACE_RENDERER_CONSOLE:
                    process.env['IPTVNATOR_TRACE_RENDERER_CONSOLE'] ?? '0',
            },
        });
        await assertRendererCdpTarget(app.mainWindow);
        app.mainWindow.setDefaultTimeout(120_000);
        await installMainCapture(app.electronApp);
        await seedPlaylist(app.mainWindow, server.resourceUrl);
        await waitForSeedSettlement(app);
        server.serveLargeFixture();
        const rendererRefreshErrors: string[] = [];
        rendererConsoleListener = (message) => {
            if (
                message.type() === 'error' &&
                message.text().includes('Error refreshing playlist:')
            ) {
                rendererRefreshErrors.push(message.text());
            }
        };
        app.mainWindow.on('console', rendererConsoleListener);

        const diagnostic =
            definition.kind === PERFORMANCE_ITERATION_KIND.DIAGNOSTIC;
        const rendererWindowIdentity = await resolveRendererWindowIdentity(app);
        await startMainCapture(app.electronApp, {
            diagnostic,
            outputDirectory: iterationDirectory,
            rendererWindowIdentity,
        });
        const renderer = await startRendererCapture(app.mainWindow, {
            diagnostic,
            outputDirectory: iterationDirectory,
            sourceTitle: SOURCE_TITLE,
        });

        await renderer.markOperationStart();
        const row = sourceRowByTitle(app.mainWindow, SOURCE_TITLE).first();
        await row.locator('.refresh-btn').click();
        await renderer.waitForCancelClick();
        await Promise.all([
            renderer.waitForTerminal(),
            waitForOperationSettlement(app),
        ]);
        expect(rendererRefreshErrors).toEqual([]);

        const [rendererMetrics, mainMetrics] = await Promise.all([
            renderer.stop(),
            stopMainCapture(app.electronApp),
        ]);
        const result = createCancellationIterationResult({
            kind: definition.kind,
            main: mainMetrics,
            renderer: rendererMetrics,
            runId: definition.runId,
        });
        await writeJson(join(iterationDirectory, 'result.json'), result);
        return result;
    } finally {
        if (app) {
            if (rendererConsoleListener) {
                app.mainWindow.off('console', rendererConsoleListener);
            }
            await closeElectronApp(app).catch((error: unknown) => {
                console.error('[performance] Electron cleanup failed', error);
            });
        }
        await rm(dataDirectory, { force: true, recursive: true });
    }
}

async function resolveRendererWindowIdentity(
    app: LaunchedElectronApp
): Promise<RendererWindowIdentity> {
    const browserWindowHandle = await app.electronApp.browserWindow(
        app.mainWindow
    );
    try {
        return await browserWindowHandle.evaluate((browserWindow) => {
            const exactWindow = browserWindow as unknown as {
                readonly id: number;
                readonly webContents: { readonly id: number };
            };
            return {
                browserWindowId: exactWindow.id,
                webContentsId: exactWindow.webContents.id,
            };
        });
    } finally {
        await browserWindowHandle.dispose();
    }
}

async function seedPlaylist(page: Page, playlistUrl: string): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).first().click();
    const dialog = page.locator('mat-dialog-container').last();
    await expect(
        dialog.getByRole('heading', { name: 'Add playlist' })
    ).toBeVisible();
    await dialog
        .getByRole('textbox', { name: 'Playlist URL (m3u, m3u8)' })
        .fill(playlistUrl);
    await dialog
        .getByRole('textbox', { name: 'Playlist title' })
        .fill(SOURCE_TITLE);
    await dialog.getByRole('button', { name: 'Add playlist' }).last().click();
    await expect(dialog).toBeHidden();
    await waitForM3uCatalog(page);
    await openSources(page);
    await expect(sourceRowByTitle(page, SOURCE_TITLE).first()).toBeVisible();
    await waitForTwoAnimationFrames(page);
}

async function waitForSeedSettlement(app: LaunchedElectronApp): Promise<void> {
    await expect
        .poll(
            async () =>
                (await readMainCaptureStatus(app.electronApp)).databasePending,
            { timeout: 120_000 }
        )
        .toBe(0);
    await waitForTwoAnimationFrames(app.mainWindow);
}

async function waitForOperationSettlement(
    app: LaunchedElectronApp
): Promise<void> {
    await expect
        .poll(
            async () => {
                const status = await readMainCaptureStatus(app.electronApp);
                if (status.playlistResponsesSucceeded > 0) {
                    return (
                        status.databaseUpsertsCompleted > 0 &&
                        status.databasePending === 0
                    );
                }
                return (
                    status.playlistTerminated > 0 &&
                    (status.playlistResponses === 0 ||
                        status.playlistResponsesFailed > 0)
                );
            },
            { timeout: 120_000 }
        )
        .toBe(true);
}

async function waitForTwoAnimationFrames(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>((resolvePromise) => {
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolvePromise())
                );
            })
    );
}

function createIterationDefinitions(
    config: BenchmarkConfiguration
): readonly IterationDefinition[] {
    const definitions: IterationDefinition[] = [];
    for (let index = 0; index < config.warmupRuns; index += 1) {
        definitions.push({
            kind: PERFORMANCE_ITERATION_KIND.WARMUP,
            runId: `warmup-${String(index + 1).padStart(2, '0')}`,
        });
    }
    for (let index = 0; index < config.measuredRuns; index += 1) {
        definitions.push({
            kind: PERFORMANCE_ITERATION_KIND.MEASURED,
            runId: `run-${String(index + 1).padStart(2, '0')}`,
        });
    }
    definitions.push({
        kind: PERFORMANCE_ITERATION_KIND.DIAGNOSTIC,
        runId: 'diagnostic',
    });
    return Object.freeze(definitions);
}

async function resolveConfiguration(): Promise<BenchmarkConfiguration> {
    const workspaceRoot = resolve(__dirname, '../../../..');
    const performanceRoot = join(workspaceRoot, 'dist', 'performance');
    const requestedRoot = process.env['IPTVNATOR_PERF_OUTPUT_DIR'];
    if (!requestedRoot) {
        throw new Error('IPTVNATOR_PERF_OUTPUT_DIR is required');
    }
    const outputRoot = resolve(requestedRoot);
    if (
        !isAbsolute(requestedRoot) ||
        !isStrictDescendant(performanceRoot, outputRoot)
    ) {
        throw new Error(
            'Performance output must be an absolute path below dist/performance'
        );
    }
    const variant = process.env['IPTVNATOR_PERF_VARIANT'] ?? 'baseline';
    if (!OUTPUT_VARIANT_PATTERN.test(variant)) {
        throw new Error('IPTVNATOR_PERF_VARIANT is invalid');
    }
    const smoke = process.env['IPTVNATOR_PERF_SMOKE'] === '1';
    const sourceState = readGitSourceState(workspaceRoot);
    if (!smoke && sourceState.dirty) {
        throw new Error(
            'Formal performance runs require a clean Git worktree; commit or stash changes first'
        );
    }
    const electronPackage = JSON.parse(
        await readFile(
            join(workspaceRoot, 'node_modules', 'electron', 'package.json'),
            'utf8'
        )
    ) as { version?: unknown };
    if (typeof electronPackage.version !== 'string') {
        throw new Error('Unable to resolve the Electron runtime version');
    }
    const outputDirectory = join(outputRoot, variant);
    await assertMissing(outputDirectory);
    await assertPerformanceArtifactCapacity(outputDirectory);
    await mkdir(outputDirectory, { recursive: true });
    return Object.freeze({
        electronVersion: electronPackage.version,
        gitCommit: sourceState.commit,
        gitDiffSha256: sourceState.diffSha256,
        gitDirty: sourceState.dirty,
        measuredRuns: smoke ? 1 : DEFAULT_MEASURED_RUNS,
        outputDirectory,
        variant,
        warmupRuns: DEFAULT_WARMUP_RUNS,
        workspaceRoot,
    });
}

function readGitSourceState(workspaceRoot: string): {
    readonly commit: string;
    readonly diffSha256: string;
    readonly dirty: boolean;
} {
    const git = (args: readonly string[]): string =>
        execFileSync('git', [...args], {
            cwd: workspaceRoot,
            encoding: 'utf8',
        });
    const commit = git(['rev-parse', 'HEAD']).trim();
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    const trackedDiff = git(['diff', '--binary', 'HEAD']);
    const stagedDiff = git(['diff', '--binary', '--cached', 'HEAD']);
    const diffSha256 = createHash('sha256')
        .update(status)
        .update('\0')
        .update(trackedDiff)
        .update('\0')
        .update(stagedDiff)
        .digest('hex');
    return Object.freeze({
        commit,
        diffSha256,
        dirty: status.trim().length > 0,
    });
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

async function assertTcpPortAvailable(port: number): Promise<void> {
    const server = createTcpServer();
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(
            { exclusive: true, host: '127.0.0.1', port },
            resolvePromise
        );
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) =>
            error ? rejectPromise(error) : resolvePromise()
        );
    });
}

async function assertRendererCdpTarget(page: Page): Promise<void> {
    await expect
        .poll(
            async () => {
                try {
                    const response = await fetch(
                        `http://127.0.0.1:${RENDERER_CDP_PORT}/json/list`
                    );
                    if (!response.ok) {
                        return false;
                    }
                    const targets = (await response.json()) as unknown;
                    return (
                        Array.isArray(targets) &&
                        targets.some(
                            (target) =>
                                typeof target === 'object' &&
                                target !== null &&
                                (target as Record<string, unknown>)['type'] ===
                                    'page' &&
                                (target as Record<string, unknown>)['url'] ===
                                    page.url()
                        )
                    );
                } catch {
                    return false;
                }
            },
            { timeout: 10_000 }
        )
        .toBe(true);
}

async function assertMissing(path: string): Promise<void> {
    try {
        await access(path);
    } catch {
        return;
    }
    throw new Error(`Performance output already exists: ${path}`);
}

async function startSyntheticServer(
    fixture: SyntheticM3uFixture
): Promise<SyntheticServer> {
    const seedBody = createSeedPlaylistBody();
    let body = seedBody;
    const server = createServer((request, response) => {
        if (
            request.method !== 'GET' ||
            new URL(request.url ?? '/', 'http://127.0.0.1').pathname !==
                RESOURCE_PATH
        ) {
            response.writeHead(404, { 'Content-Length': '0' });
            response.end();
            return;
        }
        const bytes = Buffer.byteLength(body, 'utf8');
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Length': String(bytes),
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        });
        response.end(body);
    });
    server.listen({ exclusive: true, host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
        await closeServer(server);
        throw new Error('Synthetic M3U server did not bind IPv4 loopback');
    }
    return Object.freeze({
        close: () => closeServer(server),
        resourceUrl: `http://127.0.0.1:${address.port}${RESOURCE_PATH}`,
        serveLargeFixture: () => {
            body = fixture.body;
        },
        serveSeedFixture: () => {
            body = seedBody;
        },
    });
}

function createSeedPlaylistBody(): string {
    const lines = ['#EXTM3U'];
    for (let index = 1; index <= 100; index += 1) {
        lines.push(
            `#EXTINF:-1 group-title="Synthetic Seed",Synthetic Seed ${String(
                index
            ).padStart(3, '0')}`
        );
        lines.push(`http://127.0.0.1/seed/${index}`);
    }
    return `${lines.join('\n')}\n`;
}

async function closeServer(server: Server): Promise<void> {
    if (!server.listening) {
        return;
    }
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) =>
            error ? rejectPromise(error) : resolvePromise()
        );
    });
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
