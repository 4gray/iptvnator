import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import {
    getHandler,
    mockEq,
    mockGetDatabase,
    setupDownloadsEventsHarness,
} from './downloads.test-helpers';

const movieSnapshot: DownloadMetadataSnapshot = {
    version: 1,
    language: 'en',
    mediaKind: 'movie',
    title: 'Refreshed Movie',
    plot: 'Stored for offline details.',
};

function createSingleRowDatabase(row: Record<string, unknown> | undefined) {
    const updateWhere = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn<
        { where: typeof updateWhere },
        [Record<string, unknown>]
    >(() => ({ where: updateWhere }));
    const update = jest.fn(() => ({ set }));
    const limit = jest.fn().mockResolvedValue(row ? [row] : []);
    const db = {
        select: jest.fn(() => ({
            from: jest.fn(() => ({
                where: jest.fn(() => ({ limit })),
            })),
        })),
        update,
    };
    mockGetDatabase.mockResolvedValue(db);
    return { db, limit, set, updateWhere };
}

function createGroupedDatabase(
    representative: Record<string, unknown>,
    members: Array<Record<string, unknown>>
) {
    const limit = jest.fn().mockResolvedValue([representative]);
    const groupWhere = jest.fn().mockResolvedValue(members);
    const select = jest
        .fn()
        .mockImplementationOnce(() => ({
            from: jest.fn(() => ({
                where: jest.fn(() => ({ limit })),
            })),
        }))
        .mockImplementationOnce(() => ({
            from: jest.fn(() => ({ where: groupWhere })),
        }));
    const run = jest.fn();
    const updateWhere = jest.fn<{ run: typeof run }, [unknown]>(() => ({
        run,
    }));
    const set = jest.fn<
        { where: typeof updateWhere },
        [Record<string, unknown>]
    >(() => ({ where: updateWhere }));
    const transactionUpdate = jest.fn(() => ({ set }));
    const transaction = jest.fn(
        (operation: (tx: { update: typeof transactionUpdate }) => void) =>
            operation({ update: transactionUpdate })
    );
    const update = jest.fn();
    const db = { select, transaction, update };
    mockGetDatabase.mockResolvedValue(db);
    return {
        db,
        groupWhere,
        run,
        set,
        transaction,
        transactionUpdate,
        update,
        updateWhere,
    };
}

describe('downloads events: managed metadata updates', () => {
    beforeEach(async () => {
        await setupDownloadsEventsHarness();
    });

    it('updates only the managed movie id', async () => {
        const schema = await import('../../database/schema');
        const { set, updateWhere } = createSingleRowDatabase({
            contentType: 'vod',
            id: 42,
            playlistId: 'playlist-a',
            seriesXtreamId: null,
        });

        await expect(
            getHandler('DOWNLOADS_UPDATE_METADATA')(null, 42, movieSnapshot)
        ).resolves.toEqual({ success: true });

        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                metadataSnapshot: JSON.stringify(movieSnapshot),
                updatedAt: expect.anything(),
            })
        );
        expect(mockEq).toHaveBeenCalledWith(schema.downloads.id, 42);
        expect(mockEq).toHaveBeenCalledTimes(2);
        expect(updateWhere).toHaveBeenCalledTimes(1);
    });

    it('updates the authoritative episode group while preserving each episode', async () => {
        const schema = await import('../../database/schema');
        const representative = {
            contentType: 'episode',
            id: 41,
            playlistId: 'stored-playlist',
            seriesXtreamId: 700,
        };
        const members = [
            {
                episodeNumber: 1,
                id: 41,
                metadataSnapshot: JSON.stringify({
                    ...movieSnapshot,
                    mediaKind: 'series',
                    title: 'Old Parent',
                    episode: {
                        episodeNumber: 1,
                        seasonNumber: 2,
                        title: 'Member One',
                    },
                }),
                seasonNumber: 2,
                title: 'Stored One',
            },
            {
                episodeNumber: 2,
                id: 42,
                metadataSnapshot: JSON.stringify({
                    ...movieSnapshot,
                    mediaKind: 'series',
                    title: 'Old Parent',
                    episode: {
                        episodeNumber: 2,
                        seasonNumber: 2,
                        title: 'Member Two',
                    },
                }),
                seasonNumber: 2,
                title: 'Stored Two',
            },
        ];
        const database = createGroupedDatabase(representative, members);
        const refreshed: DownloadMetadataSnapshot = {
            ...movieSnapshot,
            mediaKind: 'series',
            title: 'Refreshed Parent',
            episode: {
                episodeNumber: 99,
                seasonNumber: 9,
                title: 'Representative Episode',
            },
        };

        await expect(
            getHandler('DOWNLOADS_UPDATE_METADATA')(null, 41, refreshed)
        ).resolves.toEqual({ success: true });

        expect(database.groupWhere).toHaveBeenCalledTimes(1);
        expect(mockEq).toHaveBeenCalledWith(
            schema.downloads.playlistId,
            'stored-playlist'
        );
        expect(mockEq).toHaveBeenCalledWith(
            schema.downloads.contentType,
            'episode'
        );
        expect(mockEq).toHaveBeenCalledWith(
            schema.downloads.seriesXtreamId,
            700
        );
        expect(database.transaction).toHaveBeenCalledTimes(1);
        expect(database.update).not.toHaveBeenCalled();
        expect(database.transactionUpdate).toHaveBeenCalledTimes(2);
        expect(database.run).toHaveBeenCalledTimes(2);
        for (const [write] of database.set.mock.calls) {
            expect(write).toEqual(
                expect.objectContaining({ updatedAt: expect.anything() })
            );
        }

        const encodedWrites = database.set.mock.calls.map(
            ([write]) =>
                JSON.parse(
                    (write as { metadataSnapshot: string }).metadataSnapshot
                ) as DownloadMetadataSnapshot
        );
        expect(encodedWrites).toEqual([
            {
                ...refreshed,
                episode: {
                    episodeNumber: 1,
                    seasonNumber: 2,
                    title: 'Member One',
                },
            },
            {
                ...refreshed,
                episode: {
                    episodeNumber: 2,
                    seasonNumber: 2,
                    title: 'Member Two',
                },
            },
        ]);
    });

    it('synthesizes missing episode metadata from authoritative row fields', async () => {
        const member = {
            episodeNumber: 3,
            id: 43,
            metadataSnapshot: '{corrupt',
            seasonNumber: 4,
            title: 'Stored Episode Title',
        };
        const database = createGroupedDatabase(
            {
                contentType: 'episode',
                id: 43,
                playlistId: 'playlist-a',
                seriesXtreamId: 700,
            },
            [member]
        );
        const refreshed: DownloadMetadataSnapshot = {
            ...movieSnapshot,
            mediaKind: 'series',
            title: 'Refreshed Parent',
        };

        await expect(
            getHandler('DOWNLOADS_UPDATE_METADATA')(null, 43, refreshed)
        ).resolves.toEqual({ success: true });

        const write = database.set.mock.calls[0][0] as {
            metadataSnapshot: string;
        };
        expect(JSON.parse(write.metadataSnapshot)).toEqual({
            ...refreshed,
            episode: {
                episodeNumber: 3,
                seasonNumber: 4,
                title: 'Stored Episode Title',
            },
        });
    });

    it('updates only an ungrouped episode', async () => {
        const { set, updateWhere } = createSingleRowDatabase({
            contentType: 'episode',
            id: 42,
            playlistId: 'playlist-a',
            seriesXtreamId: null,
        });
        const snapshot: DownloadMetadataSnapshot = {
            ...movieSnapshot,
            mediaKind: 'series',
        };

        await expect(
            getHandler('DOWNLOADS_UPDATE_METADATA')(null, 42, snapshot)
        ).resolves.toEqual({ success: true });

        expect(set).toHaveBeenCalledTimes(1);
        expect(updateWhere).toHaveBeenCalledTimes(1);
    });

    it('returns a stable missing-row failure without writing', async () => {
        const { db } = createSingleRowDatabase(undefined);

        await expect(
            getHandler('DOWNLOADS_UPDATE_METADATA')(null, 404, movieSnapshot)
        ).resolves.toEqual({
            error: 'Download not found',
            success: false,
        });
        expect(db.update).not.toHaveBeenCalled();
    });

    it('rejects invalid and unsafe snapshots before accessing the database', async () => {
        const invalid = { ...movieSnapshot, title: ' ' };
        const unsafe = {
            ...movieSnapshot,
            cast: [{ name: 'Actor', private: { cookie: 'secret' } }],
        };

        for (const snapshot of [invalid, unsafe]) {
            const result = await getHandler('DOWNLOADS_UPDATE_METADATA')(
                null,
                42,
                snapshot
            );
            expect(result).toEqual({
                error: 'Invalid download metadata snapshot',
                success: false,
            });
        }
        expect(mockGetDatabase).not.toHaveBeenCalled();
    });

    it('does not commit a partial group when a member write fails', async () => {
        const representative = {
            contentType: 'episode',
            id: 41,
            playlistId: 'playlist-a',
            seriesXtreamId: 700,
        };
        const members = [
            {
                episodeNumber: 1,
                id: 41,
                metadataSnapshot: null,
                seasonNumber: 1,
                title: 'One',
            },
            {
                episodeNumber: 2,
                id: 42,
                metadataSnapshot: null,
                seasonNumber: 1,
                title: 'Two',
            },
        ];
        const database = createGroupedDatabase(representative, members);
        const pending: number[] = [];
        const committed: number[] = [];
        database.updateWhere.mockImplementation((predicate) => ({
            run: jest.fn(() => {
                pending.push(predicate as number);
                if (pending.length === 2) {
                    throw new Error('disk full');
                }
            }),
        }));
        database.transaction.mockImplementation((operation) => {
            operation({ update: database.transactionUpdate });
            committed.push(...pending);
        });
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            await expect(
                getHandler('DOWNLOADS_UPDATE_METADATA')(null, 41, {
                    ...movieSnapshot,
                    mediaKind: 'series',
                })
            ).resolves.toEqual({
                error: 'Could not update download metadata',
                success: false,
            });
        } finally {
            consoleError.mockRestore();
        }

        expect(database.transaction).toHaveBeenCalledTimes(1);
        expect(committed).toEqual([]);
    });
});
