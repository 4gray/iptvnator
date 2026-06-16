import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { withSelection } from './with-selection.feature';

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
        localStorage.clear();

        TestBed.configureTestingModule({
            providers: [TestSelectionStore],
        });

        store = TestBed.inject(TestSelectionStore);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('keeps the current page when the category search term is unchanged', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);
        store.setLimit(2);
        store.setPage(1);

        store.setCategorySearchTerm('');

        expect(store.page()).toBe(1);
        expect(store.getPaginatedContent().map((item) => item.title)).toEqual([
            'Third',
            'Fourth',
        ]);
    });

    it('resets the current page when the category search term changes', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);
        store.setLimit(2);
        store.setPage(1);

        store.setCategorySearchTerm('first');

        expect(store.page()).toBe(0);
        expect(store.getPaginatedContent().map((item) => item.title)).toEqual([
            'First',
        ]);
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
