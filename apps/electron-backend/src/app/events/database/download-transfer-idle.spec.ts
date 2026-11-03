import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveAvailablePartialDownloadFile } from './download-file-path';
import { transferWithReconnects } from './download-reconnect';
import type { DownloadsDatabase, DownloadTask } from './download-task';
import {
    InterruptedTransferError,
    transferToPartialFile,
} from './download-transfer';

jest.mock('./download-idle-timeout', () => ({
    ...jest.requireActual('./download-idle-timeout'),
    DOWNLOAD_IDLE_TIMEOUT_MS: 100,
}));

const mockSet = jest.fn(() => ({
    where: jest.fn().mockResolvedValue(undefined),
}));
const mockDb = { update: jest.fn(() => ({ set: mockSet })) };
jest.mock('../../database/connection', () => ({
    getDatabase: jest.fn(async () => mockDb),
}));

describe('download HTTP inactivity', () => {
    let directory: string;
    let server: ReturnType<typeof createServer>;
    let handler: (req: IncomingMessage, res: ServerResponse) => void;
    let url: string;
    let tasks: DownloadTask[];
    let operations: Promise<unknown>[];

    beforeEach(async () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        mockSet.mockClear();
        tasks = [];
        operations = [];
        directory = await mkdtemp(join(tmpdir(), 'download-idle-'));
        handler = () => undefined;
        server = createServer((req, res) => handler(req, res));
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/movie.mp4`;
    });

    afterEach(async () => {
        for (const task of tasks) {
            task.cancelRequested = true;
            task.abortController?.abort();
        }
        const closed = new Promise<void>((resolve) =>
            server.close(() => resolve())
        );
        server.closeAllConnections();
        await Promise.allSettled(operations);
        await closed;
        await rm(directory, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    function createTask(id = 1): DownloadTask {
        const task = { id, directory, fileName: `movie-${id}.mp4`, url };
        tasks.push(task);
        return task;
    }

    async function bounded<T>(operation: Promise<T>, track = true): Promise<T> {
        if (track) operations.push(operation);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                operation,
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(
                        () =>
                            reject(
                                new Error(
                                    'Download stayed idle without timing out'
                                )
                            ),
                        2000
                    );
                }),
            ]);
        } finally {
            clearTimeout(timeout);
        }
    }

    it('times out a server that accepts the request but never sends headers', async () => {
        const task = createTask();
        const reservation = reserveAvailablePartialDownloadFile(
            directory,
            task.fileName
        );

        await expect(
            bounded(
                transferToPartialFile(
                    mockDb as unknown as DownloadsDatabase,
                    task,
                    reservation
                )
            )
        ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    });

    it('retains received bytes when the response body stops arriving', async () => {
        handler = (_req, res) => {
            res.writeHead(200, { 'Content-Length': '100', ETag: '"movie"' });
            res.write('saved bytes');
        };
        const task = createTask();
        const reservation = reserveAvailablePartialDownloadFile(
            directory,
            task.fileName
        );

        await expect(
            bounded(
                transferToPartialFile(
                    mockDb as unknown as DownloadsDatabase,
                    task,
                    reservation
                )
            )
        ).rejects.toMatchObject({
            message: expect.stringContaining('ETIMEDOUT'),
            progress: { bytesDownloaded: 11, totalBytes: 100 },
        });
        expect(await readFile(reservation.partialPath, 'utf8')).toBe(
            'saved bytes'
        );
    });

    it.each(['headers', 'body'])(
        'exhausts stalled %s reconnects without deleting the saved partial',
        async (phase) => {
            const ranges: Array<string | undefined> = [];
            handler = (req, res) => {
                ranges.push(req.headers.range);
                if (!req.headers.range) {
                    res.writeHead(200, {
                        'Content-Length': '100',
                        ETag: '"movie"',
                    });
                    res.write('saved bytes');
                } else if (phase === 'body') {
                    res.writeHead(206, {
                        'Content-Length': '89',
                        'Content-Range': 'bytes 11-99/100',
                        ETag: '"movie"',
                    });
                    res.flushHeaders();
                }
            };
            const task = createTask();
            const reservation = reserveAvailablePartialDownloadFile(
                directory,
                task.fileName
            );

            await expect(
                bounded(
                    transferWithReconnects(
                        mockDb as unknown as DownloadsDatabase,
                        task,
                        reservation,
                        { delayMs: 0 }
                    )
                )
            ).rejects.toBeInstanceOf(InterruptedTransferError);
            expect(ranges).toEqual([
                undefined,
                'bytes=11-',
                'bytes=11-',
                'bytes=11-',
            ]);
            expect(await readFile(reservation.partialPath, 'utf8')).toBe(
                'saved bytes'
            );
        }
    );

    it('releases the queue after a header stall so the next download completes', async () => {
        handler = (req, res) => {
            if (req.url === '/next.mp4') res.end('next movie');
        };
        const runtime = await import('./download-runtime');
        const first = createTask();
        const next = createTask(2);
        next.url = url.replace('/movie.mp4', '/next.mp4');
        const completed = new Promise<void>((resolve) => {
            mockSet.mockImplementation((...args: unknown[]) => {
                if ((args[0] as { status?: string }).status === 'completed')
                    resolve();
                return { where: jest.fn().mockResolvedValue(undefined) };
            });
        });

        runtime.enqueueDownload(first);
        runtime.enqueueDownload(next);
        await bounded(completed, false);

        expect(await readFile(join(directory, next.fileName), 'utf8')).toBe(
            'next movie'
        );
        expect(mockSet).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                errorMessage: expect.stringContaining('timeout'),
            })
        );
    });
});
