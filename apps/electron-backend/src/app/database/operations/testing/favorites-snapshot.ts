import assert from 'node:assert/strict';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../../database.types';
import { createFavoriteTestCatalog } from './favorites-test-catalog';
import { persistContentMetadataIfMissing } from '../content-metadata.operations';
import {
    addFavorite,
    removeFavorite,
    getFavorites,
    getFavoritesForBackup,
} from '../favorites.operations';
import { deleteXtreamContent } from '../xtream.operations';
import { setAppState } from '../playlist.operations';

export async function verifyFavoriteSnapshot(db: AppDatabase) {
    const catalog = createFavoriteTestCatalog(db);
    await persistContentMetadataIfMissing(db, 1, {
        tmdbId: 10,
        releaseYear: 2000,
        originalTitle: 'Original',
    });
    const [original] = await db.select().from(schema.favorites);
    const snapshot = (row: typeof original) => ({
        title: row.title,
        poster: row.posterUrl,
        backdrop: row.backdropUrl,
        original: row.originalTitle,
        tmdb: row.tmdbId,
        year: row.releaseYear,
    });
    await deleteXtreamContent(db, 'p');
    await catalog(2, 7, 'Replacement', 'movie', 'p', {
        posterUrl: 'https://art.invalid/replacement.jpg',
        backdropUrl: 'https://art.invalid/replacement-wide.jpg',
        originalTitle: 'Replacement original',
    });
    await setAppState(db, 'xtream-import-status:p:movie', 'completed');
    assert.deepEqual(
        snapshot((await db.select().from(schema.favorites))[0]),
        snapshot(original),
        'unknown catalog identity must not overwrite the durable snapshot'
    );
    for (const read of [getFavorites, getFavoritesForBackup]) {
        const [row] = await read(db, 'p');
        assert.equal(row.title, original.title);
        assert.equal(row.poster_url, original.posterUrl);
        assert.equal(row.backdrop_url, original.backdropUrl);
        assert.equal(row.original_title, original.originalTitle);
    }
    await persistContentMetadataIfMissing(db, 2, {
        tmdbId: 20,
        releaseYear: 2020,
    });
    assert.equal((await getFavorites(db, 'p'))[0].catalog_status, 'missing');
    assert.equal((await getFavorites(db, 'p'))[0].title, original.title);
    await deleteXtreamContent(db, 'p');
    await catalog(3, 7, 'ABC renamed', 'movie', 'p', {
        tmdbId: 10,
        posterUrl: 'https://art.invalid/returned.jpg',
        backdropUrl: 'https://art.invalid/returned-wide.jpg',
        originalTitle: 'ABC original renamed',
    });
    await setAppState(db, 'xtream-import-status:p:movie', 'completed');
    assert.deepEqual(
        snapshot((await db.select().from(schema.favorites))[0]),
        snapshot(original),
        'partial identity is insufficient to replace the saved fields'
    );
    await persistContentMetadataIfMissing(db, 3, { releaseYear: 2000 });
    const confirmed = {
        ...snapshot(original),
        title: 'ABC renamed',
        poster: 'https://art.invalid/returned.jpg',
        backdrop: 'https://art.invalid/returned-wide.jpg',
        original: 'ABC original renamed',
    };
    assert.deepEqual(
        snapshot((await db.select().from(schema.favorites))[0]),
        confirmed,
        'detail enrichment must refresh the snapshot as soon as identity is confirmed'
    );
    await deleteXtreamContent(db, 'p');
    const [missing] = await getFavoritesForBackup(db, 'p');
    assert.equal(missing.title, confirmed.title);
    assert.equal(missing.poster_url, confirmed.poster);
    assert.equal(missing.backdrop_url, confirmed.backdrop);
    await catalog(3, 7, '  ', 'movie', 'p', {
        tmdbId: 10,
        posterUrl: ' ',
        backdropUrl: '',
        originalTitle: '',
    });
    await persistContentMetadataIfMissing(db, 3, { releaseYear: 2000 });
    assert.deepEqual(
        snapshot((await db.select().from(schema.favorites))[0]),
        confirmed,
        'blank fields on a confirmed return must preserve the saved snapshot'
    );
    // A fully confirming duplicate must outrank an earlier sparse category copy.
    await deleteXtreamContent(db, 'p');
    await catalog(6, 7, 'Sparse copy', 'movie', 'p', { tmdbId: 10 });
    await catalog(7, 7, 'Confirmed copy', 'movie', 'p', {
        tmdbId: 10,
        releaseYear: 2000,
        posterUrl: 'confirmed.jpg',
    });
    await setAppState(db, 'xtream-import-status:p:movie', 'completed');
    const [duplicate] = await getFavoritesForBackup(db, 'p');
    assert.equal(
        duplicate.id,
        7,
        'fully confirming duplicate wins over sparse lower ID'
    );
    assert.equal(duplicate.title, 'Confirmed copy');
    assert.equal(duplicate.poster_url, 'confirmed.jpg');
    const [duplicateSaved] = await db.select().from(schema.favorites);
    assert.equal(duplicateSaved.contentId, 7);
    assert.equal(duplicateSaved.title, 'Confirmed copy');
    await deleteXtreamContent(db, 'p');
    await catalog(3, 7, 'Confirmed copy', 'movie', 'p', {
        tmdbId: 10,
        releaseYear: 2000,
    });
    await setAppState(db, 'xtream-import-status:p:movie', 'completed');
    // A replacement's year/artwork must not fill gaps before its TMDB identity is known.
    await removeFavorite(db, 3, 'p');
    await deleteXtreamContent(db, 'p');
    await catalog(4, 7, 'Known TMDB only', 'movie', 'p', {
        tmdbId: 10,
        backdropUrl: null,
    });
    await addFavorite(db, 4, 'p');
    await deleteXtreamContent(db, 'p');
    await catalog(5, 7, 'Year without identity', 'movie', 'p', {
        releaseYear: 2020,
        backdropUrl: null,
    });
    await setAppState(db, 'xtream-import-status:p:movie', 'completed');
    await persistContentMetadataIfMissing(db, 5, {
        backdropUrl: 'https://art.invalid/unverified.jpg',
    });
    const [partial] = await getFavoritesForBackup(db, 'p');
    assert.equal(partial.release_year, null);
    assert.equal(partial.backdrop_url, null);
    assert.equal(
        (await db.select().from(schema.favorites))[0].backdropUrl,
        null
    );
}
