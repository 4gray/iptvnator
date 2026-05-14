import { chromium, Page } from '@playwright/test';
import { ChildProcess, spawn } from 'child_process';
import { createServer, Server } from 'http';
import {
    electronMainPath,
    expect,
    test,
    workspaceRoot,
} from './electron-test-fixtures';

const electronExecutable = require('electron') as string;

test.describe('Electron Downloads Benchmark', () => {
    let server: Server;
    let mediaUrl: string;
    const payload = Buffer.from(
        Array.from({ length: 96 * 1024 }, (_, index) => index % 251)
    );

    test.beforeEach(async () => {
        server = createServer((request, response) => {
            if (request.url !== '/movie.mp4') {
                response.statusCode = 404;
                response.end('not found');
                return;
            }

            const range = request.headers.range;
            if (!range) {
                response.statusCode = 200;
                response.setHeader('Content-Length', String(payload.length));
                response.setHeader('Content-Type', 'video/mp4');
                response.end(payload);
                return;
            }

            const match = range.match(/^bytes=(\d+)-(\d+)$/);
            if (!match) {
                response.statusCode = 416;
                response.end();
                return;
            }

            const start = Number.parseInt(match[1], 10);
            const end = Math.min(
                Number.parseInt(match[2], 10),
                payload.length - 1
            );
            const body = payload.subarray(start, end + 1);
            response.statusCode = 206;
            response.setHeader(
                'Content-Range',
                `bytes ${start}-${end}/${payload.length}`
            );
            response.setHeader('Content-Length', String(body.length));
            response.setHeader('Content-Type', 'video/mp4');
            response.end(body);
        });

        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve)
        );
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Benchmark fixture server did not bind.');
        }
        mediaUrl = `http://127.0.0.1:${address.port}/movie.mp4`;
    });

    test.afterEach(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    });

    test('download queue item source can be benchmarked through the Electron preload API', async ({
        dataDir,
    }) => {
        const app = await launchElectronViaCdp(dataDir);

        try {
            const startResult = await app.page.evaluate(
                async ({ downloadFolder, url }) =>
                    window.electron?.downloadsStart({
                        playlistId: 'benchmark-playlist',
                        playlistName: 'Benchmark Playlist',
                        playlistType: 'xtream',
                        serverUrl: 'http://127.0.0.1',
                        xtreamId: 9001,
                        contentType: 'vod',
                        title: 'Benchmark Movie',
                        url,
                        downloadFolder,
                    }),
                { downloadFolder: dataDir, url: mediaUrl }
            );

            expect(startResult?.success).toBe(true);
            expect(startResult?.id).toBeTruthy();

            await expect
                .poll(
                    async () =>
                        app.page.evaluate(
                            async (downloadId) =>
                                (
                                    await window.electron?.downloadsGet(
                                        downloadId
                                    )
                                )?.status,
                            startResult!.id!
                        ),
                    { timeout: 30000 }
                )
                .toBe('completed');

            const queuedItem = await app.page.evaluate(
                async (downloadId) => window.electron?.downloadsGet(downloadId),
                startResult!.id!
            );

            expect(queuedItem?.url).toBe(mediaUrl);

            const benchmark = await app.page.evaluate(async (url) => {
                if (!window.electron?.benchmarkHttpDownload) {
                    throw new Error('benchmarkHttpDownload is not exposed.');
                }

                return window.electron.benchmarkHttpDownload(
                    url,
                    undefined,
                    64 * 1024,
                    10000
                );
            }, queuedItem!.url);

            expect(benchmark).toMatchObject({
                ok: true,
                status: 206,
                rangeSupported: true,
                bytesRead: 64 * 1024,
                totalBytes: payload.length,
            });
            expect(benchmark!.ttfbMs).toBeGreaterThanOrEqual(0);
            expect(benchmark!.throughputBytesPerSecond).toBeGreaterThan(0);
            expect(benchmark!.samples.length).toBeGreaterThan(0);
        } finally {
            await app.close();
        }
    });
});

async function launchElectronViaCdp(
    dataDir: string
): Promise<{ close: () => Promise<void>; page: Page }> {
    const remoteDebuggingPort = 9339 + Math.floor(Math.random() * 200);
    const child = spawn(
        electronExecutable,
        [`--remote-debugging-port=${remoteDebuggingPort}`, electronMainPath],
        {
            cwd: workspaceRoot,
            env: {
                ...process.env,
                ELECTRON_IS_DEV: '0',
                ELECTRON_RUN_AS_NODE: undefined,
                IPTVNATOR_E2E_DATA_DIR: dataDir,
                NODE_ENV: 'test',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    const output: string[] = [];
    child.stdout?.on('data', (chunk: Buffer) => {
        output.push(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
        output.push(chunk.toString());
    });

    const endpoint = `http://127.0.0.1:${remoteDebuggingPort}`;
    await waitForCdpEndpoint(endpoint, child, output);
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('app-root', { timeout: 30000 });
    await page.waitForFunction(
        () => {
            const appRoot = document.querySelector('app-root');
            return Boolean(appRoot && appRoot.innerHTML.trim().length > 0);
        },
        { timeout: 30000 }
    );

    return {
        page,
        close: async () => {
            await browser.close().catch(() => undefined);
            if (!child.killed) {
                child.kill();
            }
            await waitForProcessExit(child).catch(() => undefined);
        },
    };
}

async function waitForProcessExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) {
        return;
    }

    await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });
}

async function waitForCdpEndpoint(
    endpoint: string,
    child: ChildProcess,
    output: string[]
): Promise<void> {
    const deadline = Date.now() + 30000;
    let exited = false;
    child.once('exit', () => {
        exited = true;
    });

    while (Date.now() < deadline) {
        if (exited) {
            throw new Error(
                `Electron exited before CDP became ready. Output: ${output.join(
                    ''
                )}`
            );
        }

        try {
            const response = await fetch(`${endpoint}/json/version`);
            if (response.ok) {
                return;
            }
        } catch {
            // Retry until Electron opens the remote debugging endpoint.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Electron CDP endpoint did not become ready: ${endpoint}`);
}
