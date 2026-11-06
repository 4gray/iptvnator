import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withState } from '@ngrx/signals';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { PlaybackPositionsState } from './with-playback-positions.feature';
import { withSelection } from './with-selection.feature';

const positions = new Map<string, PlaybackPositionData>();
const movies = Array.from({ length: 120 }, (_, i) => ({
    xtream_id: i + 1,
    category_id: '1',
    title: `Movie ${i + 1}`,
    rating: 8,
    added: String(120 - i),
}));
const TestStore = signalStore(
    { protectedState: false },
    withState({
        vodStreams: movies,
        vodCategories: [{ category_id: '1' }],
        serialStreams: [{ xtream_id: 120, category_id: '1' }],
        serialCategories: [{ category_id: '1' }],
    }),
    withState<PlaybackPositionsState & { currentPlaylist: { id: string } | null }>({
        currentPlaylist: { id: 'a' },
        playbackPositions: positions,
        seriesPositions: new Map(),
        positionsPlaylistId: 'a',
        positionsLoadState: 'ready',
    }),
    withSelection()
);
const watched = (id: number): PlaybackPositionData => ({
    playlistId: 'a',
    contentType: 'vod',
    contentXtreamId: id,
    positionSeconds: 1,
    durationSeconds: 1,
});

describe('movie catalog watch filter', () => {
    let store: InstanceType<typeof TestStore>;
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                TestStore,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: true },
                },
            ],
        });
        store = TestBed.inject(TestStore);
    });
    it('finds a matching last movie before slicing the first render window', () => {
        patchState(store, {
            playbackPositions: new Map([['vod_120', watched(120)]]),
        });
        store.setWatchStateFilter('watched');
        expect(store.getPaginatedContent().map((row) => row.xtream_id)).toEqual(
            [120]
        );
        expect(store.selectItemsFromSelectedCategory()).toHaveLength(1);
        expect(store.hasMoreContent()).toBe(false);
    });
    it('shares full filtered results across count and append without refiltering', () => {
        patchState(store, {
            playbackPositions: new Map(
                movies.map((row) => [
                    `vod_${row.xtream_id}`,
                    watched(row.xtream_id),
                ])
            ),
        });
        store.setWatchStateFilter('watched');
        const all = store.selectItemsFromSelectedCategory();
        expect(all).toHaveLength(120);
        expect(store.getPaginatedContent()).toHaveLength(50);
        store.loadMoreContent();
        expect(store.getPaginatedContent()).toHaveLength(100);
        expect(store.selectItemsFromSelectedCategory()).toBe(all);
        store.setWatchStateFilter('watched');
        expect(store.visibleCount()).toBe(100);
        store.loadMoreContent();
        expect(store.getPaginatedContent()).toHaveLength(120);
        expect(store.hasMoreContent()).toBe(false);
    });
    it('intersects query, category, rating and sort and retains status until leaving Movies', () => {
        patchState(store, {
            playbackPositions: new Map([
                ['vod_120', watched(120)],
                ['vod_12', watched(12)],
            ]),
        });
        store.setWatchStateFilter('watched');
        store.setSelectedCategory(1);
        store.setCategorySearchTerm('Movie 12');
        store.setMinRating(8);
        store.setContentSortMode('name-desc');
        expect(store.getPaginatedContent().map((row) => row.xtream_id)).toEqual(
            [120, 12]
        );
        store.setMinRating(9);
        expect(store.getPaginatedContent()).toEqual([]);
        store.setSelectedCategory(null);
        expect(store.watchStateFilter()).toBe('watched');
        expect(store.minRating()).toBeNull();
        expect(store.categorySearchTerm()).toBe('');
        store.setSelectedContentType('series');
        expect(store.watchStateFilter()).toBeNull();
        expect(store.getPaginatedContent()).toHaveLength(1);
        store.setWatchStateFilter('watched');
        expect(store.watchStateFilter()).toBeNull();
    });
    it('waits for the current owner to be ready and does not invent unwatched matches on errors', () => {
        store.setWatchStateFilter('unwatched');
        patchState(store, { positionsLoadState: 'loading' });
        expect(store.getPaginatedContent()).toEqual([]);
        expect(store.isPaginatedContentLoading()).toBe(true);
        patchState(store, { positionsLoadState: 'error' });
        expect(store.getPaginatedContent()).toEqual([]);
        expect(store.isPaginatedContentLoading()).toBe(false);
        patchState(store, {
            positionsLoadState: 'ready',
            positionsPlaylistId: 'b',
        });
        expect(store.getPaginatedContent()).toEqual([]);
        store.setWatchStateFilter(null);
        expect(store.getPaginatedContent()).toHaveLength(50);
    });
    it('keeps independent All movies snapshots for every status and clears them on source reset', () => {
        store.setWatchStateFilter('unwatched');
        store.loadMoreContent();
        store.saveCatalogScrollState(400);
        store.setWatchStateFilter(null);
        expect(store.consumeCatalogScrollState()).toBeNull();
        store.saveCatalogScrollState(100);
        store.setWatchStateFilter('unwatched');
        expect(store.consumeCatalogScrollState()).toBe(400);
        expect(store.visibleCount()).toBe(100);
        store.setWatchStateFilter(null);
        expect(store.consumeCatalogScrollState()).toBe(100);
        store.setWatchStateFilter('watched');
        store.resetSelection();
        expect(store.watchStateFilter()).toBeNull();
        expect(store.savedCatalogScrolls()).toEqual([]);
    });
});
