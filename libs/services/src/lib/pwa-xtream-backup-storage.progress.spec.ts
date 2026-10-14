import { PwaXtreamBackupStorage } from './pwa-xtream-backup-storage';
import {
    XTREAM_USER_DATA_KEYS as KEYS,
    writeXtreamUserDataMap,
} from './xtream-user-data-keys';
import type {
    XtreamPendingRestoreState,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';

const state: XtreamPendingRestoreState = {
    favoritesRestoreId: 'import-1',
    hiddenCategories: [],
    favorites: [
        {
            contentType: 'movie',
            xtreamId: 42,
            snapshot: { title: 'Archived', tmdbId: 100, releaseYear: 1995 },
        },
    ],
    recentlyViewed: [
        {
            contentType: 'movie',
            xtreamId: 42,
            viewedAt: '2020-01-01',
            collectionItem: {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Watched',
                tmdb_id: 200,
            },
        },
    ],
    playbackPositions: [
        { contentXtreamId: 42, contentType: 'vod', positionSeconds: 12 },
    ],
};
const entry: XtreamPlaylistBackupEntry = {
    autoRefresh: false,
    exportedId: 'p',
    portalType: 'xtream',
    title: 'Source',
    connection: { serverUrl: 'http://example.invalid', username: 'demo' },
    userState: state,
};

function fixture() {
    const data = new Map<string, string>();
    let denied: string | undefined;
    const storage = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
            if (key === denied)
                throw new DOMException('full', 'QuotaExceededError');
            data.set(key, value);
        },
        removeItem: (key: string) => {
            data.delete(key);
        },
    };
    const read = (key: string) => JSON.parse(data.get(key) ?? '{}');
    return {
        storage,
        read,
        deny: (key?: string) => {
            denied = key;
        },
    };
}

describe('PWA restore list receipts', () => {
    it.each([
        KEYS.favorites,
        KEYS.recentItems,
        KEYS.playbackPositions,
        KEYS.collectionItems,
    ])(
        'retries only unfinished writes after a failure at %s',
        async (failure) => {
            const { storage, read, deny } = fixture();
            const backup = new PwaXtreamBackupStorage(storage);
            deny(failure);
            await expect(backup.restore('p', state)).rejects.toThrow('full');
            const names = [
                KEYS.favorites,
                KEYS.recentItems,
                KEYS.playbackPositions,
            ];
            const completed = names.indexOf(failure as (typeof names)[number]);
            const count = completed === -1 ? names.length : completed;
            for (const key of names.slice(0, count)) {
                writeXtreamUserDataMap(storage, key, { ...read(key), p: [] });
            }
            deny();
            // Restart: only persisted receipts can protect the edits.
            await new PwaXtreamBackupStorage(storage).restore('p', state);
            for (const key of names.slice(0, count))
                expect(read(key).p).toEqual([]);
            for (const key of names.slice(count))
                expect(read(key).p.length).toBe(1);
            const exported = backup.exportInto(entry, state);
            if (count > 0) expect(exported.userState.favorites).toEqual([]);
            if (count > 1)
                expect(exported.userState.recentlyViewed).toEqual([]);
            if (count > 2)
                expect(exported.userState.playbackPositions).toEqual([]);
            expect(JSON.stringify(exported)).not.toContain(
                '__iptvnator_xtream_restore_receipts__'
            );
        }
    );

    it('does not roll back a replacement snapshot or favorite order on retry', async () => {
        const { storage, read, deny } = fixture();
        deny(KEYS.collectionItems);
        await expect(
            new PwaXtreamBackupStorage(storage).restore('p', state)
        ).rejects.toThrow();
        deny();
        const replacement = {
            id: 42,
            xtream_id: 42,
            type: 'movie',
            title: 'Chosen replacement',
            tmdb_id: 200,
            added_at: '2026-10-14',
            position: 4,
        };
        storage.setItem(
            KEYS.collectionItems,
            JSON.stringify({ p: { 'movie:42': replacement } })
        );
        writeXtreamUserDataMap(storage, KEYS.favorites, {
            p: ['series:42', 'movie:42'],
        });
        await new PwaXtreamBackupStorage(storage).restore('p', state);
        expect(read(KEYS.favorites).p).toEqual(['series:42', 'movie:42']);
        expect(read(KEYS.collectionItems).p['movie:42']).toEqual(replacement);
        const exported = new PwaXtreamBackupStorage(storage).exportInto(
            entry,
            state
        );
        expect(
            exported.userState.favorites.find(
                (item) => item.contentType === 'movie'
            )?.snapshot
        ).toMatchObject({ title: replacement.title, tmdbId: 200 });
    });

    it('exports unwritten archived metadata over an unchanged pre-import cache', async () => {
        const { storage, deny } = fixture();
        storage.setItem(
            KEYS.collectionItems,
            JSON.stringify({
                p: {
                    'movie:42': {
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Older cache',
                    },
                },
            })
        );
        deny(KEYS.collectionItems);
        const backup = new PwaXtreamBackupStorage(storage);
        await expect(backup.restore('p', state)).rejects.toThrow();
        expect(
            backup.exportInto(entry, state).userState.favorites[0].snapshot
        ).toEqual(state.favorites[0].snapshot);
        deny();
        await backup.restore('p', state);
        expect(
            backup.exportInto(entry).userState.favorites[0].snapshot
        ).toMatchObject({ title: 'Archived', tmdbId: 100, releaseYear: 1995 });
    });

    it('does not lend archived dates or identity to a newly re-added favorite', async () => {
        const { storage, deny } = fixture();
        const archived = {
            ...state,
            favorites: [
                { ...state.favorites[0], addedAt: '2020-01-01', position: 9 },
            ],
        };
        deny(KEYS.collectionItems);
        const backup = new PwaXtreamBackupStorage(storage);
        await expect(backup.restore('p', archived)).rejects.toThrow();
        deny();
        storage.setItem(
            KEYS.collectionItems,
            JSON.stringify({
                p: {
                    'movie:42': {
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Replacement',
                        tmdb_id: 200,
                    },
                },
            })
        );
        const [exported] = backup.exportInto(entry, archived).userState
            .favorites;
        expect(exported.snapshot).toMatchObject({
            title: 'Replacement',
            tmdbId: 200,
        });
        expect(exported.addedAt).toBeUndefined();
        expect(exported.position).toBeUndefined();
    });

    it('does not mistake numeric identity normalization for a user replacement', async () => {
        const { storage, read, deny } = fixture();
        const old = {
            xtream_id: 42,
            type: 'movie',
            title: 'Older cache',
            tmdb_id: '100',
            release_year: '1995',
        };
        storage.setItem(
            KEYS.collectionItems,
            JSON.stringify({ p: { 'movie:42': old } })
        );
        deny(KEYS.collectionItems);
        const backup = new PwaXtreamBackupStorage(storage);
        await expect(backup.restore('p', state)).rejects.toThrow();
        deny();
        // Collection reads normalize historical numeric strings without changing the saved item.
        storage.setItem(
            KEYS.collectionItems,
            JSON.stringify({
                p: { 'movie:42': { ...old, tmdb_id: 100, release_year: 1995 } },
            })
        );
        await backup.restore('p', state);
        expect(read(KEYS.collectionItems).p['movie:42'].title).toBe('Archived');
    });

    it('treats a deliberate new import as a new operation', async () => {
        const { storage, read } = fixture();
        const backup = new PwaXtreamBackupStorage(storage);
        await backup.restore('p', state);
        writeXtreamUserDataMap(storage, KEYS.favorites, { p: [] });
        await backup.restore('p', { ...state, favoritesRestoreId: 'import-2' });
        expect(read(KEYS.favorites).p).toEqual(['movie:42']);
    });

    it('uses canonical receipts for legacy pending state without an ID', async () => {
        const { storage, read, deny } = fixture();
        const legacy = { ...state };
        delete legacy.favoritesRestoreId;
        deny(KEYS.collectionItems);
        await expect(
            new PwaXtreamBackupStorage(storage).restore('p', legacy)
        ).rejects.toThrow();
        writeXtreamUserDataMap(storage, KEYS.favorites, { p: [] });
        deny();
        await new PwaXtreamBackupStorage(storage).restore('p', {
            playbackPositions: legacy.playbackPositions,
            recentlyViewed: legacy.recentlyViewed,
            favorites: legacy.favorites,
            hiddenCategories: [],
        });
        expect(read(KEYS.favorites).p).toEqual([]);
    });
});
