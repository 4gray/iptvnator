import { TestBed } from '@angular/core/testing';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { UnifiedFavoritesDataService } from './collection/unified-favorites-data.service';
import { UnifiedRecentDataService } from './collection/unified-recent-data.service';
import {
    SECOND_STREAM_HISTORY,
    SecondStreamCollectionService,
} from './second-stream-collection.service';

describe('SecondStreamCollectionService', () => {
    const movie: UnifiedCollectionItem = {
        uid: 'movie-1',
        name: 'Synthetic movie',
        playlistId: 'synthetic-xtream',
        playlistName: 'Synthetic Xtream',
        sourceType: 'xtream',
        contentType: 'movie',
        categoryId: 50,
    };

    let getFavorites: jest.Mock;
    let getRecentItems: jest.Mock;
    let getAllCategories: jest.Mock;
    let runtime: { supportsXtreamSqliteDataSource: boolean };
    let service: SecondStreamCollectionService;
    let signal: AbortSignal;

    beforeEach(() => {
        getFavorites = jest.fn().mockResolvedValue([]);
        getRecentItems = jest.fn().mockResolvedValue([]);
        getAllCategories = jest.fn().mockResolvedValue([]);
        runtime = { supportsXtreamSqliteDataSource: true };
        signal = new AbortController().signal;
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: { getFavorites },
                },
                {
                    provide: UnifiedRecentDataService,
                    useValue: { getRecentItems },
                },
                { provide: XTREAM_DATA_SOURCE, useValue: { getAllCategories } },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
            ],
        });
        service = TestBed.inject(SecondStreamCollectionService);
    });

    it('normalizes movie categories per playlist and removes hidden Xtream favorites', async () => {
        const otherPlaylist = {
            ...movie,
            uid: 'movie-2',
            playlistId: 'second-xtream',
        };
        const hidden = { ...movie, uid: 'movie-3', categoryId: 51 };
        const missingCategory = { ...movie, uid: 'movie-4', categoryId: 52 };
        const stalker = {
            ...movie,
            uid: 'movie-5',
            sourceType: 'stalker' as const,
        };
        getFavorites.mockResolvedValue([
            movie,
            otherPlaylist,
            hidden,
            missingCategory,
            stalker,
        ]);
        getAllCategories.mockImplementation(async (id: string) =>
            id === movie.playlistId
                ? [
                      { id: 50, xtream_id: 900 },
                      { id: 51, xtream_id: 901, hidden: true },
                  ]
                : [{ id: 50, xtream_id: 700 }]
        );

        expect(await service.load('', 'movie', signal)).toEqual([
            { ...movie, categoryId: 900 },
            { ...otherPlaylist, categoryId: 700 },
            { ...missingCategory, categoryId: undefined },
            stalker,
        ]);
        expect(getFavorites).toHaveBeenCalledWith('all');
        expect(getRecentItems).not.toHaveBeenCalled();
        expect(getAllCategories).toHaveBeenCalledTimes(2);
        expect(getAllCategories).toHaveBeenCalledWith(
            movie.playlistId,
            'movies'
        );
        expect(getAllCategories).toHaveBeenCalledWith(
            otherPlaylist.playlistId,
            'movies'
        );
    });

    it('promotes Stalker VOD series in recently viewed and retains browser category ids', async () => {
        runtime.supportsXtreamSqliteDataSource = false;
        const stalker = {
            ...movie,
            uid: 'stalker-series',
            sourceType: 'stalker' as const,
            stalkerItem: { is_series: '1' },
        };
        const xtream = {
            ...movie,
            uid: 'xtream-series',
            contentType: 'series' as const,
        };
        const live = {
            ...movie,
            uid: 'live-channel',
            contentType: 'live' as const,
        };
        const radio = { ...live, uid: 'live-radio', radio: 'true' as const };
        getRecentItems.mockResolvedValue([stalker, xtream, movie, live, radio]);

        expect(
            await service.load(SECOND_STREAM_HISTORY, 'series', signal)
        ).toEqual([{ ...stalker, contentType: 'series' }, xtream]);
        expect(stalker.contentType).toBe('movie');
        expect(
            await service.load(SECOND_STREAM_HISTORY, 'live', signal)
        ).toEqual([live]);
        expect(getRecentItems).toHaveBeenCalledWith('all');
        expect(getFavorites).not.toHaveBeenCalled();
        expect(getAllCategories).not.toHaveBeenCalled();
    });

    it('discards category metadata that arrives after the picker closes', async () => {
        const controller = new AbortController();
        const reason = new Error('Closed picker');
        getFavorites.mockResolvedValue([movie]);
        getAllCategories.mockImplementation(async () => {
            controller.abort(reason);
            return [{ id: 50, xtream_id: 900 }];
        });

        await expect(service.load('', 'movie', controller.signal)).rejects.toBe(
            reason
        );
        expect(getAllCategories).toHaveBeenCalledWith(
            movie.playlistId,
            'movies'
        );
    });
});
