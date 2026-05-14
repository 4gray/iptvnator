import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withState } from '@ngrx/signals';
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
                rating: 5,
                imdbRating: 5,
            },
            {
                xtream_id: 2,
                category_id: '10',
                title: 'Second',
                added: '3',
                rating: '9.1',
                imdbRating: 9.1,
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
                rating_imdb: '7.5',
            },
            {
                xtream_id: 5,
                category_id: '20',
                title: 'First Contact',
                added: '5',
                info: {
                    rating: '8,6',
                },
                imdbRating: 8.6,
            },
            {
                xtream_id: 6,
                category_id: '20',
                title: 'Cosmos',
                added: '6',
                rating_5based: 4.8,
                imdbRating: 9.6,
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

    it('sorts VOD items by rating with unrated items last', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);
        store.setContentSortMode('rating-desc');

        expect(store.getPaginatedContent().map((item) => item.title)).toEqual([
            'Second',
            'Fourth',
            'First',
            'Third',
        ]);
    });

    it('uses resolved and provider IMDb ratings when sorting all VOD items', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(null);
        store.setContentSortMode('rating-desc');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual([
            'Cosmos',
            'Second',
            'First Contact',
            'Fourth',
            'First',
            'Third',
        ]);
    });

    it('keeps non-IMDb provider ratings unrated for IMDb sorting', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);
        store.setContentSortMode('rating-desc');

        expect(store.getPaginatedContent().map((item) => item.title)).toEqual([
            'Second',
            'Fourth',
            'First',
            'Third',
        ]);
    });

    it('deduplicates VOD category counts within each category', () => {
        patchState(store, {
            vodStreams: [
                {
                    xtream_id: 11,
                    category_id: '10',
                    title: 'Shared Movie 1080p',
                    imdb_id: 'tt1234567',
                    container_extension: 'mp4',
                },
                {
                    xtream_id: 12,
                    category_id: '10',
                    title: 'Shared Movie 720p',
                    imdb_id: 'tt1234567',
                    container_extension: 'mp4',
                },
                {
                    xtream_id: 21,
                    category_id: '20',
                    title: 'Shared Movie 2160p UHD',
                    imdb_id: 'tt1234567',
                    container_extension: 'mkv',
                },
            ],
        });
        store.setSelectedContentType('vod');

        const counts = store.getCategoryItemCounts();

        expect(counts.get(10)).toBe(1);
        expect(counts.get(20)).toBe(1);
    });

    it('filters all series items across categories when no category is selected', () => {
        store.setSelectedContentType('series');
        store.setSelectedCategory(null);

        store.setCategorySearchTerm('stargate');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['Stargate SG-1', 'Stargate Atlantis']);
    });

    it('deduplicates series by IMDb ID and searches both localized and original titles', () => {
        patchState(store, {
            serialStreams: [
                {
                    series_id: 301,
                    category_id: '30',
                    title: 'La Casa di Carta 1080p',
                    imdb_id: 'tt6468322',
                    imdbMatchedTitle: 'Money Heist',
                    last_modified: '10',
                    poster_url: 'https://image.tmdb.org/t/p/w500/money.jpg',
                },
                {
                    series_id: 302,
                    category_id: '30',
                    title: 'Money Heist 2160p UHD',
                    imdb_id: 'tt6468322',
                    imdbMatchedTitle: 'Money Heist',
                    last_modified: '11',
                    poster_url: 'https://image.tmdb.org/t/p/w500/money.jpg',
                },
                {
                    series_id: 303,
                    category_id: '30',
                    title: 'The Wire',
                    imdb_id: 'tt0306414',
                    last_modified: '12',
                },
            ],
        });
        store.setSelectedContentType('series');
        store.setSelectedCategory(30);

        store.setCategorySearchTerm('money heist');

        const englishResults = store.selectItemsFromSelectedCategory();
        expect(englishResults).toHaveLength(1);
        expect(englishResults[0].series_id).toBe(302);
        expect(englishResults[0].duplicateCount).toBe(2);

        store.setCategorySearchTerm('casa carta');

        const italianResults = store.selectItemsFromSelectedCategory();
        expect(italianResults).toHaveLength(1);
        expect(italianResults[0].series_id).toBe(302);
        expect(italianResults[0].duplicateCount).toBe(2);
    });

    it('keeps VOD category route search scoped to the selected category', () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);

        store.setCategorySearchTerm('first');

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['First']);
    });

    it('deduplicates VOD search results before rendering category cards', () => {
        patchState(store, {
            vodStreams: [
                {
                    xtream_id: 11,
                    stream_id: 11,
                    category_id: '10',
                    title: 'IT - Harry Potter E La Camera Dei Segreti 1080p',
                    poster_url: 'https://image.tmdb.org/t/p/w500/chamber.jpg',
                    container_extension: 'mp4',
                    added: '100',
                },
                {
                    xtream_id: 12,
                    stream_id: 12,
                    category_id: '10',
                    title: 'IT -uhd Harry Potter e la camera dei segreti',
                    poster_url:
                        'https://image.tmdb.org/t/p/w500/chamber.jpg?cache=1',
                    container_extension: 'mkv',
                    added: '90',
                },
                {
                    xtream_id: 13,
                    stream_id: 13,
                    category_id: '20',
                    title: 'Harry Potter E La Camera Dei Segreti 2160p',
                    poster_url: 'https://image.tmdb.org/t/p/w500/chamber.jpg',
                    container_extension: 'mkv',
                    added: '80',
                },
            ],
        });
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);

        store.setCategorySearchTerm('harry potter e la camera');

        const results = store.selectItemsFromSelectedCategory();

        expect(results).toHaveLength(1);
        expect(results[0].xtream_id).toBe(12);
        expect(results[0].duplicateCount).toBe(2);
        expect(results[0].duplicateDefaultVariantId).toBe('12');
    });

    it('matches VOD category route search against IMDb titles on grouped variants', () => {
        patchState(store, {
            vodStreams: [
                {
                    xtream_id: 21,
                    stream_id: 21,
                    category_id: '10',
                    title: 'IT - Harry Potter E La Camera Dei Segreti 1080p',
                    imdbMatchedTitle: 'Harry Potter and the Chamber of Secrets',
                    imdbMatchedYear: 2002,
                    poster_url: 'https://image.tmdb.org/t/p/w500/chamber.jpg',
                    container_extension: 'mp4',
                    added: '100',
                },
                {
                    xtream_id: 22,
                    stream_id: 22,
                    category_id: '10',
                    title: 'IT - Harry Potter E La Camera Dei Segreti 2160p UHD',
                    imdbMatchedTitle: 'Harry Potter and the Chamber of Secrets',
                    imdbMatchedYear: 2002,
                    poster_url: 'https://image.tmdb.org/t/p/w500/chamber.jpg',
                    container_extension: 'mkv',
                    added: '90',
                },
            ],
        });
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);

        store.setCategorySearchTerm('harry potter chamber secrets');

        const results = store.selectItemsFromSelectedCategory();

        expect(results).toHaveLength(1);
        expect(results[0].xtream_id).toBe(22);
        expect(results[0].duplicateCount).toBe(2);
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

    it('filters grouped VOD by required audio language across variants', () => {
        patchState(store, {
            vodStreams: [
                {
                    xtream_id: 11,
                    stream_id: 11,
                    category_id: '10',
                    title: 'Shared Movie ITA 1080p',
                    imdb_id: 'tt1234567',
                    audioLanguages: ['ITA'],
                },
                {
                    xtream_id: 12,
                    stream_id: 12,
                    category_id: '10',
                    title: 'Shared Movie ENG 2160p',
                    imdb_id: 'tt1234567',
                    audioLanguages: ['ENG'],
                },
                {
                    xtream_id: 13,
                    stream_id: 13,
                    category_id: '10',
                    title: 'Other Movie ITA',
                    audioLanguages: ['ITA'],
                },
            ],
        });
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);

        store.toggleLanguageFilterOption('audioInclude', 'en', true);

        const results = store.selectItemsFromSelectedCategory();
        expect(results).toHaveLength(1);
        expect(results[0].duplicateCount).toBe(2);
    });

    it('exposes search matches excluded by active language filters', () => {
        patchState(store, {
            vodStreams: [
                {
                    xtream_id: 11,
                    stream_id: 11,
                    category_id: '10',
                    title: 'Shared Movie ITA 1080p',
                    imdb_id: 'tt1234567',
                    audioLanguages: ['ITA'],
                },
                {
                    xtream_id: 12,
                    stream_id: 12,
                    category_id: '10',
                    title: 'Other Movie ENG 2160p',
                    audioLanguages: ['ENG'],
                },
            ],
        });
        store.setSelectedContentType('vod');
        store.setSelectedCategory(null);
        store.setCategorySearchTerm('movie');

        store.toggleLanguageFilterOption('audioInclude', 'en', true);

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['Other Movie ENG 2160p']);
        expect(
            store
                .selectFilterExcludedItemsFromSelectedCategory()
                .map((item) => item.title)
        ).toEqual(['Shared Movie ITA 1080p']);

        store.resetLanguageFilter();
        expect(store.selectFilterExcludedItemsFromSelectedCategory()).toEqual(
            []
        );
    });

    it('applies audio exclusion to live channels and category counts', () => {
        patchState(store, {
            liveStreams: [
                {
                    xtream_id: 201,
                    category_id: '50',
                    title: 'World News ITA',
                    audioLanguages: ['ITA'],
                },
                {
                    xtream_id: 202,
                    category_id: '60',
                    title: 'World Sports ENG',
                    audioLanguages: ['ENG'],
                },
            ],
        });
        store.setSelectedContentType('live');
        store.setSelectedCategory(null);

        store.toggleLanguageFilterOption('audioExclude', 'it', true);

        expect(
            store.selectItemsFromSelectedCategory().map((item) => item.title)
        ).toEqual(['World Sports ENG']);
        expect(store.getCategoryItemCounts().get(50)).toBeUndefined();
        expect(store.getCategoryItemCounts().get(60)).toBe(1);
    });

    it('filters grouped VOD by selected video quality and updates category counts', () => {
        patchState(store, {
            vodStreams: [
                {
                    xtream_id: 11,
                    stream_id: 11,
                    category_id: '10',
                    title: 'Shared Movie 1080p',
                    imdb_id: 'tt1234567',
                },
                {
                    xtream_id: 12,
                    stream_id: 12,
                    category_id: '10',
                    title: 'Shared Movie 2160p UHD',
                    imdb_id: 'tt1234567',
                },
                {
                    xtream_id: 13,
                    stream_id: 13,
                    category_id: '10',
                    title: 'Other Movie 720p',
                },
                {
                    xtream_id: 21,
                    stream_id: 21,
                    category_id: '20',
                    title: 'Documentary 2160p',
                },
            ],
        });
        store.setSelectedContentType('vod');
        store.setSelectedCategory(10);

        store.setVideoQualityFilter('2160p');

        const results = store.selectItemsFromSelectedCategory();
        expect(results).toHaveLength(1);
        expect(results[0].duplicateCount).toBe(2);
        expect(store.getCategoryItemCounts().get(10)).toBe(1);
        expect(store.getCategoryItemCounts().get(20)).toBe(1);
        expect(store.videoQualityFilterOptions()).toEqual([
            { value: '2160p', label: '2160p+', count: 1 },
            { value: '1080p', label: '1080p', count: 1 },
            { value: '720p', label: '720p', count: 1 },
        ]);
    });

    it('filters grouped series by selected video quality', () => {
        patchState(store, {
            serialStreams: [
                {
                    series_id: 301,
                    category_id: '30',
                    title: 'Series 1080p',
                    imdb_id: 'tt7654321',
                    last_modified: '10',
                },
                {
                    series_id: 302,
                    category_id: '30',
                    title: 'Series 2160p UHD',
                    imdb_id: 'tt7654321',
                    last_modified: '11',
                },
                {
                    series_id: 303,
                    category_id: '30',
                    title: 'Other Series 720p',
                    last_modified: '9',
                },
            ],
        });
        store.setSelectedContentType('series');
        store.setSelectedCategory(30);

        store.setVideoQualityFilter('2160p');

        const results = store.selectItemsFromSelectedCategory();
        expect(results).toHaveLength(1);
        expect(results[0].series_id).toBe(302);
        expect(results[0].duplicateCount).toBe(2);

        store.resetVideoQualityFilter();
        expect(store.videoQualityFilter()).toBe('all');
        expect(store.selectItemsFromSelectedCategory()).toHaveLength(2);
    });
});
