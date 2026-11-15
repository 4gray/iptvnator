import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
    SecondStreamCatalogService,
    SecondStreamChannel,
    type SecondStreamEpisode,
    type SecondStreamVodPage,
    SecondStreamEpgService,
    SecondStreamVodService,
} from '@iptvnator/portal/shared/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    EpgPreferencesService,
    EpgSourceSettingsService,
    SettingsStore,
} from '@iptvnator/services';
import { NEVER, Subject } from 'rxjs';
import { SecondStreamPickerComponent } from './second-stream-picker.component';

const row: SecondStreamChannel = {
    group: 'News',
    item: {
        uid: 'synthetic',
        name: 'Synthetic News',
        sourceType: 'm3u',
        contentType: 'live',
        playlistId: 'p',
        playlistName: 'Synthetic source',
    },
};
const series: UnifiedCollectionItem = {
    ...row.item,
    uid: 'synthetic-series',
    name: 'Synthetic series',
    sourceType: 'xtream',
    contentType: 'series',
};
const movie: UnifiedCollectionItem = {
    ...series,
    uid: 'synthetic-movie',
    name: 'Synthetic movie',
    contentType: 'movie',
};
const episode: SecondStreamEpisode = {
    episode: {
        id: '42',
        episode_num: 4,
        title: 'Fixture finale',
        season: 1,
        container_extension: 'mp4',
        info: [],
        custom_sid: '',
        added: '',
        direct_source: '',
    },
    season: 1,
    position: {
        contentType: 'episode',
        contentXtreamId: 42,
        positionSeconds: 30,
        durationSeconds: 120,
    },
};
const vodService = {
    browse: jest.fn(),
    episodes: jest.fn(),
    resolveMovie: jest.fn(),
    resolveEpisode: jest.fn(),
};

describe('SecondStreamPickerComponent', () => {
    let load: jest.Mock;
    let resolve: jest.Mock;
    let loadGroup: jest.Mock;
    let sources: jest.Mock;
    let close: jest.Mock;
    let beforeClosed: Subject<void>;
    let component: SecondStreamPickerComponent;
    const isAllowed = jest.fn();
    const findDuplicateSlot = jest.fn();
    beforeEach(() => {
        Object.values(vodService).forEach((mock) => mock.mockReset());
        load = jest.fn().mockResolvedValue({ groups: [], channels: [row] });
        resolve = jest.fn();
        sources = jest.fn().mockResolvedValue([]);
        loadGroup = jest.fn().mockResolvedValue([row]);
        close = jest.fn();
        isAllowed.mockReset().mockReturnValue(true);
        findDuplicateSlot.mockReset().mockReturnValue(undefined);
        beforeClosed = new Subject<void>();
        TestBed.configureTestingModule({
            imports: [SecondStreamPickerComponent],
            providers: [
                {
                    provide: SecondStreamCatalogService,
                    useValue: {
                        version: signal(0),
                        sources,
                        load,
                        resolve,
                        loadGroup,
                        isAllowed,
                    },
                },
                {
                    provide: MatDialogRef,
                    useValue: { close, beforeClosed: () => beforeClosed },
                },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        slot: 2,
                        replace: false,
                        returningToOriginal: false,
                        findDuplicateSlot,
                    },
                },
                {
                    provide: SecondStreamVodService,
                    useValue: vodService,
                },
                {
                    provide: SecondStreamEpgService,
                    useValue: { xmltvAvailable$: NEVER },
                },
                {
                    provide: EpgPreferencesService,
                    useValue: { enabled: signal(false) },
                },
                {
                    provide: EpgSourceSettingsService,
                    useValue: { revision: signal(0) },
                },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: signal(0) },
                },
            ],
        });
        TestBed.overrideComponent(SecondStreamPickerComponent, {
            set: { template: '' },
        });
        component = TestBed.createComponent(
            SecondStreamPickerComponent
        ).componentInstance;
    });
    it('keeps playlist choices when the first live catalog fails', async () => {
        const source = { id: 'portal', name: 'Synthetic portal', portal: true };
        sources.mockResolvedValue([source]);
        load.mockRejectedValueOnce(new Error('Synthetic catalog failure'));
        await component.loadSources();
        await component.reload();
        expect(component.error()).toBe('load');
        expect(component.sources()).toEqual([source]);
    });

    it('ignores a stale source response and aborts its request', async () => {
        let finish!: (value: unknown) => void;
        load.mockImplementationOnce(() => new Promise((r) => (finish = r)));
        const first = component.reload();
        const signal = load.mock.calls[0][1] as AbortSignal;
        component.source.set('other');
        await component.reload();
        finish({ groups: [], channels: [] });
        await first;
        expect(signal.aborted).toBe(true);
        expect(component.data().channels).toEqual([row]);
    });
    it('does not open a channel whose resolution finishes after source changes', async () => {
        let finish!: (value: unknown) => void;
        resolve.mockImplementation(() => new Promise((r) => (finish = r)));
        const pending = component.choose(row);
        await component.reload();
        finish({ streamUrl: 'https://media.example.test/live' });
        await pending;
        expect(close).not.toHaveBeenCalled();
    });

    it('ignores a resolution that finishes while the dialog is closing', async () => {
        let finish!: (value: unknown) => void;
        resolve.mockImplementation(() => new Promise((r) => (finish = r)));
        const pending = component.choose(row);

        beforeClosed.next();
        finish({ streamUrl: 'https://media.example.test/live' });
        await pending;

        expect(close).not.toHaveBeenCalled();
    });

    it('keeps the picker open and identifies the existing window for a duplicate', async () => {
        const playback = { streamUrl: 'https://media.example.test/live' };
        resolve.mockResolvedValue(playback);
        findDuplicateSlot.mockReturnValueOnce(4);
        await component.choose(row);
        expect(findDuplicateSlot).toHaveBeenCalledWith({
            item: row.item,
            playback,
        });
        expect(component.duplicateSlot()).toBe(4);
        expect(close).not.toHaveBeenCalled();
        await component.choose(row);
        expect(component.duplicateSlot()).toBeNull();
        expect(close).toHaveBeenCalledWith({ item: row.item, playback });
    });

    it('withholds a result when catalog access changes during resolution', async () => {
        let finish!: (value: unknown) => void;
        resolve.mockImplementation(() => new Promise((r) => (finish = r)));
        const pending = component.choose(row);
        isAllowed.mockReturnValue(false);
        finish({ streamUrl: 'https://media.example.test/live' });
        await pending;
        expect(component.error()).toBe('play');
        expect(close).not.toHaveBeenCalled();
    });
    it('searches the full source before limiting rendered rows', async () => {
        await component.reload();
        component.data.set({
            groups: [],
            channels: Array.from({ length: 150 }, (_, i) => ({
                ...row,
                item: { ...row.item, uid: String(i), name: `Channel ${i}` },
            })),
        });
        expect(component.visible()).toHaveLength(100);
        component.search.set('Channel 149');
        expect(component.visible().map((r) => r.item.name)).toEqual([
            'Channel 149',
        ]);
    });
    it('offers retry after load failure and keeps playback failures inside the picker', async () => {
        load.mockRejectedValueOnce(new Error('synthetic failure'));
        await component.reload();
        expect(component.error()).toBe('load');
        await component.reload();
        expect(component.error()).toBeNull();
        resolve.mockRejectedValue(new Error('synthetic unavailable'));
        await component.choose(row);
        expect(component.error()).toBe('play');
        expect(component.resolving()).toBeNull();
    });
    it('shows the remaining channels when a refreshed catalog withholds the selected group', async () => {
        component.group.set('Unavailable');
        load.mockResolvedValueOnce({
            groups: [{ id: 'News', name: 'News' }],
            channels: [row],
        });

        await component.reload();

        expect(component.group()).toBeNull();
        expect(component.visible()).toEqual([row]);
    });

    it('reloads a selected genre whose channels are fetched on demand', async () => {
        component.source.set('synthetic-source');
        component.group.set('News');
        load.mockResolvedValueOnce({
            groups: [{ id: 'News', name: 'News' }],
            channels: [],
        });

        await component.reload();

        expect(component.group()).toBe('News');
        expect(component.visible()).toEqual([row]);
        expect(component.loading()).toBe(false);
        expect(component.groupLoading()).toBe(false);
    });

    it('loads an omitted genre and ignores its response after changing source', async () => {
        let finish!: (value: unknown) => void;
        loadGroup.mockImplementationOnce(
            () => new Promise((r) => (finish = r))
        );
        const pending = component.selectGroup('News');
        const signal = loadGroup.mock.calls[0][2] as AbortSignal;
        await component.reload();
        finish([{ ...row, group: 'stale' }]);
        await pending;
        expect(signal.aborted).toBe(true);
        expect(component.data().channels).toEqual([row]);
        component.data.set({ groups: [], channels: [] });
        await component.selectGroup('News');
        expect(component.visible()).toEqual([row]);
        expect(component.groupLoading()).toBe(false);
    });

    it('retries loading playlist choices and resets filters on source changes', async () => {
        await component.loadSources();
        const source = { id: 'p', name: 'Synthetic playlist' };
        sources.mockRejectedValueOnce(new Error('Playlist load failed'));
        await component.loadSources();
        expect(component.sourceLoadFailed()).toBe(true);

        sources.mockResolvedValueOnce([source]);
        await component.loadSources();
        expect(component.sourceLoadFailed()).toBe(false);

        component.vod.type.set('movie');
        component.search.set('old query');
        component.group.set('News');
        component.changeSource(source.id);
        expect(component.vod.type()).toBeNull();
        expect(component.search()).toBe('');
        expect(component.group()).toBeNull();
        expect(component.hasContentTypes()).toBe(false);
        component.changeSource(component.historySource);
        expect(component.hasContentTypes()).toBe(true);
    });

    it('returns a failed group load to a selectable state', async () => {
        loadGroup.mockRejectedValueOnce(new Error('Group load failed'));
        await component.selectGroup('Sports');
        expect(component.error()).toBe('group');
        expect(component.groupLoading()).toBe(false);
        await component.selectGroup(null);
        expect(component.error()).toBeNull();
        expect(component.group()).toBeNull();
    });

    it('opens the movie selected from a locally filtered catalog', async () => {
        component.sources.set([
            { id: 'p', name: 'Fixture portal', portal: true },
        ]);
        component.changeSource('p');
        expect(component.hasContentTypes()).toBe(true);
        vodService.browse.mockResolvedValue({ items: [movie], hasMore: false });
        component.changeType('movie');
        await Promise.resolve();
        await Promise.resolve();
        expect(component.searchLabel()).toBe('TMDB_MATCH.SEARCH_MOVIE');
        component.updateSearch(' synthetic MOVIE ');
        expect(component.filteredVod()).toEqual([movie]);
        component.updateSearch('missing title');
        expect(component.filteredVod()).toEqual([]);
        expect(vodService.browse).toHaveBeenCalledTimes(1);

        const selection = {
            item: movie,
            playback: { streamUrl: 'https://media.example.test/movie' },
        };
        vodService.resolveMovie.mockResolvedValue(selection);
        component.chooseMovie(movie);
        component.chooseMovie(movie);
        await Promise.resolve();
        expect(close).toHaveBeenCalledWith(selection);
        expect(vodService.resolveMovie).toHaveBeenCalledTimes(1);
        component.changeType(null);
        expect(component.searchLabel()).toBe(
            'EMBEDDED_MPV.PLAYER.SEARCH_CHANNELS'
        );
    });

    it('filters episodes by title and number and restores the series search on back', async () => {
        vodService.browse.mockResolvedValue({
            items: [series],
            hasMore: false,
        });
        vodService.episodes.mockResolvedValue([episode]);
        component.updateSearch('synthetic');
        component.changeType('series');
        expect(component.searchLabel()).toBe('TMDB_MATCH.SEARCH_TV');
        component.openSeries(series);
        await Promise.resolve();
        expect(component.search()).toBe('');
        expect(component.searchLabel()).toBe('PORTALS.DETAIL.EPISODES');
        component.updateSearch('FINALE');
        expect(component.filteredEpisodes()).toEqual([episode]);
        component.updateSearch('4');
        expect(component.filteredEpisodes()).toEqual([episode]);
        expect(component.vod.episodeProgress(episode)).toBe(25);

        let finish!: (value: unknown) => void;
        vodService.resolveEpisode.mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve))
        );
        component.chooseEpisode(series, episode);
        expect(component.resolving()).toBe(episode.episode.id);
        expect(vodService.resolveEpisode).toHaveBeenCalledWith(series, episode);
        component.backToSeries();
        expect(component.search()).toBe('synthetic');
        expect(component.vod.series()).toBeNull();
        expect(component.resolving()).toBeNull();
        finish({ item: series, playback: {} });
        await Promise.resolve();
        expect(close).not.toHaveBeenCalled();
    });

    it('retries the same catalog page and appends only unseen titles', async () => {
        vodService.browse
            .mockResolvedValueOnce({
                items: [series],
                hasMore: true,
                pageKeys: ['series-page-one'],
                exhaustedCatalogs: ['vod'],
            })
            .mockRejectedValueOnce(new Error('Page load failed'))
            .mockResolvedValueOnce({
                items: [series, { ...series, uid: 'page-two' }],
                hasMore: false,
            });
        await component.vod.browse('p', 'series');
        await component.vod.more();
        expect(component.vod.failed()).toBe(true);
        expect(component.vod.items()).toEqual([series]);
        expect(component.vod.hasMore()).toBe(true);
        component.vod.retry();
        await Promise.resolve();
        expect(component.vod.failed()).toBe(false);
        expect(component.vod.items().map(({ uid }) => uid)).toEqual([
            series.uid,
            'page-two',
        ]);
        expect(component.vod.hasMore()).toBe(false);
        expect(vodService.browse.mock.calls.map((call) => call[4])).toEqual([
            1, 2, 2,
        ]);
        expect(vodService.browse).toHaveBeenLastCalledWith(
            'p',
            'series',
            expect.any(AbortSignal),
            '',
            2,
            new Set(['series-page-one']),
            new Set(['vod'])
        );
    });

    it('debounces Stalker search and discards the preceding catalog result', async () => {
        await component.loadSources();
        TestBed.tick();
        jest.useFakeTimers();
        try {
            let finish!: (result: SecondStreamVodPage) => void;
            vodService.browse
                .mockImplementationOnce(
                    () =>
                        new Promise<SecondStreamVodPage>((resolve) => {
                            finish = resolve;
                        })
                )
                .mockResolvedValueOnce({ items: [movie], hasMore: false });
            component.sources.set([
                {
                    id: 'p',
                    name: 'Fixture portal',
                    portal: true,
                    stalker: true,
                },
            ]);
            component.changeSource('p');
            component.changeType('movie');
            const request: AbortSignal = vodService.browse.mock.calls[0][2];

            component.updateSearch(' e ');
            expect(request.aborted).toBe(true);
            await jest.advanceTimersByTimeAsync(200);
            component.updateSearch(' exact ');
            await jest.advanceTimersByTimeAsync(249);
            expect(vodService.browse).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1);
            expect(vodService.browse.mock.calls[1].slice(3, 5)).toEqual([
                'exact',
                1,
            ]);
            finish({ items: [], hasMore: true });
            await Promise.resolve();
            expect(component.filteredVod()).toEqual([movie]);
            expect(component.vod.hasMore()).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    it('retries failed episode loading and cancels it on back', async () => {
        let rejectPending!: (error: Error) => void;
        vodService.episodes
            .mockRejectedValueOnce(new Error('Episode load failed'))
            .mockImplementationOnce(
                () =>
                    new Promise<SecondStreamEpisode[]>((_resolve, reject) => {
                        rejectPending = reject;
                    })
            );
        await component.vod.openSeries(series);
        expect(component.vod.failed()).toBe(true);
        component.vod.retry();
        const request: AbortSignal = vodService.episodes.mock.calls[1][1];
        expect(component.vod.loading()).toBe(true);
        component.backToSeries();
        expect(request.aborted).toBe(true);
        rejectPending(new Error('Late episode failure'));
        await Promise.resolve();
        expect(component.vod.failed()).toBe(false);
        expect(component.vod.loading()).toBe(false);
        expect(component.vod.episodes()).toEqual([]);
    });
});
