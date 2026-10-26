import { TestBed } from '@angular/core/testing';
import {
    ParentalLockService,
    PlaylistsService,
    USER_DATA_STORAGE,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import { PwaXtreamBackupStorage } from '@iptvnator/services/pwa-xtream-backup-storage';
import { XtreamPlaylistBackupEntry } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { XtreamApiService } from '../services/xtream-api.service';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';
import { XtreamContentItem } from './xtream-data-source.interface';

const credentials = {
    serverUrl: 'http://localhost:3211',
    username: 'demo',
    password: 'test',
};
const types = ['live', 'movie', 'series'] as const;

describe('PWA Xtream collection identity', () => {
    let source: PwaXtreamDataSource;
    const api = { getStreams: jest.fn() };
    const playlists = { getPlaylistById: jest.fn() };
    const reload = () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                {
                    provide: ParentalLockService,
                    useValue: {
                        active: () => false,
                        lockedXtreamIds: () => [],
                    },
                },
                { provide: XtreamApiService, useValue: api },
                { provide: PlaylistsService, useValue: playlists },
            ],
        });
        source = TestBed.inject(PwaXtreamDataSource);
    };
    const loadAll = () =>
        Promise.all(
            types.map((type) => source.getContent('p1', credentials, type))
        );
    const read = (key: string) => JSON.parse(localStorage.getItem(key) ?? '{}');
    const seedLegacyCollection = (otherIds: number[] = []) => {
        const ids = [42, ...otherIds];
        localStorage.setItem('xtream-favorites', JSON.stringify({ p1: ids }));
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                p1: ids.map((id) => ({
                    id,
                    viewedAt: '2026-10-01T00:00:00.000Z',
                })),
            })
        );
        const snapshots: Record<string, unknown> = {};
        for (const id of ids.filter((id) => id !== 77)) {
            snapshots[id] = {
                id,
                xtream_id: id,
                type: id === 42 ? 'movie' : 'series',
                title: 'Saved item '.repeat(100),
            };
        }
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({ p1: snapshots })
        );
    };
    const limitStorageGrowth = (extraCharacters: number) => {
        const storedSize = () =>
            Object.keys(localStorage).reduce(
                (size, key) =>
                    size +
                    key.length +
                    (localStorage.getItem(key)?.length ?? 0),
                0
            );
        const quota = storedSize() + extraCharacters;
        const setItem = Storage.prototype.setItem;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
            this: Storage,
            key,
            value
        ) {
            const oldValue = this.getItem(key);
            const growth =
                value.length -
                (oldValue?.length ?? 0) +
                (oldValue === null ? key.length : 0);
            if (storedSize() + growth > quota)
                throw new DOMException('Storage full', 'QuotaExceededError');
            setItem.call(this, key, value);
        });
    };

    beforeEach(() => {
        localStorage.clear();
        api.getStreams.mockReset().mockImplementation((_credentials, type) =>
            Promise.resolve([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: `${type} 42`,
                    category_id: '1',
                },
            ])
        );
        playlists.getPlaylistById.mockReturnValue(
            of({ _id: 'p1', title: 'Test', ...credentials })
        );
        reload();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it.each([0, 512])(
        'keeps legacy collection reads and status usable with only %i characters of storage headroom',
        async (headroom) => {
            seedLegacyCollection();
            limitStorageGrowth(headroom);
            for (let attempt = 0; attempt < 2; attempt++) {
                expect(await source.getFavorites('p1')).toEqual([
                    expect.objectContaining({ xtream_id: 42, type: 'movie' }),
                ]);
                expect(await source.getRecentItems('p1')).toEqual([
                    expect.objectContaining({ xtream_id: 42, type: 'movie' }),
                ]);
                expect(
                    await source.isFavorite({ id: 42, type: 'movie' }, 'p1')
                ).toBe(true);
                expect(
                    await source.isFavorite({ id: 42, type: 'live' }, 'p1')
                ).toBe(false);
                reload();
            }
            expect(read('xtream-collection-items').p1[42].type).toBe('movie');
            expect(api.getStreams).not.toHaveBeenCalled();
        }
    );

    it.each([
        ['removeFavorite', 0],
        ['removeFavorite', 512],
        ['removeRecentItem', 0],
        ['removeRecentItem', 512],
    ] as const)(
        '%s persists deletion with only %i characters of storage headroom',
        async (operation, headroom) => {
            seedLegacyCollection([
                77,
                ...Array.from({ length: 12 }, (_, index) => 100 + index),
            ]);
            limitStorageGrowth(headroom);
            await source[operation]({ id: 42, type: 'movie' }, 'p1');
            expect(api.getStreams).not.toHaveBeenCalled();
            const key =
                operation === 'removeFavorite'
                    ? 'xtream-favorites'
                    : 'xtream-recent-items';
            const storedIds =
                operation === 'removeFavorite'
                    ? read(key).p1
                    : read(key).p1.map((entry: { id: unknown }) => entry.id);
            expect(storedIds).not.toContain(42);
            expect(storedIds).not.toContain('movie:42');
            expect(storedIds).toContain(77);
            expect(read('xtream-collection-items').p1[42].type).toBe('movie');
            reload();
            const favorites = await source.getFavorites('p1');
            const recent = await source.getRecentItems('p1');
            expect(favorites.some((item) => item.xtream_id === 42)).toBe(
                operation !== 'removeFavorite'
            );
            expect(recent.some((item) => item.xtream_id === 42)).toBe(
                operation !== 'removeRecentItem'
            );
        }
    );

    it.each(['addFavorite', 'addRecentItem'] as const)(
        '%s reports an authoritative write that cannot fit',
        async (operation) => {
            seedLegacyCollection();
            limitStorageGrowth(0);
            await expect(
                source[operation]({ id: 99, type: 'series' }, 'p1')
            ).rejects.toMatchObject({ name: 'QuotaExceededError' });
            expect(read('xtream-favorites').p1).toEqual([42]);
            expect(
                read('xtream-recent-items').p1.map(
                    (entry: { id: unknown }) => entry.id
                )
            ).toEqual([42]);
        }
    );

    it.each(['addFavorite', 'addRecentItem'] as const)(
        '%s succeeds when the reference fits but its optional snapshot does not',
        async (operation) => {
            seedLegacyCollection();
            api.getStreams.mockResolvedValue([
                { series_id: 99, name: 'New series '.repeat(100) },
            ]);
            await source.getContent('p1', credentials, 'series');
            limitStorageGrowth(512);
            await source[operation]({ id: 99, type: 'series' }, 'p1');
            const storedIds =
                operation === 'addFavorite'
                    ? read('xtream-favorites').p1
                    : read('xtream-recent-items').p1.map(
                          (entry: { id: unknown }) => entry.id
                      );
            expect(storedIds).toContain('series:99');
            expect(
                read('xtream-collection-items').p1['series:99']
            ).toBeUndefined();
            reload();
            const items =
                operation === 'addFavorite'
                    ? await source.getFavorites('p1')
                    : await source.getRecentItems('p1');
            expect(items).toContainEqual(
                expect.objectContaining({ xtream_id: 99, type: 'series' })
            );
        }
    );

    it.each(['addFavorite', 'addRecentItem', 'statusThenAddFavorite'] as const)(
        '%s saves the requested reference before optional copies consume its space',
        async (operation) => {
            seedLegacyCollection();
            const snapshots = read('xtream-collection-items');
            const copyGrowth =
                JSON.stringify({
                    p1: { ...snapshots.p1, 'movie:42': snapshots.p1[42] },
                }).length - JSON.stringify(snapshots).length;
            const keyGrowth =
                JSON.stringify({ p1: ['movie:42'] }).length -
                JSON.stringify({ p1: [42] }).length;
            // Both optional writes fit exactly, but then leave no room for an addition.
            limitStorageGrowth(copyGrowth + keyGrowth);
            const target = { id: 99, type: 'series' } as const;
            if (operation === 'statusThenAddFavorite') {
                expect(await source.isFavorite(target, 'p1')).toBe(false);
                expect(
                    await source.isFavorite({ id: 42, type: 'movie' }, 'p1')
                ).toBe(true);
                expect(Storage.prototype.setItem).not.toHaveBeenCalled();
            }
            const mutation =
                operation === 'addRecentItem' ? operation : 'addFavorite';
            await expect(
                source[mutation](target, 'p1')
            ).resolves.toBeUndefined();
            const storedIds =
                mutation === 'addFavorite'
                    ? read('xtream-favorites').p1
                    : read('xtream-recent-items').p1.map(
                          (entry: { id: unknown }) => entry.id
                      );
            expect(storedIds).toContain('series:99');
            expect(read('xtream-collection-items').p1[42]).toEqual(
                snapshots.p1[42]
            );
            expect(api.getStreams).not.toHaveBeenCalled();
        }
    );

    it.each([42, 'movie:42'])(
        'deduplicates before the 50-item limit while preserving the newer %s key until the save',
        async (newerKey) => {
            seedLegacyCollection();
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    p1: [
                        {
                            id: newerKey === 42 ? 'movie:42' : 42,
                            viewedAt: '2026-09-30T00:00:00.000Z',
                        },
                        { id: newerKey, viewedAt: '2026-10-02T00:00:00.000Z' },
                        ...Array.from({ length: 48 }, (_, index) => ({
                            id: `series:${100 + index}`,
                            viewedAt: '2026-10-01T00:00:00.000Z',
                        })),
                    ],
                })
            );
            const writes = jest.spyOn(Storage.prototype, 'setItem');
            await source.addRecentItem({ id: 99, type: 'series' }, 'p1');
            expect(writes.mock.calls[0][0]).toBe('xtream-recent-items');
            expect(JSON.parse(writes.mock.calls[0][1]).p1).toContainEqual({
                id: newerKey,
                viewedAt: '2026-10-02T00:00:00.000Z',
            });
            const recent = read('xtream-recent-items').p1;
            expect(recent).toHaveLength(50);
            expect(recent).toContainEqual({
                id: 'series:147',
                viewedAt: '2026-10-01T00:00:00.000Z',
            });
            expect(recent).toContainEqual({
                id: 'movie:42',
                viewedAt: '2026-10-02T00:00:00.000Z',
            });
            expect(recent[0].id).toBe('series:99');
            expect(api.getStreams).not.toHaveBeenCalled();
        }
    );

    it('preserves restored colliding types through hydration and clear/restore', async () => {
        await source.restoreUserData('p1', {
            hiddenCategories: [],
            playbackPositions: [],
            favorites: types.map((contentType) => ({
                contentType,
                xtreamId: 42,
            })),
            recentlyViewed: types.map((contentType, i) => ({
                contentType,
                xtreamId: 42,
                viewedAt: `2026-10-0${i + 1}T12:00:00.000Z`,
            })),
        });
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(types);
        expect(
            (await source.getRecentItems('p1')).map((item) => item.type)
        ).toEqual(['series', 'movie', 'live']);
        const backup = await source.clearPlaylistContent('p1');
        expect(backup.favorites).toEqual(
            types.map((contentType) => ({ contentType, xtreamId: 42 }))
        );
        expect(backup.recentlyViewed.map((item) => item.contentType)).toEqual(
            types
        );
        reload();
        await source.restoreUserData('p1', backup);
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(types);
    });

    it('restores playback positions under the playlist they are restored to', async () => {
        await source.restoreUserData('p1', {
            hiddenCategories: [],
            favorites: [],
            recentlyViewed: [],
            playbackPositions: [
                {
                    contentXtreamId: 42,
                    contentType: 'vod',
                    positionSeconds: 90,
                    playlistId: 'exported-id',
                    updatedAt: '2026-10-01T12:00:00.000Z',
                },
            ],
        });

        expect(await source.getPlaybackPosition('p1', 42, 'vod')).toEqual({
            contentXtreamId: 42,
            contentType: 'vod',
            positionSeconds: 90,
            playlistId: 'p1',
            updatedAt: '2026-10-01T12:00:00.000Z',
        });
    });

    it.each(['xtream-favorites', 'xtream-collection-items'])(
        'retains saved metadata through %s quota failure, replay, offline reads and re-export',
        async (failedKey) => {
            const entry: XtreamPlaylistBackupEntry = {
                portalType: 'xtream',
                exportedId: 'p1',
                title: 'Saved portal',
                autoRefresh: false,
                connection: credentials,
                userState: {
                    hiddenCategories: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                    favorites: types.map((contentType, position) => ({
                        contentType,
                        xtreamId: 42,
                        position,
                        addedAt: '2026-10-01T12:00:00.000Z',
                        snapshot: {
                            title: `Saved ${contentType}`,
                            posterUrl: `https://img.example.com/${contentType}.jpg`,
                            backdropUrl: `https://img.example.com/${contentType}-wide.jpg`,
                            tmdbId: 100 + position,
                            releaseYear: 1995 + position,
                            originalTitle: `Original ${contentType}`,
                        },
                    })),
                },
            };
            const pending = TestBed.inject(XtreamPendingRestoreService);
            const parked = pending.set('p1', entry.userState);
            if (!parked) throw new Error('Expected parked restore');
            const backup = new PwaXtreamBackupStorage(
                TestBed.inject(USER_DATA_STORAGE)
            );
            let blockedKey = failedKey;
            const setItem = Storage.prototype.setItem;
            jest.spyOn(Storage.prototype, 'setItem').mockImplementation(
                function (this: Storage, key, value) {
                    if (key === blockedKey)
                        throw new DOMException('full', 'QuotaExceededError');
                    setItem.call(this, key, value);
                }
            );
            await expect(
                pending.applyAndConsume('p1', parked, (state) =>
                    backup.restore('p1', state, entry)
                )
            ).rejects.toMatchObject({ name: 'QuotaExceededError' });
            expect(pending.getOrThrow('p1')?.favorites).toEqual(
                entry.userState.favorites
            );

            // Lists fit now, but the sole saved metadata still must not be discarded.
            blockedKey = 'xtream-collection-items';
            await expect(
                pending.applyAndConsume('p1', parked, (state) =>
                    source.restoreUserData('p1', state)
                )
            ).rejects.toMatchObject({ name: 'QuotaExceededError' });
            expect(pending.getOrThrow('p1')?.favorites).toEqual(
                entry.userState.favorites
            );

            blockedKey = '';
            await expect(
                pending.applyAndConsume('p1', parked, (state) =>
                    source.restoreUserData('p1', state)
                )
            ).resolves.toBe('consumed');
            expect(pending.getOrThrow('p1')).toBeNull();
            api.getStreams.mockResolvedValue([]);
            reload();
            const items = await source.getFavorites('p1');
            expect(
                items.map(({ title, type, xtream_id }) => ({
                    title,
                    type,
                    xtream_id,
                }))
            ).toEqual(
                types.map((type) => ({
                    title: `Saved ${type}`,
                    type,
                    xtream_id: 42,
                }))
            );
            expect(
                new PwaXtreamBackupStorage(
                    TestBed.inject(USER_DATA_STORAGE)
                ).exportInto(entry).userState.favorites
            ).toEqual(entry.userState.favorites);
        }
    );

    it('keeps imported favorite fields through sparse catalog reads, recent writes, reload and export', async () => {
        const favorites = types.map((contentType, position) => ({
            contentType,
            xtreamId: 42,
            position,
            addedAt: '2026-10-01T12:00:00.000Z',
            snapshot: {
                title: `${contentType} 42`,
                posterUrl: `https://img.example.com/${contentType}.jpg`,
                backdropUrl: `https://img.example.com/${contentType}-wide.jpg`,
                tmdbId: 100 + position,
                releaseYear: 1995 + position,
                originalTitle: `Original ${contentType}`,
            },
        }));
        const entry: XtreamPlaylistBackupEntry = {
            portalType: 'xtream',
            exportedId: 'p1',
            title: 'Saved portal',
            autoRefresh: false,
            connection: credentials,
            userState: {
                hiddenCategories: [],
                recentlyViewed: [],
                playbackPositions: [],
                favorites,
            },
        };
        await source.restoreUserData('p1', entry.userState);
        await loadAll();
        const loaded = await source.getFavorites('p1');
        expect(loaded.map((item) => item.poster_url)).toEqual(
            favorites.map((item) => item.snapshot.posterUrl)
        );
        for (const type of types) {
            await source.addRecentItem({ id: 42, type }, 'p1');
        }
        await source.getRecentItems('p1');
        reload();
        api.getStreams.mockResolvedValue([]);
        await source.getFavorites('p1');
        expect(
            new PwaXtreamBackupStorage(
                TestBed.inject(USER_DATA_STORAGE)
            ).exportInto(entry).userState.favorites
        ).toEqual(favorites);
    });

    it.each([
        'missing',
        'partial',
        'tmdb conflict',
        'year conflict',
        'confirmed',
        'numeric strings',
        'zero',
        'empty',
    ])(
        'protects imported identities through %s catalog rows, recent writes and re-export',
        async (identity) => {
            const favorites = types.map((contentType, position) => ({
                contentType,
                xtreamId: 42,
                position,
                addedAt: '2026-10-01T12:00:00.000Z',
                snapshot: {
                    title: `Saved ${contentType}`,
                    posterUrl: `https://img.example.com/saved-${contentType}.jpg`,
                    tmdbId: 100 + position,
                    releaseYear: 1995 + position,
                    originalTitle: `Original ${contentType}`,
                },
            }));
            const entry: XtreamPlaylistBackupEntry = {
                portalType: 'xtream',
                exportedId: 'p1',
                title: 'Saved portal',
                autoRefresh: false,
                connection: credentials,
                userState: {
                    hiddenCategories: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                    favorites,
                },
            };
            await source.restoreUserData('p1', entry.userState);
            api.getStreams.mockImplementation((_credentials, type) => {
                const position = types.indexOf(type);
                return Promise.resolve([
                    {
                        stream_id: 42,
                        series_id: 42,
                        category_id: '1',
                        name: `Returning ${type}`,
                        stream_icon: `https://img.example.com/returning-${type}.jpg`,
                        ...(identity !== 'missing'
                            ? {
                                  tmdb_id:
                                      identity === 'tmdb conflict'
                                          ? 999
                                          : identity === 'numeric strings'
                                            ? String(100 + position)
                                            : identity === 'zero'
                                              ? '0'
                                              : identity === 'empty'
                                                ? ''
                                                : 100 + position,
                              }
                            : {}),
                        ...(identity !== 'missing' && identity !== 'partial'
                            ? {
                                  release_year:
                                      identity === 'year conflict'
                                          ? 2026
                                          : identity === 'numeric strings'
                                            ? String(1995 + position)
                                            : identity === 'zero'
                                              ? 0
                                              : identity === 'empty'
                                                ? ''
                                                : 1995 + position,
                              }
                            : {}),
                    },
                ]);
            });
            await loadAll();
            // Recent and detail enrichment can run before Favorites is read.
            for (const type of types) {
                await source.addRecentItem(
                    { id: 42, type },
                    'p1',
                    'https://img.example.com/returning-wide.jpg'
                );
                await source.setContentMetadataIfMissing(
                    { id: 42, type },
                    'p1',
                    { backdropUrl: 'https://img.example.com/detail-wide.jpg' }
                );
            }
            await source.getRecentItems('p1');
            if (['zero', 'empty'].includes(identity)) {
                for (const item of await source.getFavorites('p1'))
                    expect(item.catalog_status).not.toBe('missing');
            }
            if (identity.includes('conflict')) {
                for (const item of await source.getFavorites('p1')) {
                    expect(item).toMatchObject({ catalog_status: 'missing' });
                }
            }
            const expected = favorites.map((favorite) =>
                ['confirmed', 'numeric strings'].includes(identity)
                    ? {
                          ...favorite,
                          snapshot: {
                              ...favorite.snapshot,
                              catalogStatus: 'present',
                              title: `Returning ${favorite.contentType}`,
                              posterUrl: `https://img.example.com/returning-${favorite.contentType}.jpg`,
                              backdropUrl:
                                  'https://img.example.com/detail-wide.jpg',
                          },
                      }
                    : identity.includes('conflict')
                      ? {
                            ...favorite,
                            snapshot: {
                                ...favorite.snapshot,
                                catalogStatus: 'missing',
                                catalogMissingReason: 'identity_conflict',
                            },
                        }
                      : favorite
            );
            expect(
                (await source.getFavorites('p1')).map((item) => item.title)
            ).toEqual(expected.map((item) => item.snapshot.title));
            const exportFavorites = () =>
                new PwaXtreamBackupStorage(
                    TestBed.inject(USER_DATA_STORAGE)
                ).exportInto(entry).userState.favorites;
            expect(exportFavorites()).toEqual(expected);
            reload();
            api.getStreams.mockResolvedValue([]);
            await source.getRecentItems('p1');
            await source.getFavorites('p1');
            expect(exportFavorites()).toEqual(expected);
        }
    );

    it.each([false, true])(
        'replaces an explicitly removed favorite with current catalog data (legacy=%s)',
        async (legacy) => {
            await source.restoreUserData('p1', {
                favorites: [
                    {
                        contentType: 'movie',
                        xtreamId: 42,
                        snapshot: { title: 'Original', tmdbId: 100 },
                    },
                ],
                hiddenCategories: [],
                recentlyViewed: [],
                playbackPositions: [],
            });
            if (legacy) {
                const snapshots = read('xtream-collection-items');
                snapshots.p1[42] = snapshots.p1['movie:42'];
                localStorage.setItem(
                    'xtream-collection-items',
                    JSON.stringify(snapshots)
                );
            }
            const replacement = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Replacement',
                tmdb_id: 200,
                poster_url: 'new.jpg',
            } as XtreamContentItem;
            await source.saveContent('p1', [replacement], 'movie');
            await source.getFavorites('p1');
            // A replacement detail heart cannot remove or claim the original favorite.
            expect(
                await source.isFavorite({ id: 42, type: 'movie' }, 'p1')
            ).toBe(false);
            await expect(
                source.addFavorite({ id: 42, type: 'movie' }, 'p1')
            ).rejects.toThrow('XTREAM_FAVORITE_IDENTITY_CONFLICT');
            expect((await source.getFavorites('p1'))[0].title).toBe('Original');
            // Explicit removal carries the original saved identity, as the Favorites row does.
            await source.removeFavorite({ id: 42, type: 'movie', identity: { tmdbId: 100 } }, 'p1');
            const setItem = Storage.prototype.setItem;
            const quota = jest
                .spyOn(Storage.prototype, 'setItem')
                .mockImplementation(function (this: Storage, key, value) {
                    if (key === 'xtream-collection-items')
                        throw new DOMException('full', 'QuotaExceededError');
                    setItem.call(this, key, value);
                });
            await expect(
                source.addFavorite({ id: 42, type: 'movie' }, 'p1')
            ).rejects.toMatchObject({ name: 'QuotaExceededError' });
            expect(await source.getFavorites('p1')).toEqual([]);
            quota.mockRestore();
            await source.addFavorite({ id: 42, type: 'movie' }, 'p1');
            reload();
            expect(await source.getFavorites('p1')).toEqual([
                expect.objectContaining({
                    title: 'Replacement',
                    tmdb_id: 200,
                    poster_url: 'new.jpg',
                }),
            ]);
        }
    );

    it.each([false, true])(
        'records replacement playback after removing obsolete Recent (quota=%s)',
        async (quota) => {
            const ref = { id: 42, type: 'movie' as const };
            const [cached] = await source.getContent(
                'p1',
                credentials,
                'movie'
            );
            const original = cached as XtreamContentItem;
            original.tmdb_id = 100;
            const expected = { title: 'Replacement', tmdb_id: 200 };
            await source.saveContent('p1', [original], 'movie');
            await source.addRecentItem(ref, 'p1');
            await source.saveContent(
                'p1',
                [{ ...original, ...expected }],
                'movie'
            );
            await source.getRecentItems('p1');
            await source.removeRecentItem(ref, 'p1');
            if (quota) {
                const setItem = Storage.prototype.setItem;
                const failure = jest
                    .spyOn(Storage.prototype, 'setItem')
                    .mockImplementation(function (this: Storage, key, value) {
                        if (key === 'xtream-recent-items')
                            throw new DOMException(
                                'full',
                                'QuotaExceededError'
                            );
                        setItem.call(this, key, value);
                    });
                await expect(
                    source.addRecentItem(ref, 'p1')
                ).rejects.toMatchObject({ name: 'QuotaExceededError' });
                expect(read('xtream-recent-items').p1).toEqual([]);
                failure.mockRestore();
            }
            await source.addRecentItem(ref, 'p1');
            expect((await source.getRecentItems('p1'))[0]).toMatchObject(
                expected
            );
            reload();
            api.getStreams.mockResolvedValue([]);
            const [item] = await source.getRecentItems('p1');
            expect(item).toMatchObject({ title: 'Replacement', tmdb_id: 200 });
            expect(item.catalog_status).not.toBe('missing');
            expect(await source.getFavorites('p1')).toEqual([]);
        }
    );

    it('keeps played replacements separate from retained favorites through reload and backup restore', async () => {
        const entry: XtreamPlaylistBackupEntry = {
            portalType: 'xtream',
            exportedId: 'p1',
            title: 'Saved portal',
            autoRefresh: false,
            connection: credentials,
            userState: {
                hiddenCategories: [],
                playbackPositions: [],
                recentlyViewed: [],
                favorites: types.map((contentType) => ({
                    contentType,
                    xtreamId: 42,
                    snapshot: { title: `Original ${contentType}`, tmdbId: 100 },
                })),
            },
        };
        await source.restoreUserData('p1', entry.userState);
        api.getStreams.mockImplementation((_credentials, type) =>
            Promise.resolve([
                {
                    stream_id: 42,
                    series_id: 42,
                    name: `Replacement ${type}`,
                    category_id: '1',
                    tmdb_id: 200,
                    stream_icon: 'replacement.jpg',
                },
            ])
        );
        await loadAll();
        for (const type of types)
            await source.addRecentItem({ id: 42, type }, 'p1');
        const verify = async () => {
            expect(
                (await source.getFavorites('p1')).map((item) => item.title)
            ).toEqual(types.map((type) => `Original ${type}`));
            const recent = await source.getRecentItems('p1');
            expect(recent).toHaveLength(3);
            for (const item of recent) {
                expect(item).toMatchObject({
                    title: `Replacement ${item.type}`,
                    tmdb_id: 200,
                    poster_url: 'replacement.jpg',
                });
                expect(item.catalog_status).not.toBe('missing');
            }
        };
        await verify();
        reload();
        api.getStreams.mockResolvedValue([]);
        await verify();
        const backup = new PwaXtreamBackupStorage(
            TestBed.inject(USER_DATA_STORAGE)
        ).exportInto(entry);
        expect(backup.userState.favorites).toEqual(
            entry.userState.favorites.map((favorite) => ({
                ...favorite,
                snapshot: {
                    ...favorite.snapshot,
                    catalogStatus: 'missing',
                    catalogMissingReason: 'identity_conflict',
                },
            }))
        );
        localStorage.clear();
        reload();
        await new PwaXtreamBackupStorage(
            TestBed.inject(USER_DATA_STORAGE)
        ).restore('p1', backup.userState, backup);
        await verify();
        const pending = await source.clearPlaylistContent('p1');
        await source.restoreUserData('p1', pending);
        await verify();
    });

    it('retains concurrent explicit additions after loading the favorite writer', async () => {
        await loadAll();
        await Promise.all(
            types.map((type) => source.addFavorite({ id: 42, type }, 'p1'))
        );
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(types);
    });

    it('keeps a new favorite when a compatible Recent snapshot cannot be refreshed', async () => {
        await loadAll();
        await source.addRecentItem({ id: 42, type: 'movie' }, 'p1');
        const setItem = Storage.prototype.setItem;
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
            this: Storage,
            key,
            value
        ) {
            if (key === 'xtream-collection-items')
                throw new DOMException('full', 'QuotaExceededError');
            setItem.call(this, key, value);
        });
        await expect(
            source.addFavorite({ id: 42, type: 'movie' }, 'p1')
        ).resolves.toBeUndefined();
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(['movie']);
    });

    it('keeps the artwork saved with each view through clear/restore', async () => {
        await source.restoreUserData('p1', {
            hiddenCategories: [],
            playbackPositions: [],
            favorites: [],
            recentlyViewed: [
                {
                    contentType: 'movie',
                    xtreamId: 42,
                    viewedAt: '2026-10-01T12:00:00.000Z',
                    backdropUrl: 'https://img.example.com/still.jpg',
                },
            ],
        });
        expect(read('xtream-recent-items').p1).toEqual([
            {
                id: 'movie:42',
                viewedAt: '2026-10-01T12:00:00.000Z',
                backdropUrl: 'https://img.example.com/still.jpg',
            },
        ]);

        const backup = await source.clearPlaylistContent('p1');
        expect(backup.recentlyViewed).toEqual([
            {
                contentType: 'movie',
                xtreamId: 42,
                viewedAt: '2026-10-01T12:00:00.000Z',
                backdropUrl: 'https://img.example.com/still.jpg',
            },
        ]);
    });

    it('preserves ambiguous numeric legacy entries without selecting the last matching type', async () => {
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['42'] })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                p1: [{ id: 42, viewedAt: '2026-10-01T12:00:00.000Z' }],
            })
        );
        await loadAll();
        expect(await source.getFavorites('p1')).toEqual([]);
        expect(await source.getRecentItems('p1')).toEqual([]);
        expect(read('xtream-favorites').p1).toEqual(['42']);
        expect(read('xtream-recent-items').p1[0].id).toBe(42);
    });
    it('does not infer a legacy type from a partially loaded catalog', async () => {
        localStorage.setItem('xtream-favorites', JSON.stringify({ p1: [42] }));
        await source.getContent('p1', credentials, 'movie');
        expect(await source.getFavorites('p1')).toEqual([]);
        expect(api.getStreams).toHaveBeenCalledWith(credentials, 'live');
        expect(api.getStreams).toHaveBeenCalledWith(credentials, 'series');
    });

    it('migrates a numeric reference using its stored typed snapshot offline', async () => {
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['42'] })
        );
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                p1: {
                    42: {
                        id: 42,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Saved Movie',
                    },
                },
            })
        );
        expect(
            (await source.getFavorites('p1')).map((item) => item.title)
        ).toEqual(['Saved Movie']);
        expect(read('xtream-favorites').p1).toEqual(['movie:42']);
        expect(read('xtream-collection-items').p1['movie:42'].title).toBe(
            'Saved Movie'
        );
        expect(api.getStreams).not.toHaveBeenCalled();
    });

    it('keeps additions, status, removal and snapshot backdrops isolated after reload', async () => {
        await loadAll();
        for (const type of types) {
            await source.addFavorite({ id: 42, type }, 'p1');
            await source.addRecentItem({ id: 42, type }, 'p1');
        }
        await source.setContentMetadataIfMissing(
            { id: 42, type: 'movie' },
            'p1',
            { backdropUrl: 'movie.jpg' }
        );
        expect(
            (await source.getFavorites('p1')).map((item) => [
                item.type,
                item.backdrop_url,
            ])
        ).toEqual([
            ['live', undefined],
            ['movie', 'movie.jpg'],
            ['series', undefined],
        ]);
        reload();
        api.getStreams.mockClear();
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(types);
        expect(
            (await source.getRecentItems('p1')).map((item) => item.type)
        ).toEqual(['series', 'movie', 'live']);
        await source.removeFavorite({ id: 42, type: 'movie' }, 'p1');
        await source.removeRecentItem({ id: 42, type: 'series' }, 'p1');
        expect(await source.isFavorite({ id: 42, type: 'movie' }, 'p1')).toBe(
            false
        );
        expect(await source.isFavorite({ id: 42, type: 'series' }, 'p1')).toBe(
            true
        );
        expect(
            (await source.getRecentItems('p1')).map((item) => item.type)
        ).toEqual(['movie', 'live']);
        expect(api.getStreams).not.toHaveBeenCalled();
    });

    it('hydrates only the exact typed category for a cold typed favorite', async () => {
        await source.addFavorite({ id: 42, type: 'movie' }, 'p1');
        reload();
        api.getStreams.mockClear();
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(['movie']);
        expect(api.getStreams.mock.calls.map((call) => call[1])).toEqual([
            'movie',
        ]);
    });

    it.each([
        'addFavorite',
        'removeFavorite',
        'isFavorite',
        'addRecentItem',
        'removeRecentItem',
    ] as const)(
        '%s completes locally while unrelated catalog hydration is pending',
        async (operation) => {
            const savedIds = [42, 77, 'series:99'];
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ p1: savedIds })
            );
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    p1: savedIds.map((id) => ({
                        id,
                        viewedAt: '2026-10-01T00:00:00.000Z',
                    })),
                })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({
                    p1: {
                        42: {
                            id: 42,
                            xtream_id: 42,
                            type: 'movie',
                            title: 'Saved Movie',
                        },
                    },
                })
            );
            let releaseCatalog!: (items: unknown[]) => void;
            const catalog = new Promise((resolve) => {
                releaseCatalog = resolve;
            });
            api.getStreams.mockReturnValue(catalog);
            const loading = Promise.all([
                source.getFavorites('p1'),
                source.getRecentItems('p1'),
            ]);
            for (let i = 0; i < 20; i++) await Promise.resolve();
            const requestsBeforeAction = api.getStreams.mock.calls.length;
            expect(requestsBeforeAction).toBeGreaterThan(0);
            const adding =
                operation === 'addFavorite' || operation === 'addRecentItem';
            let settled = false;
            let result: boolean | void = undefined;
            const action = source[operation](
                { id: 42, type: adding ? 'live' : 'movie' },
                'p1'
            ).then((value) => {
                result = value;
                settled = true;
            });
            try {
                for (let i = 0; i < 20; i++) await Promise.resolve();
                expect(settled).toBe(true);
                expect(api.getStreams).toHaveBeenCalledTimes(
                    requestsBeforeAction
                );
                if (operation === 'isFavorite') expect(result).toBe(true);
                const storedIds = operation.includes('Recent')
                    ? read('xtream-recent-items').p1.map(
                          (entry: { id: unknown }) => entry.id
                      )
                    : read('xtream-favorites').p1;
                const expectedIds = operation.startsWith('remove')
                    ? [77, 'series:99']
                    : adding
                      ? ['movie:42', 77, 'series:99', 'live:42']
                      : [42, 77, 'series:99'];
                expect([...storedIds].sort()).toEqual(expectedIds.sort());
            } finally {
                releaseCatalog([]);
                await Promise.all([loading, action]);
            }
        }
    );

    it('preserves newer storage changes while legacy hydration is pending', async () => {
        localStorage.setItem('xtream-favorites', JSON.stringify({ p1: [42] }));
        let resolveMovie!: (items: unknown[]) => void;
        api.getStreams.mockImplementation((_credentials, type) =>
            type === 'movie'
                ? new Promise((resolve) => {
                      resolveMovie = resolve;
                  })
                : Promise.resolve([])
        );
        const pending = source.getFavorites('p1');
        for (let i = 0; i < 10 && !resolveMovie; i++) await Promise.resolve();
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['series:99'], other: ['live:77'] })
        );
        resolveMovie([{ stream_id: 42, name: 'Movie' }]);
        await pending;
        expect(read('xtream-favorites')).toEqual({
            p1: ['series:99'],
            other: ['live:77'],
        });
    });

    it('deduplicates migrated recents using the most recent timestamp', async () => {
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                p1: [
                    { id: 42, viewedAt: '2026-10-01T00:00:00.000Z' },
                    { id: 'movie:42', viewedAt: '2026-10-02T00:00:00.000Z' },
                ],
            })
        );
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({
                p1: {
                    42: {
                        id: 42,
                        xtream_id: 42,
                        type: 'movie',
                        title: 'Saved Movie',
                    },
                },
            })
        );
        expect(await source.getRecentItems('p1')).toEqual([
            expect.objectContaining({
                type: 'movie',
                viewed_at: '2026-10-02T00:00:00.000Z',
            }),
        ]);
        expect(read('xtream-recent-items').p1).toEqual([
            { id: 'movie:42', viewedAt: '2026-10-02T00:00:00.000Z' },
        ]);
    });
    it('resolves a unique legacy type even when that catalog repeats its provider row', async () => {
        localStorage.setItem('xtream-favorites', JSON.stringify({ p1: [42] }));
        api.getStreams.mockImplementation((_credentials, type) =>
            Promise.resolve(
                type === 'movie'
                    ? [
                          { stream_id: 42, name: 'Movie' },
                          { stream_id: 42, name: 'Movie' },
                      ]
                    : []
            )
        );
        expect(
            (await source.getFavorites('p1')).map((item) => item.type)
        ).toEqual(['movie']);
        expect(read('xtream-favorites').p1).toEqual(['movie:42']);
    });
});
