import assert from 'node:assert/strict';
import { closeDatabase, initDatabase } from '@iptvnator/shared/database';
import type { AppDatabase } from '../../database.types';
import { createFavoriteTestCatalog } from './favorites-test-catalog';
import {
    addFavorite,
    getFavorites,
    getFavoritesForBackup,
    isFavorite,
    removeFavorite,
} from '../favorites.operations';
import {
    deleteXtreamContent,
    restoreXtreamFavorites,
} from '../xtream.operations';
import { persistContentMetadataIfMissing } from '../content-metadata.operations';
import { setAppState } from '../playlist.operations';

export async function verifyFavoriteConflictLatch(initial: AppDatabase) {
    let db = initial;
    for (const [index, type] of (
        ['movie', 'series', 'live'] as const
    ).entries()) {
        let catalog = createFavoriteTestCatalog(db);
        const id = 100 + index * 10;
        const providerId = 500;
        const complete = () =>
            setAppState(db, `xtream-import-status:p:${type}`, 'completed');
        const saved = async () => {
            const row = (await getFavorites(db, 'p')).find(
                (row) => row.xtream_id === providerId && row.type === type
            );
            assert(row, 'Expected retained favorite');
            return row;
        };
        await catalog(id, providerId, 'Original', type, 'p', {
            tmdbId: 100,
            releaseYear: 2000,
        });
        await addFavorite(db, id, 'p');
        const original = await saved();
        await deleteXtreamContent(db, 'p');
        await catalog(id + 1, providerId, 'Replacement', type, 'p', {
            tmdbId: 200,
        });
        await complete();
        assert.equal((await saved()).catalog_status, 'missing');
        await deleteXtreamContent(db, 'p');
        await catalog(id + 2, providerId, 'Sparse replacement', type);
        await complete();
        assert.equal(
            (await saved()).catalog_status,
            'missing',
            'known conflict must survive a later sparse catalog'
        );
        assert.equal(await isFavorite(db, id + 2, 'p'), false);
        await removeFavorite(db, id + 2, 'p');
        assert.equal(
            (await saved()).favorite_id,
            original.favorite_id,
            'replacement heart cannot remove the original'
        );
        closeDatabase();
        db = await initDatabase();
        catalog = createFavoriteTestCatalog(db);
        assert.equal(
            (await saved()).catalog_status,
            'missing',
            'conflict survives process restart'
        );
        const archive = (await getFavoritesForBackup(db, 'p')).find(
            (row) => row.xtream_id === providerId && row.type === type
        );
        assert(archive);
        assert.equal(archive.catalog_missing_reason, 'identity_conflict');
        await restoreXtreamFavorites(db, 'other', [
            {
                xtreamId: providerId,
                contentType: type,
                snapshot: {
                    title: archive.title,
                    tmdbId: archive.tmdb_id,
                    releaseYear: archive.release_year,
                    catalogStatus: 'missing',
                    catalogMissingReason: 'identity_conflict',
                },
            },
        ]);
        await catalog(
            id + 6,
            providerId,
            'Sparse restored replacement',
            type,
            'other'
        );
        await setAppState(
            db,
            `xtream-import-status:other:${type}`,
            'completed'
        );
        assert.equal(
            (await getFavorites(db, 'other')).find(
                (row) => row.xtream_id === providerId && row.type === type
            )?.catalog_status,
            'missing'
        );
        await persistContentMetadataIfMissing(db, id + 2, { tmdbId: 100 });
        assert.equal(
            (await saved()).catalog_status,
            'missing',
            'partial confirmation cannot clear conflict'
        );
        await persistContentMetadataIfMissing(db, id + 2, {
            releaseYear: 2000,
        });
        assert.equal(
            (await saved()).catalog_status,
            'present',
            'full detail confirmation clears conflict'
        );
        assert.equal((await saved()).favorite_id, original.favorite_id);
        assert.equal((await saved()).added_at, original.added_at);
        assert.equal((await saved()).position, original.position);
        // A conflict first discovered by detail enrichment must latch too.
        await deleteXtreamContent(db, 'p');
        await catalog(id + 3, providerId, 'Unknown replacement', type);
        await complete();
        await persistContentMetadataIfMissing(db, id + 3, { tmdbId: 300 });
        await deleteXtreamContent(db, 'p');
        await catalog(id + 4, providerId, 'Sparse again', type);
        await complete();
        assert.equal((await saved()).catalog_status, 'missing');
        // An original duplicate wins over a sparse or conflicting category.
        await catalog(id + 5, providerId, 'Confirmed original', type, 'p', {
            tmdbId: 100,
            releaseYear: 2000,
        });
        await complete();
        assert.equal((await saved()).id, id + 5);
        await deleteXtreamContent(db, 'p');
        await catalog(
            id + 7,
            providerId,
            'Conflict before completion',
            type,
            'p',
            { tmdbId: 400 }
        );
        // Refresh can erase an incomplete catalog; retain its known negative evidence first.
        await deleteXtreamContent(db, 'p');
        await catalog(
            id + 8,
            providerId,
            'Sparse after interrupted import',
            type
        );
        await complete();
        assert.equal((await saved()).catalog_status, 'missing');
        await removeFavorite(db, { favoriteId: original.favorite_id }, 'p');
        await addFavorite(db, id + 8, 'p');
        assert.equal(
            (await saved()).id,
            id + 8,
            'explicit remove/re-add starts a new ownership'
        );
    }
}
