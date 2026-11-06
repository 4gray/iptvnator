import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../../database.types';
import { setParentalLockActive } from '../../parental-lock-state';
import { createFavoriteTestCatalog } from './favorites-test-catalog';
import {
    addFavorite,
    getFavorites,
    getAllGlobalFavorites,
    getGlobalFavorites,
    getFavoritesForBackup,
} from '../favorites.operations';

export async function verifyUnlockedFavoriteDuplicate(db: AppDatabase) {
    const catalog = createFavoriteTestCatalog(db);
    for (const [index, type] of (
        ['live', 'movie', 'series'] as const
    ).entries()) {
        const first = 10 + index * 10;
        const second = first + 1;
        const xtreamId = 100 + index;
        await catalog(first, xtreamId, 'Locked copy', type);
        await catalog(second, xtreamId, 'Unlocked copy', type);
        await db
            .update(schema.categories)
            .set({ locked: true })
            .where(eq(schema.categories.id, first));
        await addFavorite(db, second, 'p');
        setParentalLockActive(true);
        const reads = [getFavorites(db, 'p'), getAllGlobalFavorites(db)];
        if (type === 'live') reads.push(getGlobalFavorites(db));
        for (const rows of await Promise.all(reads)) {
            assert.equal(
                rows.find((row) => row.xtream_id === xtreamId)?.id,
                second,
                'an unlocked duplicate must remain visible'
            );
        }
        await db
            .update(schema.categories)
            .set({ locked: true })
            .where(eq(schema.categories.id, second));
        assert.equal(
            (await getFavorites(db, 'p')).some(
                (row) => row.xtream_id === xtreamId
            ),
            false,
            'all locked copies must still be withheld'
        );
        assert.equal(
            (await getFavoritesForBackup(db, 'p')).find(
                (row) => row.xtream_id === xtreamId
            )?.id,
            first,
            'backup remains unfiltered'
        );
        setParentalLockActive(false);
        assert.equal(
            (await getFavorites(db, 'p')).find(
                (row) => row.xtream_id === xtreamId
            )?.id,
            first
        );
    }
}
