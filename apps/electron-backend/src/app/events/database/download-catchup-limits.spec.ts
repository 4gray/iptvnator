import { statfs } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
    ARCHIVE_DISK_RESERVE,
    assertArchiveCopyHeadroom,
    createArchiveByteGuard,
    getArchiveByteLimit,
} from './download-catchup-limits';

jest.mock('node:fs/promises', () => ({ statfs: jest.fn() }));
const disk = (bytes: number) =>
    ({ bavail: bytes, bsize: 1 }) as Awaited<ReturnType<typeof statfs>>;

beforeEach(() => jest.mocked(statfs).mockReset());

it('bounds even undeclared streams by duration, a hard cap and free space', async () => {
    jest.mocked(statfs).mockResolvedValue(disk(1000 * 1024 ** 3));
    expect(await getArchiveByteLimit('/downloads', 60, null)).toBe(
        120 * 12_500_000
    );
    expect(await getArchiveByteLimit('/downloads', 86400, null)).toBe(
        64 * 1024 ** 3
    );
    jest.mocked(statfs).mockResolvedValue(disk(ARCHIVE_DISK_RESERVE + 2000));
    expect(await getArchiveByteLimit('/downloads', 60, null)).toBe(1000);
});

it('refuses insufficient space and oversized Content-Length before writing', async () => {
    jest.mocked(statfs).mockResolvedValue(disk(ARCHIVE_DISK_RESERVE));
    await expect(getArchiveByteLimit('/downloads', 60, null)).rejects.toThrow(
        'limit'
    );
    jest.mocked(statfs).mockResolvedValue(disk(ARCHIVE_DISK_RESERVE + 2000));
    await expect(getArchiveByteLimit('/downloads', 60, 1001)).rejects.toThrow(
        'limit'
    );
});

it('never forwards a chunk that exceeds the byte budget', async () => {
    let written = 0;
    await expect(
        pipeline(
            Readable.from([Buffer.alloc(600), Buffer.alloc(600)]),
            createArchiveByteGuard('/downloads', 1000),
            new Writable({
                write(chunk, _encoding, callback) {
                    written += chunk.length;
                    callback();
                },
            })
        )
    ).rejects.toThrow('limit');
    expect(written).toBe(600);
});

it('stops when other disk activity consumes the reserve during transfer', async () => {
    jest.mocked(statfs).mockResolvedValue(disk(ARCHIVE_DISK_RESERVE));
    let written = 0;
    await expect(
        pipeline(
            Readable.from([Buffer.alloc(16 * 1024 ** 2)]),
            createArchiveByteGuard('/downloads', 64 * 1024 ** 3),
            new Writable({
                write(chunk, _encoding, callback) {
                    written += chunk.length;
                    callback();
                },
            })
        )
    ).rejects.toThrow('limit');
    expect(written).toBe(0);
});

it('rechecks copy headroom at EOF, including tails below the periodic checkpoint', async () => {
    jest.mocked(statfs).mockResolvedValue(disk(ARCHIVE_DISK_RESERVE + 1000));
    await expect(assertArchiveCopyHeadroom('/downloads', 1001)).rejects.toThrow(
        'limit'
    );
    await expect(
        assertArchiveCopyHeadroom('/downloads', 1000)
    ).resolves.toBeUndefined();
});
