import { TestBed } from '@angular/core/testing';
import { UnifiedCollectionDataService } from './unified-collection-data.service';
import { UnifiedRecentDataService } from './unified-recent-data.service';
import { of } from 'rxjs';
import type { StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

describe('typed shared Stalker favorites collection', () => {
    it('keeps same-ID kinds distinct and clears only the selected membership', async () => {
        const favorites: StalkerPortalItem[] = [
            { id: '42', favoriteContentType: 'vod', title: 'Synthetic movie' },
            {
                id: '42',
                favoriteContentType: 'series',
                title: 'Synthetic series',
            },
            {
                id: '42',
                favoriteContentType: 'vod',
                is_series: true,
                title: 'Synthetic lazy series',
            },
        ];
        const source = {
            _id: 'synthetic-source',
            macAddress: '00:11:22:33:44:55',
            title: 'Synthetic source',
            favorites,
        };
        const transformPlaylistFavorites = jest.fn(
            (
                _id: string,
                transform: (current: StalkerPortalItem[]) => StalkerPortalItem[]
            ) => of({ ...source, favorites: transform(favorites) })
        );
        const removeFromPortalFavorites = jest.fn(() => of(source));
        const service = Object.create(
            UnifiedFavoritesDataService.prototype
        ) as UnifiedFavoritesDataService;
        Object.assign(service, {
            stalkerMetadata: { project: (value: unknown) => value },
            favoriteSync: {
                active: () => true,
                project: async (value: unknown) => value,
            },
            playlistsService: {
                getPlaylistById: () => of(source),
                preparePortalFavoriteActions: async () => undefined,
                transformPlaylistFavorites,
                removeFromPortalFavorites,
            },
            getPlaylistMeta: async () => source,
            translate: { instant: (key: string) => key },
        });
        const items = await service.getFavorites(
            'playlist',
            'synthetic-source',
            'stalker'
        );
        expect(new Set(items.map((item) => item.uid)).size).toBe(3);
        await service.clearFavorites([items[0]]);
        const transform = transformPlaylistFavorites.mock.calls[0][1];
        expect(transform(favorites)).toEqual(favorites.slice(1));
        const retained = 'synthetic-unresolved-local-value';
        expect(
            transform([
                ...favorites,
                retained,
            ] as unknown as StalkerPortalItem[])
        ).toEqual([...favorites.slice(1), retained]);
        await service.reorder([...items].reverse(), {
            scope: 'playlist',
            playlistId: 'synthetic-source',
            portalType: 'stalker',
        });
        const reorder = transformPlaylistFavorites.mock.calls[1][1];
        expect(
            reorder([...favorites, retained] as unknown as StalkerPortalItem[])
        ).toEqual(
            [...favorites]
                .reverse()
                .concat(retained as unknown as StalkerPortalItem)
        );

        await service.removeFavorite(items[0]);
        expect(removeFromPortalFavorites).toHaveBeenLastCalledWith(
            'synthetic-source',
            '42',
            favorites[0]
        );
        const recent = { ...items[0], uid: 'stalker::synthetic-source::42' };
        TestBed.configureTestingModule({
            providers: [
                UnifiedCollectionDataService,
                { provide: UnifiedFavoritesDataService, useValue: service },
                {
                    provide: UnifiedRecentDataService,
                    useValue: { getRecentItems: async () => [recent] },
                },
            ],
        });
        const collection = TestBed.inject(UnifiedCollectionDataService);
        await collection.load({
            mode: 'recent',
            scope: 'playlist',
            playlistId: 'synthetic-source',
            portalType: 'stalker',
        });
        expect(collection.favoriteUidSet().has(recent.uid)).toBe(true);
        await collection.toggleFavorite(recent);
        expect(collection.favoriteUidSet().has(recent.uid)).toBe(false);
        expect(removeFromPortalFavorites).toHaveBeenLastCalledWith(
            'synthetic-source',
            '42',
            favorites[0]
        );
        TestBed.resetTestingModule();
    });
});

describe('legacy Stalker favorites in Recently Viewed', () => {
    const movie = {
        id: '42',
        title: 'Synthetic Movie',
        favoriteContentType: 'vod',
    } as const;
    const live = {
        id: '42',
        title: 'Synthetic Channel',
        favoriteContentType: 'itv',
    } as const;
    const legacy = { id: '42', title: movie.title };

    it.each([
        {
            scenario:
                'keeps the heart selected for an unambiguous legacy favorite',
            favorites: [legacy],
            recent: [movie],
            selected: [movie.title],
        },
        {
            scenario: 'matches two untyped records by their provider id',
            favorites: [legacy],
            recent: [legacy],
            selected: [legacy.title],
        },
        {
            scenario: 'leaves an ambiguous legacy match unselected',
            favorites: [legacy],
            recent: [movie, live],
            selected: [],
        },
        {
            scenario: 'keeps an exact typed match despite a legacy favorite',
            favorites: [legacy, live],
            recent: [movie, live],
            selected: [live.title],
        },
        {
            scenario:
                'keeps another typed favorite from making a legacy match look unambiguous',
            favorites: [legacy, live],
            recent: [movie],
            selected: [],
        },
        {
            scenario: 'does not use another typed favorite with the same id',
            favorites: [live],
            recent: [movie],
            selected: [],
        },
    ])('$scenario', async ({ favorites, recent, selected }) => {
        const source = {
            _id: 'synthetic-source',
            macAddress: '00:11:22:33:44:55',
            title: 'Synthetic Source',
            recentlyViewed: recent,
            favorites,
        };
        const removeFromPortalFavorites = jest.fn(() => of(source));
        const playlistsService = {
            getPlaylistById: () => of(source),
            preparePortalFavoriteActions: async () => undefined,
            removeFromPortalFavorites,
        };
        const favoritesData = Object.assign(
            Object.create(UnifiedFavoritesDataService.prototype),
            {
                favoriteSync: {
                    active: () => false,
                    project: async (value: unknown) => value,
                },
                stalkerMetadata: { project: (value: unknown) => value },
                playlistsService,
                getPlaylistMeta: async () => source,
            }
        );
        const recentData = Object.assign(
            Object.create(UnifiedRecentDataService.prototype),
            {
                history: { active: () => false },
                stalkerMetadata: {
                    item: (_: unknown, item: StalkerPortalItem) => item,
                },
                playlistsService,
                getPlaylistMeta: async () => source,
            }
        );
        TestBed.configureTestingModule({
            providers: [
                UnifiedCollectionDataService,
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: favoritesData,
                },
                { provide: UnifiedRecentDataService, useValue: recentData },
            ],
        });
        const collection = TestBed.inject(UnifiedCollectionDataService);
        const items = await collection.load({
            mode: 'recent',
            scope: 'playlist',
            playlistId: source._id,
            portalType: 'stalker',
        });

        expect(items?.map((item) => item.name)).toEqual(
            recent.map((item) => item.title)
        );
        const selectedItems = items?.filter((item) =>
            collection.favoriteUidSet().has(item.uid)
        );
        expect(selectedItems?.map((item) => item.name)).toEqual(selected);
        if (selectedItems?.length === 1) {
            const [item] = selectedItems;
            await collection.toggleFavorite(item);
            expect(removeFromPortalFavorites).toHaveBeenCalledWith(
                source._id,
                '42',
                item.stalkerItem
            );
        }
    });
});
