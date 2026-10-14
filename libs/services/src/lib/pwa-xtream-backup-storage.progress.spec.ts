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
        [
            { title: 'Archived', tmdbId: 100 },
            { tmdb_id: 200, release_year: 2026 },
        ],
        [
            { title: 'Archived', tmdbId: 100, releaseYear: 1995 },
            { tmdb_id: 100 },
        ],
    ])(
        'discards optional cache fields without full saved identity confirmation (%j)',
        async (snapshot, cacheIdentity) => {
            const { storage } = fixture();
            const backup = new PwaXtreamBackupStorage(storage);
            const pending = {
                ...state,
                favorites: [
                    { contentType: 'movie' as const, xtreamId: 42, snapshot },
                ],
                recentlyViewed: [],
                playbackPositions: [],
            };
            await backup.restore('p', pending, {
                ...entry,
                userState: {
                    ...pending,
                    collectionItems: [
                        {
                            id: 42,
                            xtream_id: 42,
                            type: 'movie',
                            title: 'Replacement',
                            poster_url: 'replacement.jpg',
                            ...cacheIdentity,
                        },
                    ],
                },
            });
            expect(
                backup.exportInto(entry).userState.favorites[0].snapshot
            ).toEqual(snapshot);
        }
    );

    it('fills optional presentation only after confirming normalized saved identity', async () => {
        const { storage } = fixture();
        const backup = new PwaXtreamBackupStorage(storage);
        await backup.restore('p', state, {
            ...entry,
            userState: {
                ...state,
                collectionItems: [
                    {
                        id: 42,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Same film',
                        tmdb_id: '100',
                        release_year: '1995',
                        poster_url: 'confirmed.jpg',
                    },
                ],
            },
        });
        expect(
            backup.exportInto(entry).userState.favorites[0].snapshot
        ).toMatchObject({
            title: 'Archived',
            tmdbId: 100,
            releaseYear: 1995,
            posterUrl: 'confirmed.jpg',
        });
    });

    it.each([false, true])(
        'retries required favorite metadata without oversized optional cache rows or fields (legacy history: %s)',
        async (legacyHistory) => {
            const minimal = {
                ...state,
                recentlyViewed: legacyHistory
                    ? [
                          {
                              contentType: 'movie' as const,
                              xtreamId: 42,
                              viewedAt: '2020-01-01',
                          },
                      ]
                    : [],
                playbackPositions: [],
            };
            const data = new Map<string, string>();
            const storage = {
                getItem: (key: string) => data.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    if (
                        (key === KEYS.collectionItems ||
                            key === KEYS.recentItems) &&
                        value.length > 1000
                    )
                        throw new DOMException('full', 'QuotaExceededError');
                    data.set(key, value);
                },
                removeItem: (key: string) => {
                    data.delete(key);
                },
            };
            const backup = new PwaXtreamBackupStorage(storage);
            const archive: XtreamPlaylistBackupEntry = {
                ...entry,
                userState: {
                    ...minimal,
                    collectionItems: [
                        {
                            id: 42,
                            xtream_id: 42,
                            type: 'movie',
                            title: 'Cache',
                            plot: 'x'.repeat(4000),
                        },
                        {
                            id: 99,
                            xtream_id: 99,
                            type: 'series',
                            title: 'Optional',
                            plot: 'x'.repeat(4000),
                        },
                    ],
                },
            };
            await expect(
                backup.restore('p', minimal, archive)
            ).resolves.toBeUndefined();
            const saved = JSON.parse(data.get(KEYS.collectionItems) ?? '{}');
            expect(saved.p['movie:42']).toMatchObject({
                title: 'Archived',
                tmdb_id: 100,
                release_year: 1995,
            });
            expect(saved.p['movie:42'].plot).toBeUndefined();
            expect(saved.p['series:99']).toBeUndefined();
            expect(
                backup.exportInto(entry).userState.favorites[0].snapshot
            ).toEqual(minimal.favorites[0].snapshot);
        }
    );

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
        writeXtreamUserDataMap(storage, KEYS.favorites, { p: [] });
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
        writeXtreamUserDataMap(storage, KEYS.favorites, { p: [] });
        writeXtreamUserDataMap(storage, KEYS.favorites, { p: ['movie:42'] });
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

    it('retries archived identity after ordinary catalog hydration without a favorite action', async () => {
        const { storage, read, deny } = fixture();
        deny(KEYS.collectionItems);
        const backup = new PwaXtreamBackupStorage(storage);
        await expect(backup.restore('p', state)).rejects.toThrow();
        deny();
        // Optional cache hydration is not an explicit remove/re-add.
        storage.setItem(
            KEYS.collectionItems,
            JSON.stringify({
                p: {
                    'movie:42': {
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Catalog replacement',
                        tmdb_id: 200,
                    },
                },
            })
        );
        expect(
            backup.exportInto(entry, state).userState.favorites[0].snapshot
        ).toEqual(state.favorites[0].snapshot);
        await backup.restore('p', state);
        expect(read(KEYS.collectionItems).p['movie:42']).toMatchObject({
            title: 'Archived',
            tmdb_id: 100,
            release_year: 1995,
        });
    });

    it('exports the pending archive date and position ahead of a pre-import cache', async () => {
        const { storage, deny } = fixture();
        const archived = {
            ...state,
            favorites: [
                { ...state.favorites[0], addedAt: '2026-01-01', position: 2 },
            ],
        };
        storage.setItem(
            KEYS.collectionItems,
            JSON.stringify({
                p: {
                    'movie:42': {
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Older cache',
                        tmdb_id: 100,
                        release_year: 1995,
                        added_at: '2020-01-01',
                        position: 9,
                    },
                },
            })
        );
        deny(KEYS.collectionItems);
        const backup = new PwaXtreamBackupStorage(storage);
        await expect(backup.restore('p', archived)).rejects.toThrow();
        expect(
            backup.exportInto(entry, archived).userState.favorites[0]
        ).toMatchObject({ addedAt: '2026-01-01', position: 2 });
    });

    it('scopes explicit removal markers to the content type', async () => {
        const { storage, read, deny } = fixture();
        const mixed = {
            ...state,
            favorites: [
                ...state.favorites,
                {
                    contentType: 'live' as const,
                    xtreamId: 42,
                    snapshot: { title: 'Channel', tmdbId: 200 },
                },
            ],
        };
        deny(KEYS.collectionItems);
        const backup = new PwaXtreamBackupStorage(storage);
        await expect(backup.restore('p', mixed)).rejects.toThrow();
        writeXtreamUserDataMap(storage, KEYS.favorites, { p: ['movie:42'] });
        deny();
        await backup.restore('p', mixed);
        expect(read(KEYS.favorites).p).toEqual(['movie:42']);
        expect(read(KEYS.collectionItems).p['movie:42'].tmdb_id).toBe(100);
        expect(backup.exportInto(entry, mixed).userState.favorites).toEqual(
            state.favorites
        );
    });

    it('keeps legacy shared Recent metadata when its imported favorite is removed before retry', async () => {
        const { storage, read, deny } = fixture();
        const shared = {
            ...state,
            recentlyViewed: [
                {
                    contentType: 'movie' as const,
                    xtreamId: 42,
                    viewedAt: '2020-01-01',
                },
            ],
        };
        const backup = new PwaXtreamBackupStorage(storage);
        deny(KEYS.collectionItems);
        await expect(backup.restore('p', shared)).rejects.toThrow();
        writeXtreamUserDataMap(storage, KEYS.favorites, { p: [] });
        deny();
        await backup.restore('p', shared);
        expect(read(KEYS.favorites).p).toEqual([]);
        const [recent] = backup.exportInto(entry).userState.recentlyViewed;
        expect(recent.viewedAt).toBe('2020-01-01');
        expect(recent.collectionItem).toMatchObject({
            title: 'Archived',
            tmdb_id: 100,
            release_year: 1995,
        });
    });

    it('does not require extra quota space to record an explicit favorite removal', async () => {
        const { storage, read, deny } = fixture();
        const backup = new PwaXtreamBackupStorage(storage);
        deny(KEYS.collectionItems);
        await expect(backup.restore('p', state)).rejects.toThrow();
        const previousSize = (storage.getItem(KEYS.favorites) ?? '').length;
        const setItem = storage.setItem;
        storage.setItem = (key, value) => {
            if (key === KEYS.favorites && value.length > previousSize)
                throw new DOMException('full', 'QuotaExceededError');
            setItem(key, value);
        };
        expect(() =>
            writeXtreamUserDataMap(storage, KEYS.favorites, { p: [] })
        ).not.toThrow();
        expect(read(KEYS.favorites).p).toEqual([]);
        deny();
        await backup.restore('p', state);
        expect(read(KEYS.favorites).p).toEqual([]);
    });

    it('retains pending data when an ownership receipt is damaged', async () => {
        const { storage, read, deny } = fixture();
        deny(KEYS.collectionItems);
        const backup = new PwaXtreamBackupStorage(storage);
        await expect(backup.restore('p', state)).rejects.toThrow();
        const map = read(KEYS.favorites);
        map['__iptvnator_xtream_restore_receipts__'].p.keys = null;
        storage.setItem(KEYS.favorites, JSON.stringify(map));
        deny();
        await expect(backup.restore('p', state)).rejects.toThrow(
            'receipt is unreadable'
        );
        expect(() => backup.exportInto(entry, state)).toThrow(
            'receipt is unreadable'
        );
        expect(storage.getItem(KEYS.collectionItems)).toBeNull();
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
