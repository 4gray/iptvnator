import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import {
    CATALOG_INITIAL_WINDOW,
    CATALOG_WINDOW_CHUNK,
    withSelection,
} from './with-selection.feature';

/** A category larger than two render windows, for window-growth tests. */
const BULK_CATEGORY_SIZE = CATALOG_INITIAL_WINDOW + CATALOG_WINDOW_CHUNK + 20;
const bulkVodStreams = Array.from({ length: BULK_CATEGORY_SIZE }, (_, i) => ({
    xtream_id: 1000 + i,
    category_id: '90',
    title: `Bulk ${i + 1}`,
    added: String(1000 - i),
}));

const TestSelectionStore = signalStore(
    withState({
        contentLoadStateByType: {
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        },
        liveCategories: [
            {
                id: 50,
                category_id: '50',
                category_name: 'News',
                type: 'live',
            },
            {
                id: 60,
                category_id: '60',
                category_name: 'Sports',
                type: 'live',
            },
        ],
        liveStreams: [
            {
                xtream_id: 201,
                category_id: '50',
                title: 'World News',
            },
            {
                xtream_id: 202,
                category_id: '60',
                title: 'World Sports',
            },
            {
                xtream_id: 203,
                category_id: '60',
                title: 'Match Day',
            },
        ],
        vodCategories: [
            {
                id: 10,
                category_id: '10',
                category_name: 'Movies',
                type: 'vod',
            },
            {
                id: 20,
                category_id: '20',
                category_name: 'Documentaries',
                type: 'vod',
            },
            {
                id: 90,
                category_id: '90',
                category_name: 'Bulk',
                type: 'vod',
            },
        ],
        vodStreams: [
            {
                xtream_id: 1,
                category_id: '10',
                title: 'First',
                added: '4',
            },
            {
                xtream_id: 2,
                category_id: '10',
                title: 'Second',
                added: '3',
            },
            {
                xtream_id: 3,
                category_id: '10',
                title: 'Third',
                added: '2',
            },
            {
                xtream_id: 4,
                category_id: '10',
                title: 'Fourth',
                added: '1',
            },
            {
                xtream_id: 5,
                category_id: '20',
                title: 'First Contact',
                added: '5',
            },
            {
                xtream_id: 6,
                category_id: '20',
                title: 'Cosmos',
                added: '6',
            },
            ...bulkVodStreams,
        ],
        serialCategories: [
            {
                id: 30,
                category_id: '30',
                category_name: 'Sci-Fi',
                type: 'series',
            },
            {
                id: 40,
                category_id: '40',
                category_name: 'Drama',
                type: 'series',
            },
        ],
        serialStreams: [
            {
                xtream_id: 101,
                category_id: '30',
                title: 'Stargate SG-1',
                last_modified: '10',
            },
            {
                xtream_id: 102,
                category_id: '30',
                title: 'The Expanse',
                last_modified: '9',
            },
            {
                xtream_id: 103,
                category_id: '40',
                title: 'Stargate Atlantis',
                last_modified: '8',
            },
            {
                xtream_id: 104,
                category_id: '40',
                title: 'The Wire',
                last_modified: '7',
            },
        ],
    }),
    withSelection()
);

describe('withSelection', () => {
    let store: InstanceType<typeof TestSelectionStore>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [TestSelectionStore],
        });

        store = TestBed.inject(TestSelectionStore);
    });

    it('reveals the first window and grows it with loadMoreContent', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(90);

        expect(store.getPaginatedContent().length).toBe(
            CATALOG_INITIAL_WINDOW
        );
        expect(store.hasMoreContent()).toBe(true);

        store.loadMoreContent();
        expect(store.getPaginatedContent().length).toBe(
            CATALOG_INITIAL_WINDOW + CATALOG_WINDOW_CHUNK
        );

        store.loadMoreContent();
        expect(store.getPaginatedContent().length).toBe(BULK_CATEGORY_SIZE);
        expect(store.hasMoreContent()).toBe(false);

        // No-op once the window covers everything.
        const coveredCount = store.visibleCount();
        store.loadMoreContent();
        expect(store.visibleCount()).toBe(coveredCount);
    });

    it('keeps the render window when the category search term is unchanged', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(90);
        store.loadMoreContent();

        store.setCategorySearchTerm('');

        expect(store.visibleCount()).toBe(
            CATALOG_INITIAL_WINDOW + CATALOG_WINDOW_CHUNK
        );
    });

    it('resets the render window when the category search term changes', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(90);
        store.loadMoreContent();

        store.setCategorySearchTerm('bulk');

        expect(store.visibleCount()).toBe(CATALOG_INITIAL_WINDOW);
        expect(store.getPaginatedContent().length).toBe(
            CATALOG_INITIAL_WINDOW
        );
    });

    it('resets the render window when the category changes', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(90);
        store.loadMoreContent();

        store.setSelectedCategory(10);

        expect(store.visibleCount()).toBe(CATALOG_INITIAL_WINDOW);
    });

    it('keeps per-selection snapshots so a tab detour cannot overwrite them', () => {
        // Regression: VOD (scrolled) → Series → back to VOD. The series view
        // saves its own spot on destroy; with a single slot that save used to
        // replace the VOD snapshot and the round trip lost the position.
        store.setSelectedContentType('vod');
        store.setSelectedCategory(90);
        store.loadMoreContent();
        store.saveCatalogScrollState(1234);

        store.setSelectedContentType('series');
        store.saveCatalogScrollState(0);

        store.setSelectedContentType('vod');
        store.setSelectedCategory(90);
        expect(store.consumeCatalogScrollState()).toBe(1234);
        expect(store.visibleCount()).toBe(
            CATALOG_INITIAL_WINDOW + CATALOG_WINDOW_CHUNK
        );

        // The series snapshot survived too, under its own identity.
        store.setSelectedContentType('series');
        expect(store.consumeCatalogScrollState()).toBe(0);
    });

    it('restores a saved scroll state only for the matching selection', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(90);
        store.loadMoreContent();
        store.saveCatalogScrollState(1234);

        // A detour to another category must not consume the slot.
        store.setSelectedCategory(10);
        expect(store.consumeCatalogScrollState()).toBeNull();

        // Returning to the saved selection restores window + offset once.
        store.setSelectedCategory(90);
        expect(store.consumeCatalogScrollState()).toBe(1234);
        expect(store.visibleCount()).toBe(
            CATALOG_INITIAL_WINDOW + CATALOG_WINDOW_CHUNK
        );
        expect(store.consumeCatalogScrollState()).toBeNull();
    });

    it('filters all VOD items when no category is selected', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(null);

        store.setCategorySearchTerm('first');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['First Contact', 'First']);
    });

    it('filters all series items across categories when no category is selected', () => {
        store.setSelectedContentType('series');
        store.setSelectedCategory(null);

        store.setCategorySearchTerm('stargate');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['Stargate SG-1', 'Stargate Atlantis']);
    });

    it('keeps VOD category route search scoped to the selected category', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);

        store.setCategorySearchTerm('first');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['First']);
    });

    it('keeps series category route search scoped to the selected category', () => {
        store.setSelectedContentType('series');
        store.setSelectedCategory(30);

        store.setCategorySearchTerm('stargate');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['Stargate SG-1']);
    });

    it('keeps live category route search scoped to the selected category', () => {
        store.setSelectedContentType('live');
        store.setSelectedCategory(50);

        store.setCategorySearchTerm('world');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['World News']);
    });

    it('filters all live items across categories when no category is selected', () => {
        store.setSelectedContentType('live');
        store.setSelectedCategory(null);

        store.setCategorySearchTerm('world');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['World News', 'World Sports']);
    });

    it('clears the rating filter when the category changes', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);
        store.setMinRating(7);
        expect(store.minRating()).toBe(7);

        store.setSelectedCategory(20);

        expect(store.minRating()).toBeNull();
    });

    it('keeps the rating filter when the same category is re-selected', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);
        store.setMinRating(7);

        store.setSelectedCategory(10);

        expect(store.minRating()).toBe(7);
    });
});
