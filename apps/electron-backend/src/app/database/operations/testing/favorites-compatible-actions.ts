import assert from 'node:assert/strict';
import type { AppDatabase } from '../../database.types';
import { createFavoriteTestCatalog } from './favorites-test-catalog';
import { getContentByXtreamId } from '../content.operations';
import {
    addFavorite,
    getFavorites,
    isFavorite,
    removeFavorite,
} from '../favorites.operations';
import { setAppState } from '../playlist.operations';

export async function verifyCompatibleFavoriteActions(db: AppDatabase) {
    const catalog = createFavoriteTestCatalog(db);
    for (const [index, type] of (
        ['movie', 'series', 'live'] as const
    ).entries()) {
        const id = 100 + index * 10;
        await catalog(id, 500, 'Conflicting copy', type, 'p', {
            tmdbId: 200,
            releaseYear: 2000,
        });
        await catalog(id + 1, 500, 'Sparse copy', type);
        await catalog(id + 2, 500, 'Displayed original', type, 'p', {
            tmdbId: 100,
            releaseYear: 1995,
        });
        await catalog(id + 3, 500, 'Other source', type, 'other', {
            tmdbId: 100,
            releaseYear: 1995,
        });
        await addFavorite(db, id + 2, 'p');
        await setAppState(db, `xtream-import-status:p:${type}`, 'completed');
        const row = await getContentByXtreamId(db, 500, 'p', type, {
            tmdbId: 100,
            releaseYear: 1995,
        });
        assert.equal(
            row?.id,
            id + 2,
            'identity-qualified actions must resolve the compatible duplicate'
        );
        assert(await isFavorite(db, row.id, 'p'));
        await removeFavorite(db, row.id, 'p');
        assert.equal(
            (await getFavorites(db, 'p')).filter(
                (item) => item.type === type && item.xtream_id === 500
            ).length,
            0
        );
        await addFavorite(db, row.id, 'p');
        assert.equal(
            (await getFavorites(db, 'p')).find(
                (item) => item.type === type && item.xtream_id === 500
            )?.id,
            id + 2
        );
        assert.equal(
            (await getContentByXtreamId(db, 500, 'p', type))?.id,
            id,
            'legacy lookup remains unchanged'
        );
        assert.equal(
            (await getContentByXtreamId(db, 500, 'p', type, { tmdbId: 999 }))
                ?.id,
            id + 1,
            'sparse fallback cannot select a contrary known identity'
        );
        assert.equal(
            (
                await getContentByXtreamId(db, 500, 'p', type, {
                    tmdbId: 0,
                    releaseYear: 12,
                })
            )?.id,
            id,
            'invalid metadata retains legacy behavior'
        );
    }
}
