import assert from 'node:assert/strict';
import { PwaXtreamBackupStorage } from '@iptvnator/services/pwa-xtream-backup-storage';
import type { XtreamPlaylistBackupEntry } from '@iptvnator/shared/interfaces';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../../database.types';
import { createFavoriteTestCatalog } from './favorites-test-catalog';
import { getFavoritesForBackup } from '../favorites.operations';
import {
    deleteXtreamContent,
    restoreXtreamFavorites,
} from '../xtream.operations';
import { setAppState } from '../playlist.operations';

export async function verifyRestoredFavoriteSnapshot(db: AppDatabase) {
    const catalog = createFavoriteTestCatalog(db);
    const cases = [
        { saved: { tmdbId: 10 }, candidate: { releaseYear: 2020 } },
        { saved: { releaseYear: 2000 }, candidate: { tmdbId: 20 } },
    ];
    for (const [index, { saved, candidate }] of cases.entries()) {
        const id = 20 + index * 2;
        const xtreamId = 100 + index;
        await catalog(id, xtreamId, 'Replacement', 'movie', 'p', candidate);
        await restoreXtreamFavorites(db, 'p', [
            {
                contentType: 'movie',
                xtreamId,
                snapshot: { title: 'Saved original', ...saved },
            },
        ]);
        const restored = (await db.select().from(schema.favorites)).find(
            (row) => row.xtreamId === xtreamId
        );
        assert(restored);
        assert.equal(
            restored.tmdbId,
            saved.tmdbId ?? null,
            'restore must not adopt an unconfirmed TMDB ID'
        );
        assert.equal(
            restored.releaseYear,
            saved.releaseYear ?? null,
            'restore must not adopt an unconfirmed year'
        );
        assert.equal(
            restored.posterUrl,
            null,
            'restore must not copy replacement artwork'
        );
        await deleteXtreamContent(db, 'p');
        await catalog(id + 1, xtreamId, 'Original returns', 'movie', 'p', {
            tmdbId: 10,
            releaseYear: 2000,
        });
        await setAppState(db, 'xtream-import-status:p:movie', 'completed');
        const returned = (await getFavoritesForBackup(db, 'p')).find(
            (row) => row.xtream_id === xtreamId
        );
        assert.equal(
            returned?.catalog_status,
            'present',
            'incomplete restored metadata must not block original content reconnecting'
        );
        assert.equal(returned?.favorite_id, restored.id);
        assert.equal(returned?.title, 'Original returns');
    }
    const storage = new Map([
        ['xtream-favorites', JSON.stringify({ p: ['movie:199'] })],
        [
            'xtream-collection-items',
            JSON.stringify({
                p: {
                    'movie:199': {
                        xtream_id: 199,
                        type: 'movie',
                        title: 'Browser original',
                        tmdb_id: '949',
                        release_year: '1995',
                        added_at: '2026-01-02',
                        position: 3,
                    },
                },
            }),
        ],
    ]);
    const exported = new PwaXtreamBackupStorage({
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
            storage.set(key, value);
        },
        removeItem: (key) => {
            storage.delete(key);
        },
    }).exportInto({
        exportedId: 'p',
        userState: {},
    } as XtreamPlaylistBackupEntry);
    await catalog(99, 199, 'Different movie', 'movie', 'p', {
        tmdbId: 950,
        releaseYear: 2000,
    });
    await restoreXtreamFavorites(db, 'p', exported.userState.favorites);
    const restored = (await getFavoritesForBackup(db, 'p')).find(
        (row) => row.xtream_id === 199
    );
    assert.equal(
        restored?.tmdb_id,
        949,
        'browser backup must preserve numeric-string TMDB identity'
    );
    assert.equal(restored?.release_year, 1995);
    assert.equal(restored?.title, 'Browser original');
    assert.equal(restored?.catalog_status, 'missing');
    assert.equal(
        restored?.id,
        null,
        'the restored favorite must reject the reused provider ID'
    );
    assert.equal(restored?.added_at, '2026-01-02');
    assert.equal(restored?.position, 3);
}
