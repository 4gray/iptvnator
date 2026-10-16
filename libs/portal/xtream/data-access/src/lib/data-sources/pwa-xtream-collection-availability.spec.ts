import { TestBed } from '@angular/core/testing';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import { PwaXtreamBackupStorage } from '@iptvnator/services/pwa-xtream-backup-storage';
import {
    normalizeXtreamPendingRestoreState,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { XtreamApiService } from '../services/xtream-api.service';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';
import { XtreamContentItem } from './xtream-data-source.interface';

const types = ['live', 'movie', 'series'] as const;
const credentials = {
    serverUrl: 'http://localhost:3211',
    username: 'demo',
    password: 'test',
};

describe('PWA collection availability after catalog completion', () => {
    let source: PwaXtreamDataSource;
    const api = { getStreams: jest.fn().mockResolvedValue([]) };
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
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: () => of({ _id: 'p', ...credentials }),
                    },
                },
            ],
        });
        source = TestBed.inject(PwaXtreamDataSource);
    };
    beforeEach(() => {
        localStorage.clear();
        api.getStreams.mockClear();
        reload();
    });
    afterEach(() => {
        localStorage.clear();
        TestBed.resetTestingModule();
    });

    it.each(types)(
        'retains absent %s snapshots with missing status through reload and export',
        async (type) => {
            const key = `${type}:42`;
            const saved: XtreamContentItem = {
                id: 42,
                xtream_id: 42,
                type,
                title: 'Saved favorite',
                category_id: '1',
                rating: '',
                added: '',
                poster_url: 'saved.jpg',
                tmdb_id: 949,
                release_year: 1995,
                added_at: '2026-01-02',
                position: 3,
                catalog_status: 'present',
            };
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ p: [key] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({ p: { [key]: saved } })
            );
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    p: [
                        {
                            id: key,
                            viewedAt: '2026-01-03',
                            collectionItem: {
                                ...saved,
                                title: 'Viewed item',
                                tmdb_id: 950,
                            },
                        },
                    ],
                })
            );
            // A same-ID item of another type is not evidence for the saved item.
            const otherType = type === 'live' ? 'movie' : 'live';
            await source.saveContent(
                'p',
                [{ ...saved, type: otherType }],
                otherType
            );
            expect((await source.getFavorites('p'))[0].catalog_status).toBe(
                'present'
            );
            for (const missingType of types.filter(
                (entry) => entry !== otherType
            ))
                await source.saveContent('p', [], missingType);
            expect(await source.getFavorites('p')).toEqual([
                {
                    ...saved,
                    catalog_status: 'missing',
                    catalog_missing_reason: 'absent',
                },
            ]);
            expect((await source.getRecentItems('p'))[0]).toMatchObject({
                title: 'Viewed item',
                tmdb_id: 950,
                catalog_status: 'missing',
                viewed_at: '2026-01-03',
            });
            reload();
            expect((await source.getFavorites('p'))[0]).toEqual({
                ...saved,
                catalog_status: 'missing',
                catalog_missing_reason: 'absent',
            });
            expect((await source.getRecentItems('p'))[0]).toMatchObject({
                title: 'Viewed item',
                tmdb_id: 950,
                catalog_status: 'missing',
            });
            expect(api.getStreams).not.toHaveBeenCalled();
            const backup = new PwaXtreamBackupStorage(localStorage).exportInto({
                exportedId: 'p',
                userState: {
                    favorites: [],
                    hiddenCategories: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                },
            } as unknown as XtreamPlaylistBackupEntry);
            expect(backup.userState.favorites[0]).toMatchObject({
                addedAt: saved.added_at,
                position: 3,
                snapshot: {
                    title: saved.title,
                    tmdbId: 949,
                    releaseYear: 1995,
                },
            });
            // Presence without detail identity restores access, not presentation.
            await source.saveContent(
                'p',
                [
                    {
                        ...saved,
                        title: 'Sparse return',
                        poster_url: 'new.jpg',
                        tmdb_id: undefined,
                        release_year: undefined,
                    },
                ],
                type
            );
            for (const read of [
                () => source.getFavorites('p'),
                () => source.getRecentItems('p'),
            ])
                expect((await read())[0].catalog_status).toBe('present');
            expect((await source.getFavorites('p'))[0]).toMatchObject(saved);
            reload();
            expect((await source.getFavorites('p'))[0]).toMatchObject(saved);
            expect((await source.getRecentItems('p'))[0]).toMatchObject({
                title: 'Viewed item',
                tmdb_id: 950,
                catalog_status: 'present',
            });
            await source.saveContent(
                'p',
                [{ ...saved, title: 'Returned favorite' }],
                type
            );
            expect((await source.getFavorites('p'))[0]).toMatchObject({
                title: 'Returned favorite',
                catalog_status: 'present',
                added_at: saved.added_at,
                position: 3,
            });
            // The independent Recent identity still conflicts with the returning favorite.
            expect((await source.getRecentItems('p'))[0]).toMatchObject({
                title: 'Viewed item',
                tmdb_id: 950,
                catalog_status: 'missing',
            });
            await source.removeFavorite({ type, id: 42 }, 'p');
            expect(await source.getFavorites('p')).toEqual([]);
        }
    );

    it.each([false, true])(
        'keeps a known conflict blocked after absence and sparse return (legacy=%s)',
        async (legacy) => {
            const saved = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Original',
                tmdb_id: 949,
                release_year: 1995,
            } as XtreamContentItem;
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ p: ['movie:42'] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({
                    p: {
                        'movie:42': {
                            ...saved,
                            ...(legacy ? { catalog_status: 'missing' } : {}),
                        },
                    },
                })
            );
            if (!legacy) {
                await source.saveContent(
                    'p',
                    [{ ...saved, tmdb_id: 950 }],
                    'movie'
                );
                expect((await source.getFavorites('p'))[0].catalog_status).toBe(
                    'missing'
                );
            }
            for (const type of types) await source.saveContent('p', [], type);
            expect((await source.getFavorites('p'))[0].catalog_status).toBe(
                'missing'
            );
            const store = new PwaXtreamBackupStorage(localStorage);
            const backup = store.exportInto({
                exportedId: 'p',
                userState: {
                    favorites: [],
                    hiddenCategories: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                },
            } as unknown as XtreamPlaylistBackupEntry);
            localStorage.clear();
            await store.restore('p', backup.userState, backup);
            reload();
            await source.saveContent(
                'p',
                [{ ...saved, tmdb_id: undefined }],
                'movie'
            );
            expect((await source.getFavorites('p'))[0]).toMatchObject({
                title: 'Original',
                catalog_status: 'missing',
            });
            await source.saveContent('p', [saved], 'movie');
            expect((await source.getFavorites('p'))[0].catalog_status).toBe(
                'present'
            );
        }
    );

    it.each([
        [949, 950, null],
        [950, 949, null],
        [null, 949, 950],
        [null, 950, 949],
    ])(
        'resolves each collection against its original identity with duplicate rows %p',
        async (...identities) => {
            const saved = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Favorite',
                tmdb_id: 949,
                release_year: 1995,
                added_at: '2026-01-02',
                position: 3,
            } as XtreamContentItem;
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ p: ['movie:42'] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({ p: { 'movie:42': saved } })
            );
            localStorage.setItem(
                'xtream-recent-items',
                JSON.stringify({
                    p: [
                        {
                            id: 'movie:42',
                            viewedAt: '2026-01-03',
                            collectionItem: {
                                ...saved,
                                title: 'Recent',
                                tmdb_id: 950,
                            },
                        },
                    ],
                })
            );
            await source.saveContent(
                'p',
                identities.map((id) => ({
                    ...saved,
                    title: `Catalog ${id}`,
                    tmdb_id: id,
                    category_id: String(id),
                })),
                'movie'
            );
            expect((await source.getFavorites('p'))[0]).toMatchObject({
                title: 'Catalog 949',
                tmdb_id: 949,
                category_id: '949',
                catalog_status: 'present',
                added_at: saved.added_at,
                position: 3,
            });
            expect((await source.getRecentItems('p'))[0]).toMatchObject({
                title: 'Catalog 950',
                tmdb_id: 950,
                category_id: '950',
                catalog_status: 'present',
                viewed_at: '2026-01-03',
            });
            reload();
            expect((await source.getFavorites('p'))[0].catalog_status).toBe(
                'present'
            );
            expect((await source.getRecentItems('p'))[0].catalog_status).toBe(
                'present'
            );
        }
    );

    it.each(['absent', 'identity_conflict', undefined])(
        'retains %p availability evidence through quota failure and entry-free retry',
        async (reason) => {
            const saved = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Original',
                tmdb_id: 949,
                release_year: 1995,
                catalog_status: 'missing',
                catalog_missing_reason: reason,
            };
            localStorage.setItem(
                'xtream-favorites',
                JSON.stringify({ p: ['movie:42'] })
            );
            localStorage.setItem(
                'xtream-collection-items',
                JSON.stringify({ p: { 'movie:42': saved } })
            );
            const store = new PwaXtreamBackupStorage(localStorage);
            const archive = store.exportInto({
                exportedId: 'p',
                userState: {
                    favorites: [],
                    hiddenCategories: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                },
            } as unknown as XtreamPlaylistBackupEntry);
            const pending = normalizeXtreamPendingRestoreState(
                JSON.parse(JSON.stringify(archive.userState))
            );
            localStorage.clear();
            const write = Storage.prototype.setItem;
            const failure = jest
                .spyOn(Storage.prototype, 'setItem')
                .mockImplementation(function (
                    this: Storage,
                    key: string,
                    value: string
                ) {
                    if (key === 'xtream-collection-items')
                        throw new DOMException('full', 'QuotaExceededError');
                    return write.call(this, key, value);
                });
            await expect(store.restore('p', pending, archive)).rejects.toThrow(
                'full'
            );
            failure.mockRestore();
            await source.restoreUserData('p', pending);
            reload();
            await source.saveContent(
                'p',
                [
                    {
                        ...saved,
                        tmdb_id: undefined,
                        release_year: undefined,
                        catalog_status: undefined,
                    } as XtreamContentItem,
                ],
                'movie'
            );
            expect((await source.getFavorites('p'))[0]).toMatchObject({
                title: 'Original',
                tmdb_id: 949,
                catalog_status: reason === 'absent' ? 'present' : 'missing',
            });
        }
    );

    it.each([false, true])(
        'keeps conflicts unavailable through stored aliases until identity returns (legacy=%s)',
        async (legacy) => {
            await source.restoreUserData('p', {
                favorites: [
                    {
                        contentType: 'movie',
                        xtreamId: 42,
                        snapshot: {
                            title: 'Original',
                            tmdbId: 100,
                            releaseYear: 1995,
                        },
                    },
                ],
                hiddenCategories: [],
                recentlyViewed: [],
                playbackPositions: [],
            });
            if (legacy) {
                const snapshots = JSON.parse(
                    localStorage.getItem('xtream-collection-items') ?? '{}'
                );
                snapshots.p[42] = snapshots.p['movie:42'];
                localStorage.setItem(
                    'xtream-collection-items',
                    JSON.stringify(snapshots)
                );
            }
            const returning = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Returning',
                tmdb_id: 200,
                release_year: 1995,
            } as XtreamContentItem;
            await source.saveContent('p', [returning], 'movie');
            expect((await source.getFavorites('p'))[0]).toMatchObject({
                catalog_status: 'missing',
                title: 'Original',
            });
            reload();
            expect((await source.getFavorites('p'))[0]).toMatchObject({
                catalog_status: 'missing',
            });
            await source.saveContent(
                'p',
                [{ ...returning, tmdb_id: undefined }],
                'movie'
            );
            expect((await source.getFavorites('p'))[0]).toMatchObject({
                catalog_status: 'missing',
                title: 'Original',
            });
            await source.saveContent(
                'p',
                [{ ...returning, tmdb_id: 100 }],
                'movie'
            );
            expect((await source.getFavorites('p'))[0]).toMatchObject({
                catalog_status: 'present',
                title: 'Returning',
            });
        }
    );

    it('marks an absent legacy snapshot without prior status missing only after all types succeed', async () => {
        const saved = {
            id: 42,
            xtream_id: 42,
            type: 'movie',
            title: 'Legacy favorite',
        };
        localStorage.setItem('xtream-favorites', JSON.stringify({ p: [42] }));
        localStorage.setItem(
            'xtream-collection-items',
            JSON.stringify({ p: { 42: saved } })
        );
        await source.saveContent('p', [], 'movie');
        await source.saveContent('p', [], 'live');
        api.getStreams.mockRejectedValueOnce(new Error('Offline'));
        await expect(
            source.getContent('p', credentials, 'series')
        ).rejects.toThrow('Offline');
        expect(
            (await source.getFavorites('p'))[0].catalog_status
        ).toBeUndefined();
        await source.saveContent('p', [], 'series');
        expect((await source.getFavorites('p'))[0]).toMatchObject({
            title: saved.title,
            catalog_status: 'missing',
        });
    });
});
