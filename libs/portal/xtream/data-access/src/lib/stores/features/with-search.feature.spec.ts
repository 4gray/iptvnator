import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withState } from '@ngrx/signals';
import { XTREAM_DATA_SOURCE } from '../../data-sources/xtream-data-source.interface';
import { EMPTY_XTREAM_LANGUAGE_FILTER } from '../../utils/language-filter.util';
import { XtreamVideoQualityFilterValue } from '../../utils/video-quality-filter.util';
import { withSearch } from './with-search.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({ error: jest.fn() }),
}));

const TestSearchStore = signalStore(
    withState({
        languageFilter: EMPTY_XTREAM_LANGUAGE_FILTER,
        languageFilterActive: false,
        metadataFiltersReady: true,
        playlistId: 'playlist-1',
        videoQualityFilter: 'all' as XtreamVideoQualityFilterValue,
        videoQualityFilterActive: false,
    }),
    withSearch()
);

describe('withSearch', () => {
    let store: InstanceType<typeof TestSearchStore>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                TestSearchStore,
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: {
                        searchContent: jest.fn().mockResolvedValue([]),
                    },
                },
            ],
        });

        store = TestBed.inject(TestSearchStore);
    });

    it('uses the shared metadata readiness gate before filtering search results', () => {
        patchState(store, {
            searchResults: [
                {
                    id: 1,
                    category_id: 10,
                    title: 'English UHD',
                    rating: '0',
                    added: '0',
                    poster_url: '',
                    xtream_id: 101,
                    type: 'movie',
                    audioLanguages: ['en'],
                    mediaMetadata: {
                        available: true,
                        height: 2160,
                        audioLanguages: ['en'],
                        audioCodecs: [],
                        subtitleLanguages: [],
                        subtitleCodecs: [],
                    },
                },
                {
                    id: 2,
                    category_id: 10,
                    title: 'Italian SD',
                    rating: '0',
                    added: '0',
                    poster_url: '',
                    xtream_id: 102,
                    type: 'movie',
                    audioLanguages: ['it'],
                },
            ],
            languageFilter: {
                audioInclude: ['en'],
                audioExclude: [],
                subtitleInclude: [],
                subtitleExclude: [],
            },
            languageFilterActive: true,
            metadataFiltersReady: false,
            videoQualityFilter: '2160p',
            videoQualityFilterActive: true,
        });

        expect(
            store.filteredSearchResults().map((item) => item.xtream_id)
        ).toEqual([101, 102]);

        patchState(store, { metadataFiltersReady: true });

        expect(
            store.filteredSearchResults().map((item) => item.xtream_id)
        ).toEqual([101]);
    });
});
