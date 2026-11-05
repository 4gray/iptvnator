import { TestBed } from '@angular/core/testing';
import {
    ParentalLockService,
    PlaylistsService,
    USER_DATA_STORAGE,
    type UserDataStorage,
} from '@iptvnator/services';
import { PwaXtreamBackupStorage } from '@iptvnator/services/pwa-xtream-backup-storage';
import { of } from 'rxjs';
import { XtreamApiService } from '../services/xtream-api.service';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';
import type { XtreamContentItem } from './xtream-data-source.interface';

const credentials = {
    serverUrl: 'http://localhost:3211',
    username: 'demo',
    password: 'test',
};
const read = (key: string) => JSON.parse(localStorage.getItem(key) ?? '{}');

describe('PWA favorite action and detail identity', () => {
    let source: PwaXtreamDataSource;
    const api = { getStreams: jest.fn() };
    const reload = (storage?: UserDataStorage) => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                ...(storage
                    ? [{ provide: USER_DATA_STORAGE, useValue: storage }]
                    : []),
                { provide: XtreamApiService, useValue: api },
                {
                    provide: PlaylistsService,
                    useValue: { getPlaylistById: () => of(undefined) },
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        active: () => false,
                        lockedXtreamIds: () => [],
                    },
                },
            ],
        });
        source = TestBed.inject(PwaXtreamDataSource);
    };
    beforeEach(() => {
        localStorage.clear();
        api.getStreams.mockReset().mockResolvedValue([
            {
                stream_id: 42,
                series_id: 42,
                name: 'Original',
                category_id: '1',
            },
        ]);
        reload();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('detaches target-owned legacy Recent metadata while server confirmation is pending', async () => {
        let allowed = false;
        const storage = {
            getItem: (key: string) => localStorage.getItem(key),
            setItem: (key: string, value: string) =>
                localStorage.setItem(key, value),
            removeItem: (key: string) => localStorage.removeItem(key),
            ready: async () => true,
            flushed: async () => allowed || !read('xtream-favorites').p1,
        };
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                p1: {
                    'movie:42': {
                        id: 42,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Original',
                        tmdb_id: 100,
                    },
                },
            })
        );
        reload(storage);
        const state = {
            favoritesRestoreId: 'legacy-pending-recent',
            hiddenCategories: [],
            favorites: [{ contentType: 'movie' as const, xtreamId: 42 }],
            recentlyViewed: [
                {
                    contentType: 'movie' as const,
                    xtreamId: 42,
                    viewedAt: '2020-01-01',
                },
            ],
            playbackPositions: [],
        };
        await expect(source.restoreUserData('p1', state)).rejects.toThrow(
            'did not take'
        );
        api.getStreams.mockResolvedValue([
            {
                stream_id: 42,
                name: 'Replacement',
                tmdb_id: 200,
                category_id: '1',
            },
        ]);
        await source.getContent('p1', credentials, 'movie');
        await source.removeFavorite(
            { id: 42, type: 'movie', identity: { tmdbId: 100 } },
            'p1'
        );
        await source.addFavorite(
            { id: 42, type: 'movie', identity: { tmdbId: 200 } },
            'p1'
        );
        allowed = true;
        await source.restoreUserData('p1', state);
        const result = new PwaXtreamBackupStorage(storage).exportInto({
            autoRefresh: false,
            exportedId: 'p1',
            portalType: 'xtream',
            title: 'Source',
            connection: credentials,
            userState: state,
        });
        expect(result.userState.favorites[0].snapshot?.tmdbId).toBe(200);
        expect(result.userState.recentlyViewed[0]).toMatchObject({
            viewedAt: '2020-01-01',
            collectionItem: { tmdb_id: 100 },
        });
    });

    it.each([false, true])(
        'automatic Recent hydration cannot expand an unconfirmed target (play=%s)',
        async (play) => {
            let injected = false;
            const storage = {
                getItem: (key: string) => localStorage.getItem(key),
                setItem: (key: string, value: string) =>
                    localStorage.setItem(key, value),
                removeItem: (key: string) => localStorage.removeItem(key),
                ready: async () => true,
                flushed: async () => {
                    const recent = read('xtream-recent-items');
                    if (!injected && recent.p1?.length) {
                        injected = true;
                        recent.p1.push({
                            id: 'movie:99',
                            viewedAt: '2026-01-01',
                            collectionItem: {
                                id: 99,
                                xtream_id: 99,
                                type: 'movie',
                                title: 'Remote old',
                                tmdb_id: 999,
                            },
                        });
                        localStorage.setItem(
                            'xtream-recent-items',
                            JSON.stringify(recent)
                        );
                    }
                    return true;
                },
            };
            reload(storage);
            const state = {
                favoritesRestoreId: 'recent-hydration',
                hiddenCategories: [],
                favorites: [
                    {
                        contentType: 'movie' as const,
                        xtreamId: 42,
                        snapshot: { title: 'Archived', tmdbId: 100 },
                    },
                ],
                recentlyViewed: [
                    {
                        contentType: 'movie' as const,
                        xtreamId: 42,
                        viewedAt: '2020-01-01',
                    },
                ],
                playbackPositions: [],
            };
            await expect(source.restoreUserData('p1', state)).rejects.toThrow(
                'changed elsewhere'
            );
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    name: 'Hydrated original',
                    tmdb_id: 100,
                    category_id: '1',
                },
                {
                    stream_id: 99,
                    name: 'Hydrated remote',
                    tmdb_id: 999,
                    category_id: '1',
                },
            ]);
            await source.getContent('p1', credentials, 'movie');
            await source.getRecentItems('p1');
            const entry = {
                autoRefresh: false,
                exportedId: 'p1',
                portalType: 'xtream' as const,
                title: 'Source',
                connection: credentials,
                userState: state,
            };
            expect(
                new PwaXtreamBackupStorage(storage)
                    .exportInto(entry, state)
                    .userState.recentlyViewed.map((item) => item.xtreamId)
            ).toEqual([42]);
            if (play)
                await source.addRecentItem({ id: 99, type: 'movie' }, 'p1');
            await source.restoreUserData('p1', state);
            expect(
                new PwaXtreamBackupStorage(storage)
                    .exportInto(entry)
                    .userState.recentlyViewed.map((item) => item.xtreamId)
                    .sort()
            ).toEqual(play ? [42, 99] : [42]);
        }
    );

    it.each([false, true])(
        'rejects sparse replacement hearts after a latched conflict (warm=%s)',
        async (warm) => {
            const saved = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Original',
                tmdb_id: 100,
                release_year: 1995,
                catalog_status: 'missing',
                catalog_missing_reason: 'identity_conflict',
            };
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ p1: ['movie:42'] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({ p1: { 'movie:42': saved } })
            );
            if (warm) await source.getContent('p1', credentials, 'movie');
            const ref = { id: 42, type: 'movie' as const };
            expect(await source.isFavorite(ref, 'p1')).toBe(false);
            await expect(source.addFavorite(ref, 'p1')).rejects.toThrow(
                'XTREAM_FAVORITE_IDENTITY_CONFLICT'
            );
            await expect(source.removeFavorite(ref, 'p1')).rejects.toThrow(
                'XTREAM_FAVORITE_IDENTITY_CONFLICT'
            );
            expect(read('xtream-favorites').p1).toEqual(['movie:42']);
            await source.removeFavorite(
                { ...ref, identity: { tmdbId: 100, releaseYear: 1995 } },
                'p1'
            );
            expect(read('xtream-favorites').p1).toEqual([]);
        }
    );

    it('keeps a PWA removal and replacement through pending snapshot replay', async () => {
        const state = {
            favoritesRestoreId: 'backup-1',
            hiddenCategories: [],
            favorites: [
                {
                    contentType: 'movie' as const,
                    xtreamId: 42,
                    snapshot: { title: 'Original', tmdbId: 100 },
                },
            ],
            recentlyViewed: [],
            playbackPositions: [],
        };
        const setItem = Storage.prototype.setItem;
        const quota = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key, value) {
                if (key === 'xtream-collection-items')
                    throw new DOMException('full', 'QuotaExceededError');
                setItem.call(this, key, value);
            });
        await expect(
            new PwaXtreamBackupStorage(localStorage).restore('p1', state)
        ).rejects.toThrow();
        await source.removeFavorite({ id: 42, type: 'movie' }, 'p1');
        quota.mockRestore();
        reload();
        await source.restoreUserData('p1', state);
        expect(read('xtream-favorites').p1).toEqual([]);
        api.getStreams.mockResolvedValue([
            {
                stream_id: 42,
                name: 'Replacement',
                category_id: '2',
                tmdb_id: 200,
            },
        ]);
        await source.getContent('p1', credentials, 'movie');
        await source.addFavorite(
            { id: 42, type: 'movie', identity: { tmdbId: 200 } },
            'p1'
        );
        await source.restoreUserData('p1', state);
        expect((await source.getFavorites('p1'))[0]).toMatchObject({
            title: 'Replacement',
            tmdb_id: 200,
        });
        const entry = {
            autoRefresh: false,
            exportedId: 'p1',
            portalType: 'xtream' as const,
            title: 'Source',
            connection: credentials,
            userState: {
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            },
        };
        expect(
            new PwaXtreamBackupStorage(localStorage).exportInto(entry, state)
                .userState.favorites[0].snapshot?.tmdbId
        ).toBe(200);
    });

    it('restores parked identity after a Favorites read hydrates a replacement into cache', async () => {
        const state = {
            favoritesRestoreId: 'hydration-test',
            hiddenCategories: [],
            favorites: [
                {
                    contentType: 'movie' as const,
                    xtreamId: 42,
                    addedAt: '2026-01-01',
                    position: 2,
                    snapshot: {
                        title: 'Archived original',
                        tmdbId: 100,
                        releaseYear: 1995,
                    },
                },
            ],
            recentlyViewed: [],
            playbackPositions: [],
        };
        const originalSet = Storage.prototype.setItem;
        const quota = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (this: Storage, key, value) {
                if (key === 'xtream-collection-items')
                    throw new DOMException('full', 'QuotaExceededError');
                originalSet.call(this, key, value);
            });
        await expect(source.restoreUserData('p1', state)).rejects.toThrow();
        quota.mockRestore();
        api.getStreams.mockResolvedValue([
            {
                stream_id: 42,
                name: 'Catalog replacement',
                category_id: '2',
                tmdb_id: 200,
            },
        ]);
        await source.getContent('p1', credentials, 'movie');
        await source.getFavorites('p1');
        expect(read('xtream-collection-items').p1['movie:42'].tmdb_id).toBe(
            200
        );
        await source.restoreUserData('p1', state);
        reload();
        expect((await source.getFavorites('p1'))[0]).toMatchObject({
            title: 'Archived original',
            tmdb_id: 100,
            release_year: 1995,
            added_at: '2026-01-01',
            position: 2,
        });
    });

    it.each([100, 200])(
        'shares unavailable evidence only with the same saved Recent identity (%s)',
        async (tmdb) => {
            const saved = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Saved',
                category_id: '1',
                tmdb_id: 100,
                release_year: 1995,
                catalog_status: 'missing',
                catalog_missing_reason: 'identity_conflict',
            };
            const recent = {
                ...saved,
                title: tmdb === 100 ? 'Saved' : 'Replacement',
                tmdb_id: tmdb,
                catalog_status: undefined,
                catalog_missing_reason: undefined,
            };
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ p1: ['movie:42'] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({ p1: { 'movie:42': saved } })
            );
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    p1: [
                        {
                            id: 'movie:42',
                            viewedAt: '2020-01-01',
                            collectionItem: recent,
                        },
                    ],
                })
            );
            reload();
            const [resolved] = await source.getRecentItems('p1');
            expect(resolved.tmdb_id).toBe(tmdb);
            expect(resolved.catalog_status).toBe(
                tmdb === 100 ? 'missing' : undefined
            );
            expect(read('xtream-recent-items').p1[0].viewedAt).toBe(
                '2020-01-01'
            );
            expect(read('xtream-collection-items').p1['movie:42'].tmdb_id).toBe(
                100
            );
            reload();
            expect((await source.getRecentItems('p1'))[0].catalog_status).toBe(
                tmdb === 100 ? 'missing' : undefined
            );
        }
    );

    it.each(['live', 'movie', 'series'] as const)(
        'persists %s detail identity against compatible duplicates before reload',
        async (type) => {
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Original',
                    category_id: '1',
                    tmdb_id: 100,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.addFavorite({ id: 42, type }, 'p1');
            await source.addRecentItem({ id: 42, type }, 'p1', undefined, {
                title: 'Original',
                tmdbId: 100,
            });
            source.clearSessionCache('p1');
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Original',
                    category_id: '1',
                    tmdb_id: 100,
                },
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Replacement',
                    category_id: '2',
                    tmdb_id: 200,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.setContentMetadataIfMissing({ id: 42, type }, 'p1', {
                tmdbId: 100,
                releaseYear: 1995,
            });
            expect(
                read('xtream-collection-items').p1[`${type}:42`]
            ).toMatchObject({ tmdb_id: 100, release_year: 1995 });
            reload();
            expect((await source.getRecentItems('p1'))[0]).toMatchObject({
                tmdb_id: 100,
                release_year: 1995,
            });
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                tmdb_id: 100,
                release_year: 1995,
            });
        }
    );

    it.each(['live', 'movie', 'series'] as const)(
        'enriches duplicate %s IDs without replacing category-specific rows',
        async (type) => {
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'First listing',
                    category_id: '1',
                    stream_icon: 'first.jpg',
                    rating: '1',
                    tmdb_id: 100,
                    backdrop_url: 'first-backdrop.jpg',
                },
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Second listing',
                    category_id: '2',
                    stream_icon: 'second.jpg',
                    rating: '2',
                    tmdb_id: 100,
                },
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Conflicting listing',
                    category_id: '3',
                    stream_icon: 'third.jpg',
                    rating: '3',
                    tmdb_id: 999,
                },
            ]);
            const before = (await source.getContent(
                'p1',
                credentials,
                type
            )) as XtreamContentItem[];
            await source.setContentMetadataIfMissing({ id: 42, type }, 'p1', {
                tmdbId: 100,
                releaseYear: 1995,
                backdropUrl: 'detail.jpg',
                originalTitle: 'Detail title',
            });
            const after = (await source.getContent(
                'p1',
                credentials,
                type
            )) as XtreamContentItem[];
            expect(
                after.map(({ category_id, title, poster_url, rating }) => ({
                    category_id,
                    title,
                    poster_url,
                    rating,
                }))
            ).toEqual(
                before.map(({ category_id, title, poster_url, rating }) => ({
                    category_id,
                    title,
                    poster_url,
                    rating,
                }))
            );
            expect(after[0]).toMatchObject({
                tmdb_id: 100,
                release_year: 1995,
                backdrop_url: 'first-backdrop.jpg',
                original_title: 'Detail title',
            });
            expect(after[1]).toMatchObject({
                tmdb_id: 100,
                release_year: 1995,
                backdrop_url: 'detail.jpg',
                original_title: 'Detail title',
            });
            expect(after[2]).toEqual(before[2]);
            expect(api.getStreams).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['live', 'movie', 'series'] as const)(
        'protects the %s favorite from a cold Recent heart and stale remove',
        async (type) => {
            const ref = { id: 42, type };
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Original',
                    category_id: '1',
                    tmdb_id: 100,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.addFavorite(ref, 'p1');
            reload();
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Replacement',
                    category_id: '1',
                    tmdb_id: 200,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.addRecentItem(ref, 'p1');
            expect(
                await source.isFavorite(
                    { ...ref, identity: { tmdbId: 0 } },
                    'p1'
                )
            ).toBe(false);
            // Preserve references while simulating a cold data source, no provider hydration.
            reload();
            await source.setContentMetadataIfMissing(ref, 'p1', {
                tmdbId: 200,
                releaseYear: 2026,
            });
            expect(
                read('xtream-collection-items').p1[`${type}:42`]
            ).toMatchObject({
                title: 'Original',
                tmdb_id: 100,
            });
            expect(
                read('xtream-collection-items').p1[`${type}:42`].release_year
            ).toBeUndefined();
            const recent = (await source.getRecentItems('p1'))[0];
            const replacement = {
                ...ref,
                identity: { tmdbId: recent.tmdb_id ?? undefined },
            };
            expect(recent).toMatchObject({
                title: 'Replacement',
                tmdb_id: 200,
            });
            expect(await source.isFavorite(replacement, 'p1')).toBe(false);
            await expect(
                source.removeFavorite(replacement, 'p1')
            ).rejects.toThrow('XTREAM_FAVORITE_IDENTITY_CONFLICT');
            await expect(source.addFavorite(replacement, 'p1')).rejects.toThrow(
                'XTREAM_FAVORITE_IDENTITY_CONFLICT'
            );
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                title: 'Original',
                tmdb_id: 100,
            });
            const original = { ...ref, identity: { tmdbId: 100 } };
            await source.getContent('p1', credentials, type);
            expect(await source.isFavorite(replacement, 'p1')).toBe(false);
            await source.removeFavorite(original, 'p1');
            expect(await source.getFavorites('p1')).toEqual([]);
            reload();
            const setItem = Storage.prototype.setItem;
            const blocked = jest
                .spyOn(Storage.prototype, 'setItem')
                .mockImplementation(function (this: Storage, key, value) {
                    if (key === 'xtream-collection-items')
                        throw new DOMException('Full', 'QuotaExceededError');
                    setItem.call(this, key, value);
                });
            await expect(
                source.addFavorite(replacement, 'p1')
            ).rejects.toThrow();
            expect(read('xtream-favorites').p1).toEqual([]);
            blocked.mockRestore();
            await source.addFavorite(replacement, 'p1');
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                title: 'Replacement',
                tmdb_id: 200,
            });
        }
    );

    it.each(['live', 'movie', 'series'] as const)(
        'keeps watched %s metadata when explicitly favoriting an unwatched replacement',
        async (type) => {
            const ref = { id: 42, type };
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Watched original',
                    category_id: '1',
                    tmdb_id: 100,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.addFavorite(ref, 'p1');
            await source.addRecentItem(ref, 'p1');
            const recentBefore = read('xtream-recent-items').p1[0];
            expect(recentBefore.collectionItem).toBeUndefined();
            const saved = read('xtream-collection-items');
            reload();
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Unwatched replacement',
                    category_id: '2',
                    tmdb_id: 200,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.removeFavorite(
                { ...ref, identity: { tmdbId: 100 } },
                'p1'
            );
            const replacement = { ...ref, identity: { tmdbId: 200 } };
            const setItem = Storage.prototype.setItem;
            const blocked = jest
                .spyOn(Storage.prototype, 'setItem')
                .mockImplementation(function (this: Storage, key, value) {
                    if (key === 'xtream-recent-items')
                        throw new DOMException('Full', 'QuotaExceededError');
                    setItem.call(this, key, value);
                });
            await expect(
                source.addFavorite(replacement, 'p1')
            ).rejects.toThrow();
            expect(read('xtream-collection-items')).toEqual(saved);
            expect(read('xtream-favorites').p1).toEqual([]);
            blocked.mockRestore();
            await source.addFavorite(replacement, 'p1');
            reload();
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                title: 'Unwatched replacement',
                tmdb_id: 200,
            });
            expect((await source.getRecentItems('p1'))[0]).toMatchObject({
                title: 'Watched original',
                tmdb_id: 100,
                viewed_at: recentBefore.viewedAt,
            });
        }
    );

    it.each(['movie', 'series'] as const)(
        're-adds a cold %s favorite with detail identity and no Recent entry',
        async (type) => {
            const ref = { id: 42, type };
            await source.getContent('p1', credentials, type);
            await source.addFavorite(ref, 'p1');
            const before = read('xtream-collection-items');
            reload();
            await source.getFavorites('p1');
            await source.setContentMetadataIfMissing(ref, 'p1', {
                tmdbId: 100,
            });
            await source.setContentMetadataIfMissing(ref, 'p1', {
                releaseYear: 1995,
                backdropUrl: 'detail.jpg',
            });
            // Cold details are not catalog confirmation and must not mutate the favorite.
            expect(read('xtream-collection-items')).toEqual(before);
            expect(await source.getRecentItems('p1')).toEqual([]);
            const detailRef = {
                ...ref,
                identity: { tmdbId: 100, releaseYear: 1995 },
            };
            await source.removeFavorite(detailRef, 'p1');
            const setItem = Storage.prototype.setItem;
            const blocked = jest
                .spyOn(Storage.prototype, 'setItem')
                .mockImplementation(function (this: Storage, key, value) {
                    if (key === 'xtream-collection-items')
                        throw new DOMException('Full', 'QuotaExceededError');
                    setItem.call(this, key, value);
                });
            await expect(source.addFavorite(detailRef, 'p1')).rejects.toThrow();
            expect(read('xtream-favorites').p1).toEqual([]);
            blocked.mockRestore();
            await source.addFavorite(detailRef, 'p1');
            reload();
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                title: 'Original',
                tmdb_id: 100,
                release_year: 1995,
                backdrop_url: 'detail.jpg',
            });
            const backup = new PwaXtreamBackupStorage(localStorage).exportInto({
                exportedId: 'p1',
                portalType: 'xtream',
                title: 'Test',
                autoRefresh: false,
                connection: credentials,
                userState: {
                    favorites: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                    hiddenCategories: [],
                },
            });
            expect(backup.userState.favorites[0].snapshot).toMatchObject({
                tmdbId: 100,
                releaseYear: 1995,
                title: 'Original',
            });
            expect(api.getStreams).toHaveBeenCalledTimes(1);
        }
    );

    it('does not reuse cold detail candidates after another snapshot replaces their source', async () => {
        const ref = { id: 42, type: 'movie' } as const;
        await source.getContent('p1', credentials, 'movie');
        await source.addFavorite(ref, 'p1');
        reload();
        await source.setContentMetadataIfMissing(ref, 'p1', { tmdbId: 100 });
        await source.removeFavorite(ref, 'p1');
        const snapshots = read('xtream-collection-items');
        snapshots.p1['movie:42'].title = 'Imported replacement';
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify(snapshots)
        );
        await expect(
            source.addFavorite({ ...ref, identity: { tmdbId: 100 } }, 'p1')
        ).rejects.toThrow('XTREAM_FAVORITE_SAVE_FAILED');
        expect(read('xtream-favorites').p1).toEqual([]);
    });

    it('keeps cold favorite candidates scoped and rejects conflicting detail identity', async () => {
        const ref = { id: 42, type: 'movie' } as const;
        await source.getContent('p1', credentials, 'movie');
        await source.addFavorite(ref, 'p1');
        reload();
        await source.setContentMetadataIfMissing(ref, 'p1', { tmdbId: 100 });
        await source.removeFavorite(ref, 'p1');
        for (const [playlist, type] of [
            ['p2', 'movie'],
            ['p1', 'series'],
        ] as const) {
            await expect(
                source.addFavorite(
                    { id: 42, type, identity: { tmdbId: 100 } },
                    playlist
                )
            ).rejects.toThrow('XTREAM_FAVORITE_SAVE_FAILED');
        }
        await source.addFavorite({ ...ref, identity: { tmdbId: 100 } }, 'p1');
        reload();
        await source.setContentMetadataIfMissing(ref, 'p1', { tmdbId: 200 });
        await expect(
            source.removeFavorite({ ...ref, identity: { tmdbId: 200 } }, 'p1')
        ).rejects.toThrow('XTREAM_FAVORITE_IDENTITY_CONFLICT');
        await source.removeFavorite(
            { ...ref, identity: { tmdbId: 100 } },
            'p1'
        );
        await expect(
            source.addFavorite({ ...ref, identity: { tmdbId: 200 } }, 'p1')
        ).rejects.toThrow('XTREAM_FAVORITE_SAVE_FAILED');
        expect(read('xtream-collection-items').p1['movie:42'].tmdb_id).toBe(
            100
        );
    });

    it.each(['movie', 'series'] as const)(
        'enriches cold %s Recent metadata before accepting its detail favorite',
        async (type) => {
            const ref = { id: 42, type };
            await source.getContent('p1', credentials, type);
            await source.addRecentItem(ref, 'p1');
            const viewedAt = read('xtream-recent-items').p1[0].viewedAt;
            reload();
            await source.setContentMetadataIfMissing(ref, 'p1', {
                tmdbId: 100,
                releaseYear: 1995,
            });
            await source.addFavorite(
                { ...ref, identity: { tmdbId: 100, releaseYear: 1995 } },
                'p1'
            );
            reload();
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                title: 'Original',
                tmdb_id: 100,
                release_year: 1995,
            });
            expect(read('xtream-recent-items').p1[0].viewedAt).toBe(viewedAt);
            expect(api.getStreams).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['movie', 'series'] as const)(
        'persists identity-only %s detail enrichment before a provider reuses the ID',
        async (type) => {
            const ref = { id: 42, type };
            await source.getContent('p1', credentials, type);
            await source.addFavorite(ref, 'p1');
            await source.addRecentItem(ref, 'p1');
            const viewedAt = read('xtream-recent-items').p1[0].viewedAt;
            await source.setContentMetadataIfMissing(ref, 'p1', {
                tmdbId: 100,
                releaseYear: 1995,
                originalTitle: 'Original title',
            });
            expect(
                read('xtream-collection-items').p1[`${type}:42`]
            ).toMatchObject({
                tmdb_id: 100,
                release_year: 1995,
                original_title: 'Original title',
            });
            expect(read('xtream-recent-items').p1[0].viewedAt).toBe(viewedAt);
            reload();
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Replacement',
                    category_id: '1',
                    tmdb_id: 200,
                    release_year: 2026,
                },
            ]);
            await source.getContent('p1', credentials, type);
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                title: 'Original',
                tmdb_id: 100,
                release_year: 1995,
                catalog_status: 'missing',
            });
            reload();
            const backup = new PwaXtreamBackupStorage(localStorage).exportInto({
                exportedId: 'p1',
                portalType: 'xtream',
                title: 'Test',
                autoRefresh: false,
                connection: credentials,
                userState: {
                    favorites: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                    hiddenCategories: [],
                },
            }).userState;
            expect(backup.favorites[0].snapshot).toMatchObject({
                title: 'Original',
                tmdbId: 100,
                releaseYear: 1995,
            });
        }
    );
    it('enriches a replacement Recent snapshot without changing the retained favorite', async () => {
        const ref = { id: 42, type: 'movie' } as const;
        await source.getContent('p1', credentials, 'movie');
        await source.addFavorite(ref, 'p1');
        await source.setContentMetadataIfMissing(ref, 'p1', {
            tmdbId: 100,
            releaseYear: 1995,
        });
        const old = read('xtream-collection-items').p1['movie:42'];
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                p1: {
                    'movie:42': { ...old, added_at: '2026-01-01', position: 4 },
                },
            })
        );
        reload();
        api.getStreams.mockResolvedValue([
            {
                stream_id: 42,
                name: 'Replacement',
                tmdb_id: 200,
                category_id: '1',
            },
        ]);
        await source.getContent('p1', credentials, 'movie');
        await source.addRecentItem(ref, 'p1');
        const viewedAt = read('xtream-recent-items').p1[0].viewedAt;
        await source.setContentMetadataIfMissing(ref, 'p1', {
            tmdbId: 200,
            releaseYear: 2026,
            backdropUrl: ' replacement.jpg ',
        });
        await source.setContentMetadataIfMissing(ref, 'p1', {
            tmdbId: 100,
            backdropUrl: 'stale-detail.jpg',
        });
        expect(read('xtream-collection-items').p1['movie:42']).toMatchObject({
            title: 'Original',
            tmdb_id: 100,
            release_year: 1995,
            added_at: '2026-01-01',
            position: 4,
        });
        reload();
        expect((await source.getRecentItems('p1'))[0]).toMatchObject({
            title: 'Replacement',
            tmdb_id: 200,
            release_year: 2026,
            backdrop_url: 'replacement.jpg',
            viewed_at: viewedAt,
        });
    });

    it('retains partial detail identity through repeat calls and optional snapshot quota failures', async () => {
        const ref = { id: 42, type: 'movie' } as const;
        await source.getContent('p1', credentials, 'movie');
        await source.addFavorite(ref, 'p1');
        await source.setContentMetadataIfMissing(ref, 'p1', { tmdbId: 100 });
        await source.setContentMetadataIfMissing(ref, 'p1', {
            tmdbId: 0,
            releaseYear: 1995,
        });
        const before = read('xtream-collection-items').p1['movie:42'];
        expect(before).toMatchObject({ tmdb_id: 100, release_year: 1995 });
        const setItem = Storage.prototype.setItem;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
            this: Storage,
            key,
            value
        ) {
            if (key === 'xtream-collection-items')
                throw new DOMException('Full', 'QuotaExceededError');
            setItem.call(this, key, value);
        });
        await expect(
            source.setContentMetadataIfMissing(ref, 'p1', {
                backdropUrl: 'new.jpg',
            })
        ).resolves.toBeUndefined();
        expect(read('xtream-collection-items').p1['movie:42']).toEqual(before);
        expect(read('xtream-favorites').p1).toEqual(['movie:42']);
    });
    it.each(['live', 'movie', 'series'] as const)(
        'uses the displayed %s identity for duplicate catalog heart actions',
        async (type) => {
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Original',
                    category_id: '1',
                    tmdb_id: 100,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.addFavorite({ id: 42, type }, 'p1');
            source.clearSessionCache('p1');
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Original',
                    category_id: '1',
                    tmdb_id: 100,
                },
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Replacement',
                    category_id: '2',
                    tmdb_id: 200,
                },
            ]);
            await source.getContent('p1', credentials, type);
            const original = { id: 42, type, identity: { tmdbId: 100 } };
            const replacement = { id: 42, type, identity: { tmdbId: 200 } };
            expect(await source.isFavorite(original, 'p1')).toBe(true);
            expect(await source.isFavorite(replacement, 'p1')).toBe(false);
            await expect(source.addFavorite(replacement, 'p1')).rejects.toThrow(
                'XTREAM_FAVORITE_IDENTITY_CONFLICT'
            );
            await source.removeFavorite(original, 'p1');
            await source.addFavorite(original, 'p1');
            expect(await source.isFavorite(original, 'p1')).toBe(true);
            await source.removeFavorite(original, 'p1');
            await source.addFavorite(replacement, 'p1');
            expect(await source.isFavorite(replacement, 'p1')).toBe(true);
            expect(
                read('xtream-collection-items').p1[`${type}:42`].tmdb_id
            ).toBe(200);
        }
    );

    it.each(['live', 'movie', 'series'] as const)(
        'records the played %s identity over independent cold Recent metadata',
        async (type) => {
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Watched original',
                    category_id: '1',
                    tmdb_id: 100,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.addRecentItem({ id: 42, type }, 'p1');
            source.clearSessionCache('p1');
            api.getStreams.mockResolvedValue([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: 'Replacement favorite',
                    category_id: '1',
                    tmdb_id: 200,
                },
            ]);
            await source.getContent('p1', credentials, type);
            await source.addFavorite({ id: 42, type }, 'p1');
            reload();
            expect((await source.getRecentItems('p1'))[0].tmdb_id).toBe(100);
            const ref = { id: 42, type };
            const prior = localStorage.getItem('xtream-recent-items');
            const set = localStorage.setItem.bind(localStorage);
            const failure = jest
                .spyOn(Storage.prototype, 'setItem')
                .mockImplementation((key, value) => {
                    if (key === 'xtream-recent-items') throw new Error('quota');
                    set(key, value);
                });
            await expect(
                source.addRecentItem(ref, 'p1', undefined, {
                    title: 'Replacement favorite',
                    tmdbId: 200,
                })
            ).rejects.toThrow('quota');
            expect(localStorage.getItem('xtream-recent-items')).toBe(prior);
            failure.mockRestore();
            await source.addRecentItem(ref, 'p1', undefined, {
                title: 'Replacement favorite',
                tmdbId: 200,
            });
            reload();
            expect((await source.getRecentItems('p1'))[0]).toMatchObject({
                title: 'Replacement favorite',
                tmdb_id: 200,
            });
            // Playing the older independent item must not overwrite the favorite.
            await source.addRecentItem(ref, 'p1', undefined, {
                title: 'Watched original',
                tmdbId: 100,
            });
            reload();
            expect((await source.getRecentItems('p1'))[0]).toMatchObject({
                title: 'Watched original',
                tmdb_id: 100,
            });
            expect((await source.getFavorites('p1'))[0]).toMatchObject({
                title: 'Replacement favorite',
                tmdb_id: 200,
            });
        }
    );
});
