import {
    lstat,
    mkdtemp,
    readFile,
    rename,
    rm,
    writeFile,
    link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { finalizeCatchupPartial } from './download-catchup-finalize';
import {
    recordArchiveFinalization,
    recordArchivePartial,
    recordArchiveCleanupPath,
    parseArchiveFinalization,
} from './download-catchup-journal';
import { resetStaleDownloads } from './download-recovery';
import type { DownloadsDatabase } from './download-task';

jest.mock('../../database/connection', () => ({ getDatabase: jest.fn() }));
jest.mock('node:fs/promises', () => {
    const actual = jest.requireActual('node:fs/promises');
    return { ...actual, link: jest.fn(actual.link) };
});
let directory: string;
let filePath: string;
let rows: Record<string, unknown>[];
let journals: { downloadId: number; proof: string }[];
let updates: Record<string, unknown>[];
let db: DownloadsDatabase;
beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'archive-recovery-'));
    filePath = join(directory, 'show.ts');
    rows = [
        {
            id: 1,
            filePath,
            contentType: 'catchup',
            status: 'downloading',
            totalBytes: null,
        },
    ];
    journals = [];
    updates = [];
    db = {
        select: () => ({
            from: (table: unknown) => ({
                where: async () =>
                    table === schema.downloads ? rows : journals,
            }),
        }),
        insert: () => ({
            values: (row: (typeof journals)[number]) => ({
                onConflictDoUpdate: async () => {
                    journals = [JSON.parse(JSON.stringify(row))];
                },
            }),
        }),
        update: (table: unknown) => ({
            set: (value: Record<string, unknown>) => ({
                where: () => ({
                    then: (resolve: (value: undefined) => unknown) => {
                        updates.push(value);
                        return Promise.resolve(resolve(undefined));
                    },
                    run: () => {
                        if (
                            table === schema.downloadArchiveFinalizations &&
                            journals.length
                        ) {
                            journals[0].proof = value.proof as string;
                            return { changes: 1 };
                        }
                        return { changes: 0 };
                    },
                }),
            }),
        }),
    } as unknown as DownloadsDatabase;
    jest.mocked(getDatabase).mockResolvedValue(db);
    jest.mocked(link)
        .mockReset()
        .mockImplementation(jest.requireActual('node:fs/promises').link);
});
afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
});
async function prepare() {
    await writeFile(filePath + '.part', 'verified archive');
    const partial = await lstat(filePath + '.part');
    return {
        partial,
        reservation: {
            path: filePath,
            partialPath: filePath + '.part',
            filename: 'show.ts',
        },
    };
}
it.each(['hardlink', 'copy'])(
    'recovers an unknown-length archive from the durable %s journal after restart',
    async (mode) => {
        const { partial, reservation } = await prepare();
        if (mode === 'copy')
            jest.mocked(link).mockRejectedValueOnce(
                Object.assign(new Error('unsupported'), { code: 'ENOTSUP' })
            );
        await finalizeCatchupPartial(
            reservation,
            partial,
            partial.size,
            (finalIdentity) =>
                recordArchiveFinalization(db, 1, {
                    version: 1,
                    filePath,
                    size: partial.size,
                    partialIdentity: partial,
                    finalIdentity,
                })
        );
        // No in-memory DownloadTask or completion DB update survives this restart.
        await resetStaleDownloads();
        expect(updates).toContainEqual(
            expect.objectContaining({
                status: 'completed',
                bytesDownloaded: partial.size,
                totalBytes: partial.size,
            })
        );
        expect(await readFile(filePath, 'utf8')).toBe('verified archive');
    }
);
it('pauses verified bytes when termination precedes promotion', async () => {
    const { partial, reservation } = await prepare();
    await expect(
        finalizeCatchupPartial(
            reservation,
            partial,
            partial.size,
            async (finalIdentity) => {
                await recordArchiveFinalization(db, 1, {
                    version: 1,
                    filePath,
                    size: partial.size,
                    partialIdentity: partial,
                    finalIdentity,
                });
                throw new Error('simulated termination');
            }
        )
    ).rejects.toThrow('termination');
    await resetStaleDownloads();
    expect(updates).toContainEqual(
        expect.objectContaining({
            status: 'paused',
            bytesDownloaded: partial.size,
        })
    );
    expect(await readFile(reservation.partialPath, 'utf8')).toBe(
        'verified archive'
    );
});
it('refuses same-size replacements and preserves unrelated partials during startup cleanup', async () => {
    const { partial, reservation } = await prepare();
    await finalizeCatchupPartial(
        reservation,
        partial,
        partial.size,
        (finalIdentity) =>
            recordArchiveFinalization(db, 1, {
                version: 1,
                filePath,
                size: partial.size,
                partialIdentity: partial,
                finalIdentity,
            })
    );
    await rename(filePath, join(directory, 'original'));
    await writeFile(filePath, 'untrusted bytes!');
    await writeFile(filePath + '.part', 'leave this alone');
    await resetStaleDownloads();
    expect(updates.some((value) => value.status === 'completed')).toBe(false);
    expect(await readFile(filePath + '.part', 'utf8')).toBe('leave this alone');
    expect(await readFile(filePath, 'utf8')).toBe('untrusted bytes!');
});
it('removes an owned incomplete copy before pausing its retained source', async () => {
    const { partial, reservation } = await prepare();
    await writeFile(filePath, 'half');
    await recordArchiveFinalization(db, 1, {
        version: 1,
        filePath,
        size: partial.size,
        partialIdentity: partial,
        finalIdentity: await lstat(filePath),
    });
    await resetStaleDownloads();
    expect(updates).toContainEqual(
        expect.objectContaining({
            status: 'paused',
            bytesDownloaded: partial.size,
        })
    );
    await expect(lstat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(reservation.partialPath, 'utf8')).toBe(
        'verified archive'
    );
});
it.each([
    '{}',
    'null',
    'bad json',
    JSON.stringify({
        version: 1,
        filePath: '/tmp/a',
        size: -1,
        partialIdentity: { dev: 1, ino: 1, birthtimeMs: 1 },
        finalIdentity: { dev: 1, ino: 1, birthtimeMs: 1 },
    }),
])('ignores malformed journal %s', (value) => {
    expect(parseArchiveFinalization(value)).toBeUndefined();
});

it('does not remove a valid journaled final when a retry was queued at shutdown', async () => {
    const { partial, reservation } = await prepare();
    await finalizeCatchupPartial(
        reservation,
        partial,
        partial.size,
        (finalIdentity) =>
            recordArchiveFinalization(db, 1, {
                version: 1,
                filePath,
                size: partial.size,
                partialIdentity: partial,
                finalIdentity,
            })
    );
    rows[0].status = 'queued';
    await resetStaleDownloads();
    expect(await readFile(filePath, 'utf8')).toBe('verified archive');
    expect(updates).toContainEqual(
        expect.objectContaining({ status: 'paused' })
    );
});

it.each(['downloading', 'queued'])(
    'detaches a replaced journaled partial instead of making %s recoverable',
    async (status) => {
        const { partial } = await prepare();
        await recordArchiveFinalization(db, 1, {
            version: 1,
            filePath,
            size: partial.size,
            partialIdentity: partial,
            finalIdentity: partial,
        });
        await rename(filePath + '.part', join(directory, 'original'));
        await writeFile(filePath + '.part', 'unrelated user file');
        rows[0].status = status;
        await resetStaleDownloads();
        expect(updates).toContainEqual(
            expect.objectContaining({
                status: 'failed',
                filePath: null,
            })
        );
        expect(updates.some((value) => value.status === 'paused')).toBe(false);
        expect(await readFile(filePath + '.part', 'utf8')).toBe(
            'unrelated user file'
        );
    }
);

it.each([false, true])(
    'recovers transfer-phase identity without treating it as completion (replaced=%s)',
    async (replaced) => {
        const { partial } = await prepare();
        await recordArchivePartial(db, 1, filePath, partial);
        // A same-sized final is insufficient without a finalization-phase journal.
        await writeFile(filePath, 'verified archive');
        if (replaced) {
            await rename(filePath + '.part', join(directory, 'original'));
            await writeFile(filePath + '.part', 'unrelated bytes!');
        }
        await resetStaleDownloads();
        expect(updates).toContainEqual(
            expect.objectContaining(
                replaced
                    ? { status: 'failed', filePath: null }
                    : { status: 'paused' }
            )
        );
        expect(updates.some((value) => value.status === 'completed')).toBe(
            false
        );
        expect(await readFile(filePath, 'utf8')).toBe('verified archive');
        expect(await readFile(filePath + '.part', 'utf8')).toBe(
            replaced ? 'unrelated bytes!' : 'verified archive'
        );
    }
);

it.each([0, 1])(
    'requires a durable row for the write-ahead capture pointer (changes=%s)',
    async (changes) => {
        const { partial } = await prepare();
        const proof = {
            version: 1 as const,
            phase: 'transfer' as const,
            filePath,
            partialIdentity: partial,
        };
        const run = jest.fn(() => ({ changes }));
        const set = jest.fn((_value: { proof: string }) => ({
            where: () => ({ run }),
        }));
        const database = {
            update: () => ({ set }),
        } as unknown as DownloadsDatabase;
        const capturePath = join(directory, '.iptvnator-cleanup-test/entry');
        const record = () =>
            recordArchiveCleanupPath(database, 1, proof, capturePath);
        if (changes === 0) expect(record).toThrow('ownership');
        else expect(record).not.toThrow();
        const saved = JSON.parse(set.mock.calls[0][0].proof);
        expect(saved).toEqual(
            expect.objectContaining({
                phase: 'transfer',
                partialCleanupPath: capturePath,
            })
        );
        expect(run).toHaveBeenCalledTimes(1);
    }
);
