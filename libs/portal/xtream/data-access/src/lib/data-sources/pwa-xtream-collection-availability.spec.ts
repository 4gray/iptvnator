import { TestBed } from '@angular/core/testing';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import { PwaXtreamBackupStorage } from '@iptvnator/services/pwa-xtream-backup-storage';
import { XtreamPlaylistBackupEntry } from '@iptvnator/shared/interfaces';
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
                { ...saved, catalog_status: 'missing' },
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
