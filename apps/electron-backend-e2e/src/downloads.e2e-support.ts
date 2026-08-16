import { createServer } from 'http';
import type { AddressInfo } from 'net';
import type { Page } from '@playwright/test';
import { expect, type LaunchedElectronApp } from './electron-test-fixtures';
import {
    getStalkerTitle,
    type StalkerContentItem,
} from './portal-mock-fixtures';

interface DownloadSeed {
    contentType: 'episode' | 'vod';
    downloadFolder: string;
    episodeNumber?: number;
    playlistId: string;
    seasonNumber?: number;
    seriesXtreamId?: number;
    title: string;
    url: string;
    xtreamId: number;
}

interface RangeServerRequest {
    ifRange?: string;
    range?: string;
}

interface ThrottledRangeServer {
    close: () => Promise<void>;
    payload: Buffer;
    requests: RangeServerRequest[];
    url: string;
}

interface InterruptedRangeServer extends ThrottledRangeServer {
    interruptedBytes: number;
}

interface TruncatedDownloadServer {
    close: () => Promise<void>;
    payload: Buffer;
    totalBytes: number;
    url: string;
}

export const RANGE_SERVER_ETAG = '"e2e-range-etag"';
export const INTERRUPTED_RANGE_SERVER_ETAG = '"e2e-reset-etag"';
const downloadPlayCaptureKey = '__iptvnatorE2eDownloadPlayPaths';

export function getStalkerSeriesDownloadTarget(
    item: StalkerContentItem | undefined
): { id: number; title: string } {
    const id = Number(
        String(item?.id ?? '')
            .split(':')[0]
            .trim()
    );
    const title = item ? getStalkerTitle(item) : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !title) {
        throw new Error('Stalker series fixture returned an invalid target.');
    }
    return { id, title };
}

export async function startDownload(
    page: Page,
    seed: DownloadSeed
): Promise<number> {
    const result = await page.evaluate(
        async (payload) => window.electron?.downloadsStart?.(payload),
        seed
    );
    expect(result?.error ?? null).toBeNull();
    expect(result?.id).toEqual(expect.any(Number));
    if (typeof result?.id !== 'number') {
        throw new Error(`Download did not return an id: ${seed.title}`);
    }
    return result.id;
}

export async function installDownloadPlayCapture(
    app: LaunchedElectronApp
): Promise<void> {
    await app.electronApp.evaluate(({ ipcMain }, captureKey) => {
        const globalRef = globalThis as typeof globalThis &
            Record<string, string[] | undefined>;
        globalRef[captureKey] = [];
        ipcMain.removeHandler('DOWNLOADS_PLAY_FILE');
        ipcMain.handle(
            'DOWNLOADS_PLAY_FILE',
            async (_event, filePath: string) => {
                globalRef[captureKey]?.push(filePath);
                return { success: true };
            }
        );
    }, downloadPlayCaptureKey);
}

export async function getDownloadPlayPaths(
    app: LaunchedElectronApp
): Promise<string[]> {
    return app.electronApp.evaluate((_, captureKey) => {
        const globalRef = globalThis as typeof globalThis &
            Record<string, string[] | undefined>;
        return globalRef[captureKey] ?? [];
    }, downloadPlayCaptureKey);
}

/**
 * Serves a payload slowly on the first (full) request so the UI has a wide
 * window to pause mid-transfer, and answers Range requests with an immediate
 * 206 so the resumed transfer finishes fast. Records Range/If-Range headers.
 */
export async function createThrottledRangeServer(
    chunkIntervalMs = 150
): Promise<ThrottledRangeServer> {
    const payload = Buffer.from(
        Array.from({ length: 96 * 1024 }, (_, index) =>
            String(index % 10)
        ).join('')
    );
    const requests: RangeServerRequest[] = [];

    const server = createServer((req, res) => {
        const range = req.headers.range;
        const ifRange = req.headers['if-range'];
        requests.push({
            ifRange: typeof ifRange === 'string' ? ifRange : undefined,
            range: typeof range === 'string' ? range : undefined,
        });

        const offset = range
            ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? Number.NaN)
            : 0;
        if (range && Number.isFinite(offset)) {
            res.writeHead(206, {
                'Content-Length': payload.length - offset,
                'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}`,
                'Content-Type': 'video/mp4',
                ETag: RANGE_SERVER_ETAG,
            });
            res.end(payload.subarray(offset));
            return;
        }

        res.writeHead(200, {
            'Content-Length': payload.length,
            'Content-Type': 'video/mp4',
            ETag: RANGE_SERVER_ETAG,
        });
        // First 16 KiB immediately, then a trickle: the transfer stays alive
        // for tens of seconds unless it is paused or resumed via Range.
        let sent = 16 * 1024;
        res.write(payload.subarray(0, sent));
        const timer = setInterval(() => {
            if (sent >= payload.length) {
                clearInterval(timer);
                res.end();
                return;
            }
            res.write(payload.subarray(sent, sent + 2 * 1024));
            sent += 2 * 1024;
        }, chunkIntervalMs);
        res.on('close', () => clearInterval(timer));
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;

    return {
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        payload,
        requests,
        url: `http://127.0.0.1:${port}/media/e2e-pause-movie.mp4`,
    };
}

/**
 * Resets the first full response after writing a valid prefix, then serves the
 * remainder to a Range retry. This matches a provider/proxy connection drop
 * without manufacturing a clean EOF.
 */
export async function createInterruptedRangeServer(): Promise<InterruptedRangeServer> {
    const payload = Buffer.alloc(64 * 1024, 9);
    const interruptedBytes = 16 * 1024;
    const requests: RangeServerRequest[] = [];

    const server = createServer((req, res) => {
        const range = req.headers.range;
        const ifRange = req.headers['if-range'];
        requests.push({
            ifRange: typeof ifRange === 'string' ? ifRange : undefined,
            range: typeof range === 'string' ? range : undefined,
        });

        const offset = range
            ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? Number.NaN)
            : 0;
        if (range && Number.isFinite(offset)) {
            res.writeHead(206, {
                'Content-Length': payload.length - offset,
                'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}`,
                'Content-Type': 'video/mp4',
                ETag: INTERRUPTED_RANGE_SERVER_ETAG,
            });
            res.end(payload.subarray(offset));
            return;
        }

        res.writeHead(200, {
            'Content-Length': payload.length,
            'Content-Type': 'video/mp4',
            ETag: INTERRUPTED_RANGE_SERVER_ETAG,
        });
        res.write(payload.subarray(0, interruptedBytes), () => {
            setTimeout(() => res.socket?.destroy(), 20);
        });
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;

    return {
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        interruptedBytes,
        payload,
        requests,
        url: `http://127.0.0.1:${port}/media/e2e-reset-movie.mp4`,
    };
}

/**
 * Interrupts the first response like createInterruptedRangeServer but sends
 * no ETag/Last-Modified, and drops far enough in that the partial exceeds the
 * 256 KiB overlap-verification window. The runtime must resume by rewinding
 * the Range request and verifying the overlap instead of restarting from
 * byte zero.
 */
export async function createInterruptedNoValidatorServer(): Promise<InterruptedRangeServer> {
    const payload = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < payload.length; i++) {
        payload[i] = (i * 31 + 7) % 251;
    }
    const interruptedBytes = 512 * 1024;
    const requests: RangeServerRequest[] = [];

    const server = createServer((req, res) => {
        const range = req.headers.range;
        const ifRange = req.headers['if-range'];
        requests.push({
            ifRange: typeof ifRange === 'string' ? ifRange : undefined,
            range: typeof range === 'string' ? range : undefined,
        });

        const offset = range
            ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? Number.NaN)
            : 0;
        if (range && Number.isFinite(offset)) {
            res.writeHead(206, {
                'Content-Length': payload.length - offset,
                'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}`,
                'Content-Type': 'video/mp4',
            });
            res.end(payload.subarray(offset));
            return;
        }

        res.writeHead(200, {
            'Content-Length': payload.length,
            'Content-Type': 'video/mp4',
        });
        res.write(payload.subarray(0, interruptedBytes), () => {
            setTimeout(() => res.socket?.destroy(), 20);
        });
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;

    return {
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        interruptedBytes,
        payload,
        requests,
        url: `http://127.0.0.1:${port}/media/e2e-no-validator-movie.mp4`,
    };
}

/**
 * Ends a chunked response cleanly while Content-Range advertises a larger
 * representation. The runtime therefore retains the valid .part for a Range
 * retry instead of treating it as an unusable transport failure.
 */
export async function createTruncatedDownloadServer(): Promise<TruncatedDownloadServer> {
    const payload = Buffer.alloc(16 * 1024, 7);
    const totalBytes = payload.length * 4;
    const server = createServer((_req, res) => {
        res.writeHead(200, {
            'Content-Range': `bytes 0-${payload.length - 1}/${totalBytes}`,
            'Content-Type': 'video/mp4',
            ETag: '"e2e-truncated-etag"',
        });
        res.end(payload);
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;

    return {
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        payload,
        totalBytes,
        url: `http://127.0.0.1:${port}/media/e2e-truncated-movie.mp4`,
    };
}
