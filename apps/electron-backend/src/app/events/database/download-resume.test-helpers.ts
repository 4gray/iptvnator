import { PassThrough, Readable } from 'node:stream';
import type { DownloadTask } from './download-task';

export interface ResumeHarness {
    createWriteStream: jest.Mock;
    removePartialDownloadFile: jest.Mock;
    requestWithValidatedRedirects: jest.Mock;
    set: jest.Mock;
    truncate: jest.Mock;
    writtenChunks: Buffer[];
    runtime: typeof import('./download-runtime');
}

export type ResumeHarnessResponse =
    | {
          data: Readable;
          headers: Record<string, string>;
          status: number;
      }
    | { requestError: unknown };

export interface ResumeHarnessOptions {
    partialSize: number;
    partialSizeAfterTransferError?: number;
    /** Single response reused for every request, or one per request in order. */
    response?: ResumeHarnessResponse;
    responses?: ResumeHarnessResponse[];
    /** Bytes served by the mocked partial-tail read for overlap resumes. */
    partialTail?: Buffer;
    /** 'enoent' makes stat() report a missing target file. */
    finalSize: number | 'enoent';
}

export function createTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
    return {
        directory: '/downloads',
        fileName: 'movie.mp4',
        id: 42,
        url: 'https://example.test/movie.mp4',
        ...overrides,
    };
}

// Starved CI runners can spend seconds on module setup alone; the default
// 5 s test timeout flakes there.
jest.setTimeout(20_000);

export async function waitForStatus(set: jest.Mock, status: string): Promise<void> {
    // Reconnect attempts interleave zero-delay timers between transfers, so
    // poll on a timer (not setImmediate) with headroom for several attempts.
    for (let attempt = 0; attempt < 1000; attempt++) {
        if (set.mock.calls.some(([value]) => value?.status === status)) {
            return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status }));
}

export async function setupResumeHarness(
    options: ResumeHarnessOptions
): Promise<ResumeHarness> {
    jest.resetModules();

    const set = jest.fn(() => ({
        where: jest.fn().mockResolvedValue(undefined),
    }));
    const db = { update: jest.fn(() => ({ set })) };
    const responses = options.responses ?? [
        options.response as ResumeHarnessResponse,
    ];
    let requestCount = 0;
    const requestWithValidatedRedirects = jest.fn(async () => {
        const entry = responses[Math.min(requestCount++, responses.length - 1)];
        if (entry && 'requestError' in entry) {
            throw entry.requestError;
        }
        return entry as never;
    });
    const writtenChunks: Buffer[] = [];
    const createWriteStream = jest.fn(() => {
        const sink = new PassThrough();
        sink.on('data', (chunk: Buffer) => writtenChunks.push(chunk));
        return sink;
    });
    const removePartialDownloadFile = jest.fn();
    const truncate = jest.fn(async () => undefined);

    jest.doMock('../../database/connection', () => ({
        getDatabase: jest.fn().mockResolvedValue(db),
    }));
    jest.doMock('../../util/validated-axios', () => ({
        requestWithValidatedRedirects,
    }));
    jest.doMock('node:fs', () => ({
        ...jest.requireActual('node:fs'),
        createWriteStream,
        existsSync: jest.fn(() => false),
    }));
    jest.doMock('node:fs/promises', () => ({
        copyFile: jest.fn(async () => undefined),
        link: jest.fn(async () => undefined),
        open: jest.fn(async () => {
            // The tail buffer stands in for the partial's overlap window; the
            // first read's position anchors it, so the mock works for any
            // rewound offset.
            const tail = options.partialTail ?? Buffer.alloc(0);
            let basePosition: number | null = null;
            return {
                close: jest.fn(async () => undefined),
                read: jest.fn(
                    async (
                        buffer: Buffer,
                        offset: number,
                        length: number,
                        position: number
                    ) => {
                        basePosition ??= position;
                        const start = position - basePosition;
                        const slice = tail.subarray(start, start + length);
                        slice.copy(buffer, offset);
                        return { bytesRead: slice.length };
                    }
                ),
            };
        }),
        stat: jest.fn(async () => {
            if (options.finalSize === 'enoent') {
                const error = new Error('missing') as NodeJS.ErrnoException;
                error.code = 'ENOENT';
                throw error;
            }
            return { size: options.finalSize };
        }),
        truncate,
        unlink: jest.fn(async () => undefined),
    }));
    jest.doMock('./download-reconnect', () => {
        const actual = jest.requireActual('./download-reconnect');
        return {
            ...actual,
            transferWithReconnects: (
                dbArg: unknown,
                task: unknown,
                reservation: unknown
            ) =>
                actual.transferWithReconnects(dbArg, task, reservation, {
                    delayMs: 0,
                }),
        };
    });
    jest.doMock('./download-file-path', () => ({
        getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
        getPartialDownloadSize: jest
            .fn()
            .mockReturnValueOnce(options.partialSize)
            .mockReturnValue(
                options.partialSizeAfterTransferError ?? options.partialSize
            ),
        removePartialDownloadFile,
        reserveAvailablePartialDownloadFile: jest.fn(
            (directory: string, filename: string) => ({
                filename,
                partialPath: `${directory}/${filename}.part`,
                path: `${directory}/${filename}`,
            })
        ),
    }));

    const runtime = await import('./download-runtime');
    runtime.setMainWindow({
        isDestroyed: () => false,
        webContents: { send: jest.fn() },
    } as never);

    return {
        createWriteStream,
        removePartialDownloadFile,
        requestWithValidatedRedirects,
        set,
        truncate,
        writtenChunks,
        runtime,
    };
}
