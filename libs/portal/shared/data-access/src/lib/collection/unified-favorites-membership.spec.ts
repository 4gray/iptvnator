import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { UnifiedCollectionDataService } from './unified-collection-data.service';
import { UnifiedRecentDataService } from './unified-recent-data.service';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

describe('UnifiedFavoritesDataService membership', () => {
    const originalElectron = window.electron;
    const stalkerFavorites = [
        { id: '42', title: 'Synthetic channel', category_id: 'itv' },
    ];
    const store = { select: jest.fn() };
    const playlistsService = {
        getPlaylistById: jest.fn(),
        preparePortalFavoriteActions: async () => undefined,
    };
    const removeFavorite = jest.fn();
    const databaseService = {
        getContentByXtreamId: jest.fn(),
        getFavorites: jest.fn(),
        getFavoritesOrThrow: jest.fn(),
    };
    let service: UnifiedFavoritesDataService;

    beforeEach(() => {
        jest.resetAllMocks();
        removeFavorite.mockResolvedValue({ success: true });
        databaseService.getContentByXtreamId.mockResolvedValue(null);
        window.electron = {
            dbRemoveFavorite: removeFavorite,
        } as unknown as Window['electron'];
        store.select.mockReturnValue(
            of([
                {
                    _id: 'm3u-1',
                    favorites: ['https://media.example.test/channel'],
                },
                { _id: 'stalker-1', favorites: stalkerFavorites },
            ])
        );
        TestBed.configureTestingModule({
            providers: [
                UnifiedFavoritesDataService,
                UnifiedCollectionDataService,
                { provide: UnifiedRecentDataService, useValue: {} },
                { provide: Store, useValue: store },
                { provide: DatabaseService, useValue: databaseService },
                { provide: PlaylistsService, useValue: playlistsService },
                { provide: XTREAM_DATA_SOURCE, useValue: {} },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsPortalActivityStorage: true,
                        supportsXtreamSqliteDataSource: true,
                    },
                },
            ],
        });
        service = TestBed.inject(UnifiedFavoritesDataService);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it.each(['m3u', 'stalker'] as const)(
        'distinguishes a failed %s membership read from an empty list',
        async (sourceType) => {
            const sourceId = sourceType + '-1';
            const error = new Error('Synthetic playlist read failure');
            playlistsService.getPlaylistById.mockReturnValue(
                throwError(() => error)
            );
            await expect(
                service.getFavorites('playlist', sourceId, sourceType)
            ).resolves.toEqual([]);
            await expect(
                service.getPlaylistFavoritesForMembership(sourceId, sourceType)
            ).rejects.toBe(error);
        }
    );

    it.each(['m3u', 'stalker'] as const)(
        'rejects a %s membership read after its source is removed',
        async (sourceType) => {
            const sourceId = sourceType + '-1';
            const read = () =>
                service.getPlaylistFavoritesForMembership(sourceId, sourceType);
            playlistsService.getPlaylistById.mockReturnValue(of(undefined));
            await expect(read()).rejects.toThrow(
                'Favorite source is unavailable'
            );
            expect(playlistsService.getPlaylistById).toHaveBeenCalledWith(
                sourceId
            );

            playlistsService.getPlaylistById.mockClear();
            store.select.mockReturnValue(of([]));
            await expect(
                service.getFavorites('playlist', sourceId, sourceType)
            ).resolves.toEqual([]);
            await expect(read()).rejects.toThrow(
                'Favorite source is unavailable'
            );
            expect(playlistsService.getPlaylistById).not.toHaveBeenCalled();
        }
    );

    it('reads actual Stalker membership even when playlist metadata has no favorites', async () => {
        const source = { _id: 'synthetic-portal', favorites: stalkerFavorites };
        store.select.mockReturnValue(of([{ ...source, favorites: [] }]));
        playlistsService.getPlaylistById.mockReturnValue(of(source));
        await expect(
            service.getFavorites('playlist', source._id, 'stalker')
        ).resolves.toEqual([]);
        await expect(
            service.getPlaylistFavoritesForMembership(source._id, 'stalker')
        ).resolves.toHaveLength(stalkerFavorites.length);
    });

    it('propagates a native Xtream membership read failure and retries from SQLite', async () => {
        const source = { _id: 'synthetic-portal', title: 'Synthetic source' };
        store.select.mockReturnValue(of([source]));
        const error = new Error('Synthetic native favorites read failure');
        databaseService.getFavoritesOrThrow.mockRejectedValueOnce(error);
        await expect(
            service.getPlaylistFavoritesForMembership(source._id, 'xtream')
        ).rejects.toBe(error);

        databaseService.getFavoritesOrThrow.mockResolvedValueOnce([
            {
                id: 20,
                favorite_id: 3,
                playlist_id: source._id,
                xtream_id: 13,
                title: 'Synthetic channel',
                type: 'live',
            },
        ]);
        await expect(
            service.getPlaylistFavoritesForMembership(source._id, 'xtream')
        ).resolves.toEqual([
            expect.objectContaining({
                favoriteId: 3,
                contentId: 20,
                playlistId: source._id,
                playlistName: source.title,
                xtreamId: 13,
                contentType: 'live',
            }),
        ]);
        expect(databaseService.getFavorites).not.toHaveBeenCalled();
    });

    it.each([true, false])(
        'removes a missing live favorite from history only with a matching saved identity (%s)',
        async (matches) => {
            const item: UnifiedCollectionItem = {
                uid: 'xtream::synthetic-source::live:42',
                name: 'Synthetic live channel',
                sourceType: 'xtream',
                contentType: 'live',
                playlistId: 'synthetic-source',
                playlistName: 'Synthetic source',
                xtreamId: 42,
                contentId: 12,
                categoryId: 7,
            };
            const collection = TestBed.inject(UnifiedCollectionDataService);
            collection.favoriteUidSet.set(new Set([item.uid]));
            const release = TestBed.inject(SourceActivityService).begin([
                item.playlistId,
            ]);
            databaseService.getFavorites.mockResolvedValue([
                {
                    favorite_id: 11,
                    type: 'movie',
                    xtream_id: 42,
                    catalog_status: 'missing',
                },
                {
                    favorite_id: 12,
                    type: 'live',
                    xtream_id: 42,
                    catalog_status: 'missing',
                    catalog_missing_reason: matches
                        ? null
                        : 'identity_conflict',
                },
            ]);
            const pending = collection.toggleFavorite(item);
            try {
                expect(databaseService.getFavorites).not.toHaveBeenCalled();
                expect(collection.favoriteUidSet().has(item.uid)).toBe(true);
            } finally {
                release();
                await pending;
            }
            if (matches)
                expect(removeFavorite).toHaveBeenCalledWith(
                    { favoriteId: 12 },
                    item.playlistId
                );
            else expect(removeFavorite).not.toHaveBeenCalled();
            expect(collection.favoriteUidSet().has(item.uid)).toBe(!matches);
        }
    );
});
