import type { TmdbCacheEntry } from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { getTmdbMetadata, setTmdbMetadata } from './tmdb.operations';

function createSelectMock(rows: unknown[]) {
    const limit = jest.fn().mockResolvedValue(rows);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    return { db: { select } as unknown as AppDatabase, select, where, limit };
}

function createInsertMock() {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn().mockReturnValue({ values });
    return {
        db: { insert } as unknown as AppDatabase,
        insert,
        values,
        onConflictDoUpdate,
    };
}

describe('tmdb.operations', () => {
    it('returns null on cache miss', async () => {
        const { db } = createSelectMock([]);
        await expect(
            getTmdbMetadata(db, 'movie', 'id:603', 'en-US')
        ).resolves.toBeNull();
    });

    it('maps a cached row to a TmdbCacheEntry', async () => {
        const { db } = createSelectMock([
            {
                id: 1,
                mediaType: 'movie',
                lookupKey: 'id:603',
                language: 'en-US',
                tmdbId: 603,
                payload: '{"id":603}',
                fetchedAt: '2026-07-01T00:00:00.000Z',
            },
        ]);

        await expect(
            getTmdbMetadata(db, 'movie', 'id:603', 'en-US')
        ).resolves.toEqual({
            mediaType: 'movie',
            lookupKey: 'id:603',
            language: 'en-US',
            tmdbId: 603,
            payload: '{"id":603}',
            fetchedAt: '2026-07-01T00:00:00.000Z',
        });
    });

    it('upserts entries and refreshes fetchedAt', async () => {
        const { db, values, onConflictDoUpdate } = createInsertMock();
        const entry: TmdbCacheEntry = {
            mediaType: 'tv',
            lookupKey: 'title:dark|year:2017',
            language: 'de-DE',
            tmdbId: 70523,
            payload: null,
        };

        await expect(setTmdbMetadata(db, entry)).resolves.toEqual({
            success: true,
        });

        expect(values).toHaveBeenCalledWith(
            expect.objectContaining({
                mediaType: 'tv',
                lookupKey: 'title:dark|year:2017',
                language: 'de-DE',
                tmdbId: 70523,
                payload: null,
                fetchedAt: expect.any(String),
            })
        );
        expect(onConflictDoUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                set: expect.objectContaining({
                    tmdbId: 70523,
                    payload: null,
                    fetchedAt: expect.any(String),
                }),
            })
        );
    });

    it('persists negative matches (tmdbId null)', async () => {
        const { db, values } = createInsertMock();
        await setTmdbMetadata(db, {
            mediaType: 'movie',
            lookupKey: 'title:unknown movie|year:',
            language: 'en-US',
            tmdbId: null,
            payload: null,
        });

        expect(values).toHaveBeenCalledWith(
            expect.objectContaining({ tmdbId: null, payload: null })
        );
    });
});
