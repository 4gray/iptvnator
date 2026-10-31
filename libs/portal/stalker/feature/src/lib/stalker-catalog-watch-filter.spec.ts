import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    StalkerStore,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { createStalkerCatalogPositions } from './stalker-catalog-positions';
import {
    createStalkerCatalogWatchFilter,
    STALKER_HIDDEN_PAGE_BUDGET,
} from './stalker-catalog-watch-filter';

const position = (id: number, seconds = 100): PlaybackPositionData => ({
    playlistId: 'a',
    contentType: 'vod',
    contentXtreamId: id,
    positionSeconds: seconds,
    durationSeconds: 100,
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

describe('Stalker catalog hide watched', () => {
    let runtimeUpdate: (row: PlaybackPositionData) => void;
    const read = jest.fn<Promise<PlaybackPositionData[]>, [string]>();
    const write = jest.fn<Promise<void>, [string, PlaybackPositionData]>();
    const unsubscribe = jest.fn();
    let store: ReturnType<typeof makeStore>;
    let positions: ReturnType<typeof createStalkerCatalogPositions>;
    let filter: ReturnType<typeof createStalkerCatalogWatchFilter>;

    function makeStore() {
        const result = {
            currentPlaylist: signal<{ _id: string } | undefined>({ _id: 'a' }),
            selectedContentType: signal('vod'),
            selectedCategoryId: signal('*'),
            searchPhrase: signal(''),
            selectedItem: signal<StalkerVodSource | null>(null),
            page: signal(0),
            getPaginatedContent: signal<StalkerVodSource[]>([{ id: 1 }]),
            hasMoreContent: signal(true),
            hasContentAppendError: signal(false),
            isPaginatedContentLoading: signal(false),
            isContentRetrying: signal(false),
            nextPage: jest.fn(() => {
                result.page.update((p) => p + 1);
                result.isPaginatedContentLoading.set(true);
            }),
        };
        return result;
    }
    async function flush() {
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();
    }
    async function finishPage(items: StalkerVodSource[], more = true) {
        store.getPaginatedContent.update((raw) => [...raw, ...items]);
        store.hasMoreContent.set(more);
        store.isPaginatedContentLoading.set(false);
        await flush();
    }
    beforeEach(async () => {
        read.mockReset().mockResolvedValue([position(1)]);
        write.mockReset().mockResolvedValue(undefined);
        unsubscribe.mockReset();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: PORTAL_PLAYBACK_POSITIONS,
                    useValue: {
                        getAllPlaybackPositions: read,
                        savePlaybackPosition: write,
                    },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: {
                        onPlaybackPositionUpdate: (
                            fn: typeof runtimeUpdate
                        ) => {
                            runtimeUpdate = fn;
                            return unsubscribe;
                        },
                    },
                },
            ],
        });
        store = makeStore();
        TestBed.runInInjectionContext(() => {
            const typed = store as unknown as InstanceType<typeof StalkerStore>;
            positions = createStalkerCatalogPositions(typed);
            filter = createStalkerCatalogWatchFilter(typed, positions);
        });
        await flush();
    });

    it('filters completed movies, retaining started/unknown movies and both VOD-series shapes', async () => {
        const items: StalkerVodSource[] = [
            { id: 1 },
            { id: 2 },
            { id: 3 },
            { id: 4, is_series: '1' },
            { id: 5, series: [1, 2] },
            {},
            { id: '' },
            { id: 'abc' },
        ];
        read.mockResolvedValue([
            position(1, 90),
            position(2, 40),
            position(4),
            position(5),
        ]);
        await positions.refresh('a');
        store.getPaginatedContent.set(items);
        expect(filter.enabled()).toBe(false);
        expect(filter.items()).toBe(items);
        filter.setEnabled(true);
        expect(filter.items()).toEqual(items.slice(1));
        filter.setEnabled(false);
        expect(filter.items()).toBe(items);
        expect(store.nextPage).not.toHaveBeenCalled();
    });

    it.each([89, 90, 100])(
        'uses the existing watched threshold at %s percent',
        async (seconds) => {
            read.mockResolvedValue([position(1, seconds)]);
            await positions.refresh('a');
            filter.setEnabled(true);
            expect(filter.items()).toHaveLength(seconds >= 90 ? 0 : 1);
        }
    );

    it('does not confuse a completed movie with progress of a series sharing its provider ID', async () => {
        read.mockResolvedValue([
            position(1),
            { ...position(100), contentType: 'episode', seriesXtreamId: 1 },
        ]);
        await positions.refresh('a');
        filter.setEnabled(true);
        expect(filter.items()).toEqual([]);
        expect(
            positions.getItemProgress({ id: 1, is_series: true }).watchState
        ).toBe('in-progress');
    });

    it('keeps a movie without a known duration', async () => {
        read.mockResolvedValue([
            { ...position(1), durationSeconds: undefined },
        ]);
        await positions.refresh('a');
        filter.setEnabled(true);
        expect(filter.items()).toHaveLength(1);
    });

    it('passes hidden pages, pauses at the budget and resumes explicitly to a visible movie', async () => {
        read.mockResolvedValue(
            Array.from({ length: 20 }, (_, i) => position(i + 1))
        );
        await positions.refresh('a');
        filter.setEnabled(true);
        await flush();
        filter.loadMore();
        await flush();
        filter.loadMore();
        expect(store.nextPage).toHaveBeenCalledTimes(1);
        for (let i = 0; i < STALKER_HIDDEN_PAGE_BUDGET; i++)
            await finishPage([{ id: i + 2 }]);
        expect(store.nextPage).toHaveBeenCalledTimes(
            STALKER_HIDDEN_PAGE_BUDGET
        );
        expect(filter.paused()).toBe(true);
        expect(filter.scanning()).toBe(false);
        expect(store.hasMoreContent()).toBe(true);
        filter.loadMore();
        expect(store.nextPage).toHaveBeenCalledTimes(
            STALKER_HIDDEN_PAGE_BUDGET
        );
        filter.continueLoading();
        await flush();
        await finishPage([{ id: 99 }]);
        expect(filter.items()).toEqual([{ id: 99 }]);
        expect(filter.paused()).toBe(false);
        expect(filter.scanning()).toBe(false);
        expect(filter.resumeVersion()).toBe(1);
    });

    it('offers manual continuation when sparse visible additions trip the render-height guard', async () => {
        filter.setEnabled(true);
        await flush();
        filter.loadMore();
        await flush();
        await finishPage([{ id: 2 }]);
        expect(filter.paused()).toBe(false);
        filter.pauseAutomaticLoading();
        expect(filter.paused()).toBe(true);
        expect(store.hasMoreContent()).toBe(true);
        filter.continueLoading();
        await flush();
        await finishPage([{ id: 3 }], false);
        expect(filter.items()).toEqual([{ id: 2 }, { id: 3 }]);
        expect(filter.resumeVersion()).toBe(1);
        expect(filter.paused()).toBe(false);
    });

    it('ignores repeated manual continuation while a page is loading or its scan is settling', async () => {
        filter.setEnabled(true);
        await flush();
        filter.loadMore();
        await flush();
        expect(filter.scanning()).toBe(true);
        expect(store.isPaginatedContentLoading()).toBe(true);

        filter.continueLoading();
        expect(store.nextPage).toHaveBeenCalledTimes(1);
        expect(filter.resumeVersion()).toBe(0);
        expect(filter.scanning()).toBe(true);

        // A completion can arrive before the scan effect consumes the page.
        store.isPaginatedContentLoading.set(false);
        filter.continueLoading();
        expect(store.nextPage).toHaveBeenCalledTimes(1);
        expect(filter.resumeVersion()).toBe(0);
        expect(filter.scanning()).toBe(true);

        await finishPage([{ id: 2 }], false);
        expect(filter.items()).toEqual([{ id: 2 }]);
        expect(filter.scanning()).toBe(false);
        expect(filter.paused()).toBe(false);
        expect(store.nextPage).toHaveBeenCalledTimes(1);
    });

    it('does not scan retained rows from the previous category before its replacement loads', async () => {
        store.page.set(3);
        filter.setEnabled(true);
        await flush();
        filter.pauseAutomaticLoading();
        expect(filter.paused()).toBe(true);

        // Category selection resets the page before its request replaces rows.
        store.selectedCategoryId.set('new-category');
        store.page.set(0);
        await flush();
        expect(store.nextPage).not.toHaveBeenCalled();
        expect(filter.scanning()).toBe(false);
    });

    it('starts a bounded scan when a delayed first page in another category is fully watched', async () => {
        store.getPaginatedContent.set([{ id: 2 }]);
        filter.setEnabled(true);
        await flush();
        store.selectedCategoryId.set('new-category');
        store.getPaginatedContent.set([]);
        store.isPaginatedContentLoading.set(true);
        await flush();
        expect(filter.enabled()).toBe(true);
        expect(store.nextPage).not.toHaveBeenCalled();

        store.getPaginatedContent.set([{ id: 1 }]);
        store.isPaginatedContentLoading.set(false);
        await flush();
        expect(store.nextPage).toHaveBeenCalledTimes(1);
        expect(filter.scanning()).toBe(true);
        await finishPage([{ id: 2 }], false);
        expect(filter.items()).toEqual([{ id: 2 }]);
        expect(filter.scanning()).toBe(false);
        expect(store.nextPage).toHaveBeenCalledTimes(1);
    });

    it('stops a scan at source exhaustion, including an empty/repeated raw page', async () => {
        filter.setEnabled(true);
        await flush();
        filter.loadMore();
        await flush();
        await finishPage([], false);
        expect(filter.scanning()).toBe(false);
        expect(filter.paused()).toBe(false);
        expect(store.nextPage).toHaveBeenCalledTimes(1);
    });

    it('does not skip a failed page or continue scanning while details are open', async () => {
        filter.setEnabled(true);
        await flush();
        filter.loadMore();
        await flush();
        store.hasContentAppendError.set(true);
        store.isPaginatedContentLoading.set(false);
        await flush();
        filter.loadMore();
        expect(store.page()).toBe(1);
        expect(filter.scanning()).toBe(false);
        store.hasContentAppendError.set(false);
        store.selectedItem.set({ id: 1 });
        filter.continueLoading();
        expect(store.page()).toBe(1);
    });

    it.each(['category', 'search', 'filter', 'portal'])(
        'cancels continuation when %s changes',
        async (change) => {
            filter.setEnabled(true);
            await flush();
            filter.loadMore();
            await flush();
            if (change === 'category') store.selectedCategoryId.set('2');
            if (change === 'search') store.searchPhrase.set('new');
            if (change === 'filter') filter.setEnabled(false);
            if (change === 'portal') store.currentPlaylist.set({ _id: 'b' });
            await flush();
            await finishPage([{ id: 1 }]);
            expect(store.nextPage).toHaveBeenCalledTimes(1);
            expect(filter.scanning()).toBe(false);
        }
    );

    it('preserves the preference across category/search changes but not portal changes', async () => {
        filter.setEnabled(true);
        store.selectedCategoryId.set('other');
        store.searchPhrase.set('movie');
        await flush();
        expect(filter.enabled()).toBe(true);
        store.selectedContentType.set('series');
        expect(filter.enabled()).toBe(false);
        store.selectedContentType.set('vod');
        expect(filter.enabled()).toBe(true);
        store.currentPlaylist.set({ _id: 'b' });
        expect(filter.enabled()).toBe(false);
        await flush();
        store.currentPlaylist.set({ _id: 'a' });
        await flush();
        expect(filter.enabled()).toBe(false);
    });

    it('keeps filtering with the previous snapshot on refresh failure and supports retry', async () => {
        filter.setEnabled(true);
        read.mockRejectedValueOnce(new Error('offline'));
        await expect(positions.refresh('a')).rejects.toThrow('offline');
        expect(filter.loadState()).toBe('error');
        expect(filter.hasSnapshot()).toBe(true);
        expect(filter.items()).toEqual([]);
        read.mockResolvedValue([]);
        filter.retryPositions();
        await flush();
        expect(filter.items()).toEqual([{ id: 1 }]);
        expect(filter.loadState()).toBe('ready');
    });

    it('disables initial activation after a failed read instead of treating it as empty history', async () => {
        read.mockRejectedValueOnce(new Error('unavailable'));
        store.currentPlaylist.set({ _id: 'b' });
        await flush();
        expect(filter.hasSnapshot()).toBe(false);
        expect(filter.loadState()).toBe('error');
        filter.setEnabled(true);
        expect(filter.enabled()).toBe(false);
        filter.retryPositions();
        await flush();
        expect(filter.hasSnapshot()).toBe(true);
    });

    it('does not apply an old portal read after switching to another portal or no portal', async () => {
        const delayed = deferred<PlaybackPositionData[]>();
        read.mockReturnValueOnce(delayed.promise);
        const refresh = positions.refresh('a');
        store.currentPlaylist.set(undefined);
        await flush();
        delayed.resolve([position(1)]);
        await refresh;
        expect(positions.getItemProgress({ id: 1 }).watchState).toBe(
            'unwatched'
        );
        read.mockResolvedValue([]);
        store.currentPlaylist.set({ _id: 'b' });
        await flush();
        expect(positions.getItemProgress({ id: 1 }).watchState).toBe(
            'unwatched'
        );
    });

    it('does not read or replace the snapshot when asked to refresh an inactive portal', async () => {
        await positions.refresh('b');
        expect(read).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledWith('a');
        expect(positions.loadState()).toBe('ready');
        expect(positions.hasSnapshot()).toBe(true);
        expect(positions.getItemProgress({ id: 1 }).watchState).toBe('watched');
    });

    it.each(['resolve', 'reject'] as const)(
        'ignores new reads, inline writes and an in-flight read that %ss after destruction',
        async (outcome) => {
            const delayed = deferred<PlaybackPositionData[]>();
            read.mockReturnValueOnce(delayed.promise);
            const refresh = positions.refresh('a');
            TestBed.resetTestingModule();
            expect(unsubscribe).toHaveBeenCalledTimes(1);

            await positions.refresh('a');
            expect(read).toHaveBeenCalledTimes(2);
            positions.applyPosition(position(2));
            if (outcome === 'resolve') {
                delayed.resolve([position(2)]);
                await refresh;
            } else {
                delayed.reject(new Error('late read failure'));
                await expect(refresh).rejects.toThrow('late read failure');
                expect(positions.loadState()).not.toBe('error');
            }
            expect(positions.getItemProgress({ id: 1 }).watchState).toBe(
                'watched'
            );
            expect(positions.getItemProgress({ id: 2 }).watchState).toBe(
                'unwatched'
            );
            expect(write).not.toHaveBeenCalled();
        }
    );

    it('keeps live progress through a failed runtime save and an older snapshot, then accepts further updates', async () => {
        store.getPaginatedContent.set([{ id: 2 }]);
        filter.setEnabled(true);
        await flush();
        expect(filter.items()).toEqual([{ id: 2 }]);
        const delayed = deferred<PlaybackPositionData[]>();
        read.mockReturnValueOnce(delayed.promise);
        const refresh = positions.refresh('a');
        write.mockRejectedValueOnce(new Error('storage unavailable'));

        runtimeUpdate(position(2));
        await flush();
        expect(write).toHaveBeenCalledWith('a', position(2));
        expect(filter.items()).toEqual([]);
        delayed.resolve([]);
        await refresh;
        expect(filter.loadState()).toBe('ready');
        expect(filter.items()).toEqual([]);
        expect(positions.getItemProgress({ id: 2 }).watchState).toBe('watched');

        runtimeUpdate(position(2, 40));
        await flush();
        expect(write).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenLastCalledWith('a', position(2, 40));
        expect(positions.getItemProgress({ id: 2 }).watchState).toBe(
            'in-progress'
        );
        expect(filter.items()).toEqual([{ id: 2 }]);
    });

    it('retains runtime progress newer than an in-flight read and ignores another portal', async () => {
        filter.setEnabled(true);
        const delayed = deferred<PlaybackPositionData[]>();
        read.mockReturnValueOnce(delayed.promise);
        const refresh = positions.refresh('a');
        runtimeUpdate(position(2));
        runtimeUpdate({ ...position(3), playlistId: 'b' });
        delayed.resolve([]);
        await refresh;
        expect(positions.getItemProgress({ id: 2 }).watchState).toBe('watched');
        expect(positions.getItemProgress({ id: 3 }).watchState).toBe(
            'unwatched'
        );
        expect(write).toHaveBeenCalledTimes(1);
        TestBed.resetTestingModule();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('uses only the latest overlapping refresh and does not refetch on metadata-only updates', async () => {
        const first = deferred<PlaybackPositionData[]>();
        read.mockReturnValueOnce(first.promise).mockResolvedValueOnce([]);
        const old = positions.refresh('a');
        await positions.refresh('a');
        first.resolve([position(1)]);
        await old;
        expect(positions.getItemProgress({ id: 1 }).watchState).toBe(
            'unwatched'
        );
        const calls = read.mock.calls.length;
        store.currentPlaylist.set({ _id: 'a' });
        await flush();
        expect(read).toHaveBeenCalledTimes(calls);
    });
    it('filters completed inline playback after detail return without an external event or a new snapshot', async () => {
        read.mockResolvedValue([]);
        await positions.refresh('a');
        filter.setEnabled(true);
        await flush();
        store.selectedItem.set({ id: 1 });
        const delayed = deferred<PlaybackPositionData[]>();
        read.mockReturnValueOnce(delayed.promise);
        const refresh = positions.refresh('a');
        positions.applyPosition(position(1, 95));
        delayed.resolve([]);
        await refresh;
        expect(store.selectedItem()).toEqual({ id: 1 });
        store.selectedItem.set(null);
        expect(filter.items()).toEqual([]);
        expect(write).not.toHaveBeenCalled();
        positions.applyPosition({ ...position(2), playlistId: 'other' });
        expect(positions.getItemProgress({ id: 2 }).watchState).toBe(
            'unwatched'
        );
    });
});
