import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { expect, type Page } from '@playwright/test';

import {
    type LaunchedElectronApp,
    workspaceRoot,
} from '../electron-test-fixtures';
import { assertPerformanceArtifactCapacity } from './performance-artifact-preflight';
import type { RendererWindowIdentity } from './renderer-window-rss-session';

const OUTPUT_VARIANT_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const M3U_IMPORT_RENDERER_CDP_PORT = 9222;

export interface M3uImportGitSourceState {
    readonly commit: string;
    readonly diffSha256: string;
    readonly dirty: boolean;
}

export interface M3uImportOutputLayout {
    readonly outputRoot: string;
    readonly variantDirectory: string;
}

export interface M3uImportBenchmarkConfiguration extends M3uImportOutputLayout {
    readonly electronVersion: string;
    readonly measuredRuns: number;
    readonly rendererCdpPort: number;
    readonly smoke: boolean;
    readonly sourceState: M3uImportGitSourceState;
    readonly variant: string;
}

export async function resolveM3uImportBenchmarkConfiguration(): Promise<M3uImportBenchmarkConfiguration> {
    const requestedRoot = process.env['IPTVNATOR_PERF_OUTPUT_DIR'];
    if (!requestedRoot) {
        throw new Error('IPTVNATOR_PERF_OUTPUT_DIR is required');
    }
    const variant = process.env['IPTVNATOR_PERF_VARIANT'] ?? 'baseline';
    const layout = resolveM3uImportOutputLayout(
        workspaceRoot,
        requestedRoot,
        variant
    );
    const smoke = process.env['IPTVNATOR_PERF_SMOKE'] === '1';
    const rendererCdpPort = resolveM3uImportRendererCdpPort(
        smoke,
        process.env['IPTVNATOR_PERF_CDP_PORT']
    );
    const sourceState = readGitSourceState(workspaceRoot);
    assertM3uImportSourceState(smoke, sourceState);
    const electronPackage = JSON.parse(
        await readFile(
            join(workspaceRoot, 'node_modules', 'electron', 'package.json'),
            'utf8'
        )
    ) as { version?: unknown };
    if (typeof electronPackage.version !== 'string') {
        throw new Error('Unable to resolve the Electron runtime version');
    }
    await assertM3uImportOutputPathHasNoSymlinks(
        workspaceRoot,
        layout.outputRoot
    );
    await assertMissing(layout.variantDirectory);
    await assertPerformanceArtifactCapacity(layout.variantDirectory);
    await mkdir(layout.variantDirectory, { recursive: true });
    return Object.freeze({
        ...layout,
        electronVersion: electronPackage.version,
        measuredRuns: smoke ? 1 : 5,
        rendererCdpPort,
        smoke,
        sourceState,
        variant,
    });
}

export function resolveM3uImportOutputLayout(
    repositoryRoot: string,
    requestedRoot: string,
    variant: string
): M3uImportOutputLayout {
    const performanceRoot = resolve(repositoryRoot, 'dist', 'performance');
    const outputRoot = resolve(requestedRoot);
    if (
        !isAbsolute(requestedRoot) ||
        !isStrictDescendant(performanceRoot, outputRoot)
    ) {
        throw new Error(
            'Performance output must be an absolute path below dist/performance'
        );
    }
    if (!OUTPUT_VARIANT_PATTERN.test(variant)) {
        throw new Error('IPTVNATOR_PERF_VARIANT is invalid');
    }
    const variantDirectory = resolve(outputRoot, variant);
    if (!isStrictDescendant(outputRoot, variantDirectory)) {
        throw new Error('IPTVNATOR_PERF_VARIANT is invalid');
    }
    return Object.freeze({ outputRoot, variantDirectory });
}

export async function assertM3uImportOutputPathHasNoSymlinks(
    repositoryRoot: string,
    outputRoot: string
): Promise<void> {
    const root = resolve(repositoryRoot);
    const output = resolve(outputRoot);
    if (!isStrictDescendant(root, output)) {
        throw new Error('Performance output path escapes the repository');
    }
    const components = relative(root, output).split(sep);
    let current = root;

    for (const component of ['', ...components]) {
        current = component === '' ? current : join(current, component);
        try {
            const stats = await lstat(current);
            if (stats.isSymbolicLink()) {
                throw new Error(
                    `Performance output path contains a symbolic link: ${current}`
                );
            }
        } catch (error) {
            if (isMissingPath(error)) {
                return;
            }
            throw error;
        }
    }
}

export function assertM3uImportSourceState(
    smoke: boolean,
    state: M3uImportGitSourceState
): void {
    if (!smoke && state.dirty) {
        throw new Error(
            'Formal performance runs require a clean Git worktree; commit or stash changes first'
        );
    }
}

export function resolveM3uImportRendererCdpPort(
    smoke: boolean,
    requestedPort: string | undefined
): number {
    const port =
        requestedPort === undefined
            ? M3U_IMPORT_RENDERER_CDP_PORT
            : Number(requestedPort);
    if (
        (requestedPort !== undefined && !/^[1-9]\d*$/.test(requestedPort)) ||
        !Number.isSafeInteger(port) ||
        port < 1024 ||
        port > 65_535
    ) {
        throw new Error('IPTVNATOR_PERF_CDP_PORT is invalid');
    }
    if (!smoke && port !== M3U_IMPORT_RENDERER_CDP_PORT) {
        throw new Error(
            `Formal performance runs require CDP port ${M3U_IMPORT_RENDERER_CDP_PORT}`
        );
    }
    return port;
}

export async function resolveRendererWindowIdentity(
    app: LaunchedElectronApp
): Promise<RendererWindowIdentity> {
    const handle = await app.electronApp.browserWindow(app.mainWindow);
    try {
        return await handle.evaluate((browserWindow) => {
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
        await handle.dispose();
    }
}

export async function assertTcpPortAvailable(port: number): Promise<void> {
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

export async function assertRendererCdpTarget(
    page: Page,
    port: number
): Promise<void> {
    await expect
        .poll(
            async () => {
                try {
                    const response = await fetch(
                        `http://127.0.0.1:${port}/json/list`
                    );
                    const targets = response.ok
                        ? ((await response.json()) as unknown)
                        : null;
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

export async function writeM3uImportJson(
    path: string,
    value: unknown
): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readGitSourceState(repositoryRoot: string): M3uImportGitSourceState {
    const git = (args: readonly string[]): string =>
        execFileSync('git', [...args], {
            cwd: repositoryRoot,
            encoding: 'utf8',
        });
    const commit = git(['rev-parse', 'HEAD']).trim();
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    const diffSha256 = createHash('sha256')
        .update(status)
        .update('\0')
        .update(git(['diff', '--binary', 'HEAD']))
        .update('\0')
        .update(git(['diff', '--binary', '--cached', 'HEAD']))
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

async function assertMissing(path: string): Promise<void> {
    try {
        await access(path);
    } catch {
        return;
    }
    throw new Error(`Performance output already exists: ${path}`);
}

function isMissingPath(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
    );
}
