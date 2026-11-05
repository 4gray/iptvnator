import { verifyCompatibleFavoriteActions } from './favorites-compatible-actions';
import { verifyFavoriteRefresh } from './favorites-refresh';
import { verifyFavoriteConflictLatch } from './favorites-conflict-latch';
import assert from 'node:assert/strict';
import { verifyFavoriteSnapshot } from './favorites-snapshot';
import { verifyUnlockedFavoriteDuplicate } from './favorites-locked-duplicate';
import { verifyRestoredFavoriteSnapshot } from './favorites-restore-snapshot';
import { createFavoriteTestCatalog } from './favorites-test-catalog';
import { eq, sql } from 'drizzle-orm';
import { closeDatabase, initDatabase } from '@iptvnator/shared/database';
import * as schema from '@iptvnator/shared/database/schema';
import { setParentalLockActive } from '../../parental-lock-state';
import {
    addFavorite,
    getFavorites,
    getFavoritesForBackup,
    getAllGlobalFavorites,
    getGlobalFavorites,
    removeFavorite,
    reorderGlobalFavorites,
    isFavorite,
} from '../favorites.operations';
import {
    deleteXtreamContent,
    restoreXtreamUserData,
    restoreXtreamFavorites,
} from '../xtream.operations';
import { persistContentMetadataIfMissing } from '../content-metadata.operations';
import { setAppState } from '../playlist.operations';

async function main() {
    assert(process.env['IPTVNATOR_E2E_DATA_DIR']);
    console.log = () => undefined;
    const db = await initDatabase();
    await db.insert(schema.playlists).values([
        { id: 'p', name: 'Source', type: 'xtream' },
        { id: 'other', name: 'Other source', type: 'xtream' },
    ]);
    const catalog = createFavoriteTestCatalog(db);
    const status = (value: string, type = 'movie') =>
        setAppState(db, `xtream-import-status:p:${type}`, value);
    const favorites = () => getFavorites(db, 'p');
    const backup = [
        {
            xtreamId: 7,
            contentType: 'movie' as const,
            addedAt: '2025-01-01',
            position: 4,
        },
    ];
    await catalog(1, 7);
    await addFavorite(db, 1, 'p');
    const [original] = await favorites();
    const scenario = process.argv[2];
    if (scenario === 'compatible-actions') {
        await verifyCompatibleFavoriteActions(db);
    } else if (scenario === 'conflict-latch') {
        await verifyFavoriteConflictLatch(db);
    } else if (scenario === 'conflict-migration') {
        await db.run(sql`ALTER TABLE favorites DROP COLUMN identity_conflict`);
        closeDatabase();
        const upgraded = await initDatabase();
        const [saved] = await getFavorites(upgraded, 'p');
        assert.equal(saved.favorite_id, original.favorite_id);
        assert.equal(saved.added_at, original.added_at);
        assert.equal(
            (await upgraded.select().from(schema.favorites))[0]
                .identityConflict,
            false
        );
        closeDatabase();
        const restarted = await initDatabase();
        assert.equal(
            (await getFavorites(restarted, 'p'))[0].favorite_id,
            original.favorite_id
        );
    } else if (scenario === 'refresh') {
        await verifyFavoriteRefresh(db, original);
    } else if (scenario === 'empty') {
        await deleteXtreamContent(db, 'p');
        for (const value of ['idle', 'importing', 'failed', 'cancelled']) {
            await status(value);
            assert.equal(
                (await favorites())[0]?.catalog_status,
                'unknown',
                value
            );
        }
        await status('completed');
        assert.equal((await favorites())[0]?.catalog_status, 'missing');
        await deleteXtreamContent(db, 'p');
        assert.equal((await favorites())[0]?.catalog_status, 'unknown');
        await reorderGlobalFavorites(db, [
            {
                favorite_id: original.favorite_id,
                content_id: 999,
                playlist_id: 'p',
                position: 9,
            },
        ]);
        assert.equal((await favorites())[0]?.position, 9);
        await removeFavorite(db, { favoriteId: original.favorite_id }, 'other');
        assert.equal((await favorites()).length, 1);
        await removeFavorite(db, { favoriteId: original.favorite_id }, 'p');
        assert.deepEqual(await favorites(), []);
        await catalog(2, 7);
        await status('completed');
        assert.deepEqual(
            await favorites(),
            [],
            'removed missing favorites must not reappear'
        );
    } else if (scenario === 'restore') {
        await restoreXtreamUserData(
            db,
            'p',
            [
                {
                    ...backup[0],
                    xtreamId: 99,
                    snapshot: {
                        title: 'Saved offline',
                        tmdbId: 31,
                        releaseYear: 2001,
                    },
                },
            ],
            []
        );
        assert.equal(
            (await favorites()).length,
            2,
            'restore must not wipe existing favorite'
        );
        await restoreXtreamUserData(
            db,
            'p',
            [{ ...backup[0], xtreamId: 99 }],
            []
        );
        const rows = await favorites();
        assert.equal(rows.length, 2);
        assert.equal(
            rows.find((row) => row.xtream_id === 99)?.title,
            'Saved offline'
        );
        await restoreXtreamUserData(
            db,
            'p',
            [{ ...backup[0], xtreamId: 100 }],
            []
        );
        assert((await favorites()).find((row) => row.xtream_id === 100)?.title);
        await catalog(3, 100, 'Recovered title');
        await status('completed');
        await deleteXtreamContent(db, 'p');
        assert.equal(
            (await favorites()).find((row) => row.xtream_id === 100)?.title,
            'Recovered title',
            'legacy fallback must acquire a durable snapshot when content returns'
        );
        await status('completed');
        assert.equal(
            (await favorites()).find((row) => row.xtream_id === 99)
                ?.catalog_status,
            'missing'
        );
    } else if (scenario === 'identity') {
        await catalog(10, 7, 'ABC in second category');
        assert(
            await isFavorite(db, 10, 'p'),
            'every category row of one provider identity must be favorite'
        );
        await reorderGlobalFavorites(db, [
            { content_id: 10, playlist_id: 'p', position: 12 },
        ]);
        assert.equal((await favorites())[0].position, 12);
        await removeFavorite(db, 10, 'p');
        assert.deepEqual(await favorites(), []);
        await addFavorite(db, 1, 'p');
        await catalog(2, 7, 'Other movie', 'movie', 'other');
        await catalog(3, 7, 'Live', 'live', 'p', {
            tvArchive: 1,
            tvArchiveDuration: 7,
        });
        await catalog(4, 7, 'Series', 'series');
        await addFavorite(db, 2, 'other');
        await addFavorite(db, 3, 'p');
        await addFavorite(db, 4, 'p');
        await persistContentMetadataIfMissing(db, 4, { tmdbId: 345 });
        await assert.rejects(
            addFavorite(db, 2, 'p'),
            'cross-playlist content must be rejected'
        );
        assert.equal((await favorites()).length, 3);
        const [live] = await getGlobalFavorites(db);
        assert.equal(live.tv_archive, 1);
        assert.equal(live.tv_archive_duration, 7);
        await deleteXtreamContent(db, 'p');
        await catalog(5, 7, 'Returned live', 'live');
        await status('completed', 'live');
        await status('completed');
        const rows = await favorites();
        assert.equal(rows.find((row) => row.type === 'movie')?.id, null);
        assert.equal(rows.find((row) => row.type === 'live')?.id, 5);
        await catalog(11, 7, 'Unrelated series', 'series', 'p', {
            tmdbId: 456,
        });
        await status('completed', 'series');
        assert.equal(
            (await favorites()).find((row) => row.type === 'series')?.id,
            null
        );
        assert.equal((await getAllGlobalFavorites(db)).length, 4);
    } else if (scenario === 'collision') {
        await removeFavorite(db, 1, 'p');
        await db
            .update(schema.content)
            .set({ tmdbId: 10, releaseYear: 2000 })
            .where(eq(schema.content.id, 1));
        await addFavorite(db, 1, 'p');
        for (const [id, tmdbId, releaseYear] of [
            [2, 20, 2000],
            [3, 10, 2020],
        ]) {
            await deleteXtreamContent(db, 'p');
            await catalog(id, 7, 'Unrelated', 'movie', 'p', {
                tmdbId,
                releaseYear,
            });
            await status('completed');
            const [saved] = await favorites();
            assert.equal(saved?.id, null);
            assert.equal(saved?.title, 'ABC');
            assert.equal(saved?.catalog_status, 'missing');
            const beforeAdd = await db.select().from(schema.favorites);
            assert.equal(await isFavorite(db, id, 'p'), false);
            assert.deepEqual(await addFavorite(db, id, 'p'), {
                success: false,
                error: 'XTREAM_FAVORITE_IDENTITY_CONFLICT',
            });
            assert.equal(await isFavorite(db, id, 'p'), false);
            assert.deepEqual(
                await db.select().from(schema.favorites),
                beforeAdd
            );
        }
        await deleteXtreamContent(db, 'p');
        await catalog(4, 7, 'ABC renamed', 'movie', 'p', {
            tmdbId: 10,
            releaseYear: 2000,
        });
        await status('completed');
        assert.equal((await favorites())[0]?.id, 4);
    } else if (scenario === 'snapshot') {
        await verifyFavoriteSnapshot(db);
    } else if (scenario === 'restore-snapshot') {
        await verifyRestoredFavoriteSnapshot(db);
    } else if (scenario === 'lock-duplicate') {
        await verifyUnlockedFavoriteDuplicate(db);
    } else if (scenario === 'scope') {
        await catalog(2, 7, 'Other', 'movie', 'other');
        await addFavorite(db, 2, 'other');
        await deleteXtreamContent(db, 'p');
        await db.delete(schema.playlists).where(eq(schema.playlists.id, 'p'));
        assert.deepEqual(await favorites(), []);
        assert.equal((await getAllGlobalFavorites(db)).length, 1);
    } else if (scenario === 'receipt') {
        const items = [
            { ...backup[0], xtreamId: 99, snapshot: { title: 'Offline' } },
        ];
        await restoreXtreamFavorites(db, 'p', items);
        const saved = (await favorites()).find((row) => row.xtream_id === 99);
        assert(saved);
        await removeFavorite(db, { favoriteId: saved.favorite_id }, 'p');
        await restoreXtreamFavorites(db, 'p', items);
        assert.equal(
            (await favorites()).length,
            1,
            'legacy receipt prevents stale replay'
        );
        await restoreXtreamFavorites(db, 'p', [
            {
                snapshot: { title: 'Offline' },
                position: 4,
                addedAt: '2025-01-01',
                contentType: 'movie',
                xtreamId: 99,
            },
        ]);
        assert.equal(
            (await favorites()).length,
            1,
            'receipt ignores JSON property order'
        );
        await restoreXtreamFavorites(
            db,
            'p',
            items,
            undefined,
            'explicit-backup'
        );
        assert.equal(
            (await favorites()).length,
            2,
            'new backup can intentionally restore'
        );
        await db.run(
            sql`CREATE TRIGGER reject_test_favorite BEFORE INSERT ON favorites WHEN NEW.xtream_id = 100 BEGIN SELECT RAISE(ABORT, 'injected failure'); END`
        );
        await assert.rejects(
            restoreXtreamFavorites(
                db,
                'p',
                [
                    { ...items[0], xtreamId: 101 },
                    { ...items[0], xtreamId: 100 },
                ],
                undefined,
                'retry-failed'
            )
        );
        assert.equal(
            (await favorites()).length,
            2,
            'favorite writes roll back together with receipt'
        );
        await db.run(sql`DROP TRIGGER reject_test_favorite`);
        await restoreXtreamFavorites(
            db,
            'p',
            [
                { ...items[0], xtreamId: 101 },
                { ...items[0], xtreamId: 100 },
            ],
            undefined,
            'retry-failed'
        );
        assert.equal((await favorites()).length, 4);
        await db.delete(schema.playlists).where(eq(schema.playlists.id, 'p'));
        assert.deepEqual(
            (await db.select().from(schema.appState)).filter((row) =>
                row.key.startsWith('xtream-')
            ),
            [],
            'playlist deletion clears restore receipts'
        );
    } else if (scenario === 'lock') {
        setParentalLockActive(true);
        await db.update(schema.categories).set({ locked: true });
        assert.deepEqual(await favorites(), []);
        assert.equal(
            (await getFavoritesForBackup(db, 'p')).length,
            1,
            'backup includes locked favorites'
        );
        setParentalLockActive(false);
        assert.equal((await favorites()).length, 1);
        await deleteXtreamContent(db, 'p');
        setParentalLockActive(true);
        assert.deepEqual(
            await favorites(),
            [],
            'unknown category ownership must be withheld'
        );
        assert.equal(
            (await getFavoritesForBackup(db, 'p'))[0]?.title,
            'ABC',
            'backup includes missing favorites while locked'
        );
        setParentalLockActive(false);
        assert.equal((await favorites()).length, 1);
    }
    closeDatabase();
    process.stdout.write('favorites verified');
}
main().catch((error) => {
    console.error(error);
    closeDatabase();
    process.exitCode = 1;
});
