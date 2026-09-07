import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { getCompletedPartialProgress } from './download-finalize';

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
    it('does not consider a byte-complete retained archive safe to finalize', () => {
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
            jest.mocked(requestWithValidatedRedirects).mockResolvedValue({
                status: 200,
                headers: {
                    'content-length': String(packets.length),
                    'content-type': 'video/mp2t',
                },
                data: Readable.from([packets]),
            } as never);
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
