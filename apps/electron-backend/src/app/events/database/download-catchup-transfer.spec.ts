import { recordArchivePartial } from './download-catchup-journal';
import {
    mkdtemp,
    readFile,
    rm,
    writeFile,
    symlink,
    link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
    createTsValidator,
    transferCatchupToPartialFile,
} from './download-catchup-transfer';
import { requestWithValidatedRedirects } from '../../util/validated-axios';
import type { DownloadsDatabase, DownloadTask } from './download-task';
import {
    getCompletedPartialProgress,
    getExistingCompletedFileProgress,
} from './download-finalize';
import {
    assertArchiveCopyHeadroom,
    getArchiveByteLimit,
} from './download-catchup-limits';
import { stat } from 'node:fs/promises';

jest.mock('./download-catchup-journal', () => ({
    ...jest.requireActual('./download-catchup-journal'),
    recordArchivePartial: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./download-catchup-limits', () => {
    const actual = jest.requireActual('./download-catchup-limits');
    return {
        ...actual,
        getArchiveByteLimit: jest.fn(actual.getArchiveByteLimit),
        assertArchiveCopyHeadroom: jest.fn(actual.assertArchiveCopyHeadroom),
    };
});
jest.mock('../../util/validated-axios', () => ({
    requestWithValidatedRedirects: jest.fn(),
}));
jest.mock('./download-transfer-persistence', () => ({
    persistProgress: jest.fn().mockResolvedValue(undefined),
    persistTransferStart: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./download-broadcast', () => ({
    broadcastDownloadUpdate: jest.fn(),
}));
const packets = Buffer.alloc(188 * 10, 0xff);
for (let i = 0; i < packets.length; i += 188) packets[i] = 0x47;
const metadata = {
    channelName: 'News',
    startTimestamp: Math.floor(Date.now() / 1000) - 7200,
    stopTimestamp: Math.floor(Date.now() / 1000) - 3600,
};
const sink = () =>
    new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });

describe('TS archive transfer', () => {
    it('accepts TS packet boundaries split across arbitrary chunks', async () => {
        await pipeline(
            Readable.from([packets.subarray(0, 199), packets.subarray(199)]),
            createTsValidator(),
            sink()
        );
    });
    it.each([
        Buffer.from('#EXTM3U\n#EXTINF:10,\na.ts'),
        Buffer.from('<html>expired</html>'),
        packets.subarray(0, packets.length - 1),
        Buffer.alloc(0),
    ])(
        'rejects playlists, error bodies and truncated packets',
        async (body) => {
            await expect(
                pipeline(Readable.from([body]), createTsValidator(), sink())
            ).rejects.toThrow();
        }
    );
    it('does not consider a byte-complete retained archive safe to finalize', async () => {
        expect(
            await getExistingCompletedFileProgress({
                id: 1,
                url: 'https://host/1.ts',
                fileName: 'a.ts',
                directory: '/tmp',
                filePath: '/tmp/a.ts',
                totalBytes: 1880,
                catchup: metadata,
            })
        ).toBeNull();
        expect(
            getCompletedPartialProgress({
                id: 1,
                url: 'https://host/1.ts',
                fileName: 'a.ts',
                directory: '/tmp',
                filePath: '/tmp/a.ts',
                totalBytes: 1880,
                catchup: metadata,
            })
        ).toBeNull();
    });
    it('overwrites retained bytes and requests a fresh response without Range', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'archive-transfer-'));
        const path = join(dir, 'show.ts');
        const task: DownloadTask = {
            id: 1,
            url: 'https://host/archive.ts',
            fileName: 'show.ts',
            directory: dir,
            catchup: metadata,
            totalBytes: 999,
            resumeValidator: 'old',
            headers: { 'User-Agent': 'custom' },
        };
        try {
            await writeFile(path + '.part', 'old data');
            task.catchupExpectedPartialIdentity = await stat(path + '.part');
            jest.mocked(recordArchivePartial).mockImplementationOnce(
                async (_db, id, filePath, identity) => {
                    expect(filePath).toBe(path);
                    expect(identity).toEqual(
                        expect.objectContaining({
                            ino: String((await stat(path + '.part')).ino),
                        })
                    );
                    expect(id).toBe(task.id);
                    expect(await readFile(path + '.part', 'utf8')).toBe(
                        'old data'
                    );
                }
            );
            const actualLimit = jest.requireActual<
                typeof import('./download-catchup-limits')
            >('./download-catchup-limits').getArchiveByteLimit;
            jest.mocked(getArchiveByteLimit).mockImplementationOnce(
                async (...args) => {
                    expect((await stat(path + '.part')).size).toBe(0);
                    return actualLimit(...args);
                }
            );
            jest.mocked(requestWithValidatedRedirects).mockResolvedValue({
                status: 200,
                headers: {
                    'content-length': String(packets.length),
                    'content-type': 'video/mp2t',
                },
                data: Readable.from([packets]),
            } as never);
            jest.mocked(assertArchiveCopyHeadroom).mockImplementationOnce(
                async (directory, size) => {
                    expect(await readFile(path + '.part')).toEqual(packets);
                    expect(size).toBe(packets.length);
                    return jest
                        .requireActual<
                            typeof import('./download-catchup-limits')
                        >('./download-catchup-limits')
                        .assertArchiveCopyHeadroom(directory, size);
                }
            );
            const progress = await transferCatchupToPartialFile(
                {} as DownloadsDatabase,
                task,
                { path, partialPath: path + '.part', filename: 'show.ts' }
            );
            expect(progress).toEqual({
                bytesDownloaded: packets.length,
                totalBytes: packets.length,
            });
            expect(await readFile(path + '.part')).toEqual(packets);
            expect(requestWithValidatedRedirects).toHaveBeenLastCalledWith(
                task.url,
                expect.objectContaining({
                    headers: {
                        'User-Agent': 'custom',
                        'Accept-Encoding': 'identity',
                    },
                }),
                expect.anything()
            );
            expect(task.resumeValidator).toBeNull();
            expect(recordArchivePartial).toHaveBeenCalledWith(
                expect.anything(),
                task.id,
                path,
                expect.objectContaining({
                    dev: expect.any(String),
                    ino: expect.any(String),
                })
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it('aborts a stalled response and never reports completion', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'archive-abort-'));
        const task: DownloadTask = {
            id: 2,
            url: 'https://host/archive.ts',
            fileName: 'show.ts',
            directory: dir,
            catchup: metadata,
        };
        const body = new PassThrough();
        jest.mocked(requestWithValidatedRedirects).mockResolvedValue({
            status: 200,
            headers: {},
            data: body,
        } as never);
        try {
            const transfer = transferCatchupToPartialFile(
                {} as DownloadsDatabase,
                task,
                {
                    path: join(dir, 'show.ts'),
                    partialPath: join(dir, 'show.ts.part'),
                    filename: 'show.ts',
                }
            );
            const rejected = expect(transfer).rejects.toThrow('interrupted');
            await new Promise((resolve) => setImmediate(resolve));
            task.abortController?.abort();
            await rejected;
            expect(body.destroyed).toBe(true);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

it.each(['symlink', 'hardlink', 'regular file'])(
    'refuses a retained archive partial replaced by a %s',
    async (kind) => {
        const directory = await mkdtemp(join(tmpdir(), 'archive-replaced-'));
        const path = join(directory, 'archive.ts'),
            target = join(directory, 'unrelated.txt');
        try {
            await writeFile(target, 'keep this file intact');
            await (kind === 'symlink'
                ? symlink(target, path + '.part')
                : kind === 'hardlink'
                  ? link(target, path + '.part')
                  : writeFile(path + '.part', 'keep this file intact'));
            jest.mocked(requestWithValidatedRedirects).mockResolvedValue({
                status: 200,
                headers: { 'content-type': 'video/mp2t' },
                data: Readable.from([packets]),
            } as never);
            const task: DownloadTask = {
                id: 3,
                catchupExpectedPartialIdentity: await stat(target),
                url: 'https://host/archive.ts',
                fileName: 'archive.ts',
                directory,
                catchup: metadata,
            };
            const journalClears =
                jest.mocked(recordArchivePartial).mock.calls.length;
            await expect(
                transferCatchupToPartialFile({} as DownloadsDatabase, task, {
                    path,
                    partialPath: path + '.part',
                    filename: 'archive.ts',
                })
            ).rejects.toThrow();
            expect(jest.mocked(recordArchivePartial).mock.calls.length).toBe(
                journalClears
            );
            expect(await readFile(path + '.part', 'utf8')).toBe(
                'keep this file intact'
            );
            expect(await readFile(target, 'utf8')).toBe(
                'keep this file intact'
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
);

it('requires both finalization proof and unchanged identity to recover completion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'archive-proof-'));
    const filePath = join(directory, 'show.ts');
    try {
        await writeFile(filePath, packets);
        const task: DownloadTask = {
            id: 9,
            directory,
            fileName: 'show.ts',
            filePath,
            url: 'https://host/show.ts',
            catchup: metadata,
            totalBytes: packets.length,
        };
        expect(await getExistingCompletedFileProgress(task)).toBeNull();
        task.catchupFinalized = {
            filePath,
            identity: await stat(filePath),
            size: packets.length,
        };
        expect(await getExistingCompletedFileProgress(task)).toEqual({
            filePath,
            bytesDownloaded: packets.length,
            totalBytes: packets.length,
        });
        await (
            await import('node:fs/promises')
        ).rename(filePath, join(directory, 'original'));
        await writeFile(filePath, packets);
        expect(await getExistingCompletedFileProgress(task)).toBeNull();
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
