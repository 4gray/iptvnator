import assert from 'node:assert/strict';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../../database.types';
import { createFavoriteTestCatalog } from './favorites-test-catalog';
import {
    addFavorite,
    getFavorites,
    getAllGlobalFavorites,
    isFavorite,
    removeFavorite,
} from '../favorites.operations';
import {
    deleteXtreamContent,
    restoreXtreamUserData,
} from '../xtream.operations';
import { persistContentMetadataIfMissing } from '../content-metadata.operations';
import { setAppState } from '../playlist.operations';

export async function verifyFavoriteRefresh(
    db: AppDatabase,
    original: { favorite_id: number; poster_url: string | null }
) {
    const catalog = createFavoriteTestCatalog(db);
    const favorites = () => getFavorites(db, 'p');
    const status = (value: string) =>
        setAppState(db, 'xtream-import-status:p:movie', value);
    await persistContentMetadataIfMissing(db, 1, {
        tmdbId: 123,
        releaseYear: 2001,
    });
    const removed = await deleteXtreamContent(db, 'p');
    await catalog(2, 8, 'DEF');
    await restoreXtreamUserData(db, 'p', removed.favorites, []);
    await status('completed');
    const [saved] = await favorites();
    assert(saved, 'ABC must remain after only DEF is imported');
    assert.equal(saved.title, 'ABC');
    assert.equal(saved.tmdb_id, 123);
    assert.equal(saved.release_year, 2001);
    assert.equal(saved.id, null);
    assert.equal(saved.favorite_id, original.favorite_id);
    assert.equal(saved.catalog_status, 'missing');
    assert.deepEqual(
        removed.favorites,
        [],
        'refresh must not replay canonical favorites'
    );
    assert.equal((await getAllGlobalFavorites(db))[0].title, 'ABC');
    await deleteXtreamContent(db, 'p');
    await catalog(3, 7, 'ABC renamed', 'movie', 'p', {
        posterUrl: '',
        backdropUrl: '',
    });
    await status('completed');
    const [returned] = await favorites();
    assert.equal(returned.id, 3);
    assert.equal(returned.favorite_id, original.favorite_id);
    assert.equal(returned.catalog_status, 'present');
    assert.equal(returned.poster_url, original.poster_url);
    assert.equal(
        (await db.select().from(schema.favorites))[0].posterUrl,
        original.poster_url
    );
    assert.equal((await db.select().from(schema.favorites))[0].contentId, 3);
    assert(await isFavorite(db, 3, 'p'));
    await addFavorite(db, 3, 'p');
    assert.equal((await favorites()).length, 1);
    await removeFavorite(db, 3, 'p');
    assert.deepEqual(await favorites(), []);
}
