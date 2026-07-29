import {
    createDbMock,
    mockDrizzle,
    mockDrizzleOrmModule,
    resetDrizzleMocks,
} from './operations.test-helpers';

jest.mock('drizzle-orm', () => mockDrizzleOrmModule());

import * as schema from '@iptvnator/shared/database/schema';
import type { VodSourcePin } from '@iptvnator/shared/interfaces';
import {
    clearVodSourcePin,
    getVodSourcePin,
    setVodSourcePin,
    clearVodSourcePinsForPlaylist,
} from './vod-source-pin.operations';

const tmdbRow = {
    id: 1,
    matchKey: 'tmdb:603',
    playlistId: 'playlist-1',
    contentId: 501,
    portalType: 'xtream' as const,
    updatedAt: '2026-07-20T10:00:00.000Z',
};

const titleRow = {
    id: 2,
    matchKey: 'title:the matrix:1999',
    playlistId: 'playlist-2',
    contentId: 902,
    portalType: 'xtream' as const,
    updatedAt: '2026-07-01T10:00:00.000Z',
};

/**
 * Pins upsert, and run inside a transaction — so the chain has to end in a
 * synchronous `.run()` rather than resolving, exactly as the driver requires.
 */
function createUpsertDbMock() {
    const mock = createDbMock();
    const insertRun = jest.fn();
    const onConflictDoUpdate = jest.fn().mockReturnValue({ run: insertRun });
    mock.insertValues.mockReturnValue({ onConflictDoUpdate });
    return { ...mock, onConflictDoUpdate, insertRun };
}

describe('vod-source-pin.operations', () => {
    beforeEach(() => {
        resetDrizzleMocks();
    });

    describe('getVodSourcePin', () => {
        it('returns null without querying for an empty key list', async () => {
            const { db, select } = createDbMock();

            await expect(getVodSourcePin(db, [])).resolves.toBeNull();
            expect(select).not.toHaveBeenCalled();
        });

        it('returns null when no pin row exists', async () => {
            const { db } = createDbMock([[]]);

            await expect(getVodSourcePin(db, ['tmdb:603'])).resolves.toBeNull();
        });

        it('honours caller key order, not the order SQLite returned', async () => {
            // SQLite hands back the older title-keyed row first; the caller
            // passes the tmdb key first because it is the more trusted one.
            // Reading in row order would let a stale title pin shadow it.
            const { db } = createDbMock([[titleRow, tmdbRow]]);

            await expect(
                getVodSourcePin(db, ['tmdb:603', 'title:the matrix:1999'])
            ).resolves.toEqual({
                matchKey: 'tmdb:603',
                playlistId: 'playlist-1',
                contentId: 501,
                portalType: 'xtream',
                updatedAt: '2026-07-20T10:00:00.000Z',
            });
        });

        it('falls back to the next key when the first has no row', async () => {
            const { db } = createDbMock([[titleRow]]);

            const pin = await getVodSourcePin(db, [
                'tmdb:603',
                'title:the matrix:1999',
            ]);

            expect(pin?.matchKey).toBe('title:the matrix:1999');
        });

        it('reports a missing timestamp as undefined', async () => {
            const { db } = createDbMock([[{ ...tmdbRow, updatedAt: null }]]);

            const pin = await getVodSourcePin(db, ['tmdb:603']);

            expect(pin?.updatedAt).toBeUndefined();
        });

        it('drops junk keys and caps the lookup at eight keys', async () => {
            const { db } = createDbMock([[]]);
            const keys = [
                '',
                null as unknown as string,
                undefined as unknown as string,
                42 as unknown as string,
                'k1',
                'k2',
                'k3',
                'k4',
                'k5',
                'k6',
                'k7',
                'k8',
                'k9',
            ];

            await getVodSourcePin(db, keys);

            expect(mockDrizzle.inArray).toHaveBeenCalledWith(
                schema.vodSourcePins.matchKey,
                ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']
            );
        });
    });

    describe('setVodSourcePin', () => {
        const pin: VodSourcePin = {
            matchKey: 'tmdb:603',
            playlistId: 'playlist-1',
            contentId: 501,
            portalType: 'xtream',
        };

        it('upserts on the match key', async () => {
            const { db, insert, insertValues, onConflictDoUpdate } =
                createUpsertDbMock();

            await expect(setVodSourcePin(db, pin)).resolves.toEqual({
                success: true,
            });

            expect(insert).toHaveBeenCalledWith(schema.vodSourcePins);
            expect(insertValues).toHaveBeenCalledWith(
                expect.objectContaining({
                    matchKey: 'tmdb:603',
                    playlistId: 'playlist-1',
                    contentId: 501,
                    portalType: 'xtream',
                    updatedAt: expect.any(String),
                })
            );
            expect(onConflictDoUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    target: schema.vodSourcePins.matchKey,
                    set: expect.objectContaining({
                        playlistId: 'playlist-1',
                        contentId: 501,
                        portalType: 'xtream',
                        updatedAt: expect.any(String),
                    }),
                })
            );
        });

        it('retires the aliases in the same transaction as the write', async () => {
            const { db, transaction, insertRun, deleteRun, deleteWhere } =
                createUpsertDbMock();

            await setVodSourcePin(db, pin, [
                'title:the matrix:1999',
                'title:the matrix:',
            ]);

            // Two calls could half-apply, and neither half-outcome has an
            // honest answer: a surviving alias wins the next lookup, while a
            // rolled-back-looking failure leaves the canonical row durable.
            expect(transaction).toHaveBeenCalledTimes(1);
            expect(insertRun).toHaveBeenCalledTimes(1);
            expect(deleteRun).toHaveBeenCalledTimes(1);
            expect(deleteWhere).toHaveBeenCalled();
        });

        it('never retires the key it just wrote', async () => {
            const { db, deleteRun } = createUpsertDbMock();

            await setVodSourcePin(db, pin, ['tmdb:603']);

            expect(deleteRun).not.toHaveBeenCalled();
        });

        it('stores the pin under every alias it was given', async () => {
            const { db, insertValues, insertRun, transaction } =
                createUpsertDbMock();

            await setVodSourcePin(db, pin, [], ['title:the matrix:1999']);

            // A movie's identity grows: the film keyed `tmdb:603` today was
            // `title:the matrix:1999` before enrichment, and reopening it
            // cold asks for the poorer key first. One row would answer
            // nothing until enrichment landed — if it ever did.
            expect(transaction).toHaveBeenCalledTimes(1);
            expect(insertRun).toHaveBeenCalledTimes(2);
            expect(
                insertValues.mock.calls.map(([row]) => row.matchKey)
            ).toEqual(['tmdb:603', 'title:the matrix:1999']);
        });

        it('writes each key once, however often it is passed', async () => {
            const { db, insertRun } = createUpsertDbMock();

            await setVodSourcePin(db, pin, [], ['tmdb:603', 'tmdb:603']);

            expect(insertRun).toHaveBeenCalledTimes(1);
        });

        it('never retires an alias it just wrote', async () => {
            const { db, deleteRun } = createUpsertDbMock();

            // The same key can legitimately appear in both lists — it was an
            // alias of the PREVIOUS pin and is a write key of this one. Taking
            // the retirement literally would delete the row just written.
            await setVodSourcePin(
                db,
                pin,
                ['title:the matrix:1999'],
                ['title:the matrix:1999']
            );

            expect(deleteRun).not.toHaveBeenCalled();
        });

        it('refuses a pin with no usable key rather than reporting success', async () => {
            const { db, insertRun, transaction } = createUpsertDbMock();

            await expect(
                setVodSourcePin(db, { ...pin, matchKey: '' })
            ).resolves.toEqual({ success: false });

            expect(transaction).not.toHaveBeenCalled();
            expect(insertRun).not.toHaveBeenCalled();
        });

        it('touches nothing else when there is no alias to retire', async () => {
            const { db, deleteRun } = createUpsertDbMock();

            await setVodSourcePin(db, pin);

            expect(deleteRun).not.toHaveBeenCalled();
        });

        it('writes an ISO timestamp on both the insert and the update', async () => {
            const { db, insertValues, onConflictDoUpdate } =
                createUpsertDbMock();

            await setVodSourcePin(db, pin);

            const inserted = insertValues.mock.calls[0][0] as {
                updatedAt: string;
            };
            const updated = onConflictDoUpdate.mock.calls[0][0] as {
                set: { updatedAt: string };
            };

            expect(new Date(inserted.updatedAt).toISOString()).toBe(
                inserted.updatedAt
            );
            expect(updated.set.updatedAt).toBe(inserted.updatedAt);
        });
    });

    describe('clearVodSourcePin', () => {
        it('reports failure without touching the database for no keys', async () => {
            const { db, deleteFn } = createDbMock();

            await expect(clearVodSourcePin(db, [])).resolves.toEqual({
                success: false,
            });
            expect(deleteFn).not.toHaveBeenCalled();
        });

        it('deletes every alias of the movie in one statement', async () => {
            const { db, deleteFn, deleteWhere } = createDbMock();

            await expect(
                clearVodSourcePin(db, ['tmdb:603', 'title:the matrix:1999'])
            ).resolves.toEqual({ success: true });

            expect(deleteFn).toHaveBeenCalledWith(schema.vodSourcePins);
            expect(deleteWhere).toHaveBeenCalledTimes(1);
            expect(mockDrizzle.inArray).toHaveBeenCalledWith(
                schema.vodSourcePins.matchKey,
                ['tmdb:603', 'title:the matrix:1999']
            );
        });
    });

    describe('clearVodSourcePinsForPlaylist', () => {
        it('deletes by playlist, with no key cap to truncate', async () => {
            const { db, deleteFn, deleteWhere } = createDbMock();

            await expect(
                clearVodSourcePinsForPlaylist(db, 'playlist-1')
            ).resolves.toEqual({ success: true });

            // The keyed clear caps its IN list at MAX_KEYS_PER_LOOKUP, so a
            // playlist with more pinned movies than that kept the surplus —
            // and still reported success.
            expect(deleteFn).toHaveBeenCalledWith(schema.vodSourcePins);
            expect(deleteWhere).toHaveBeenCalled();
        });

        it('refuses a blank playlist id rather than clearing everything', async () => {
            const { db, deleteFn } = createDbMock();

            await expect(
                clearVodSourcePinsForPlaylist(db, '')
            ).resolves.toEqual({ success: false });

            expect(deleteFn).not.toHaveBeenCalled();
        });
    });
});
