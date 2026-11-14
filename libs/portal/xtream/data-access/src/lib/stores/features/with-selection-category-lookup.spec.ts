import type { PlaybackPositionsState } from './with-playback-positions.feature';
import { TestBed } from '@angular/core/testing';
import { signalStore, withState } from '@ngrx/signals';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { withSelection } from './with-selection.feature';

/**
 * PWA categories are raw provider rows: ids are per content type and carry
 * only `category_id`, so a VOD, a live and a series category can all be "5".
 */
const CollidingCategoryStore = signalStore(
    withState({
        contentLoadStateByType: {
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        },
        vodCategories: [{ category_id: '5', category_name: 'Synthetic Films' }],
        liveCategories: [
            { category_id: '5', category_name: 'Synthetic News' },
            { category_id: '9', category_name: 'Synthetic Sports' },
        ],
        serialCategories: [
            { category_id: '5', category_name: 'Synthetic Dramas' },
        ],
        vodStreams: [],
        liveStreams: [],
        serialStreams: [],
    }),
    withState<
        PlaybackPositionsState & { currentPlaylist: { id: string } | null }
    >({
        playbackPositions: new Map(),
        seriesPositions: new Map(),
        positionsPlaylistId: 'a',
        positionsLoadState: 'ready',
        currentPlaylist: { id: 'a' },
    }),
    withSelection()
);

describe('withSelection getSelectedCategory', () => {
    let store: InstanceType<typeof CollidingCategoryStore>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                CollidingCategoryStore,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        isElectron: false,
                        supportsXtreamSqliteDataSource: false,
                    },
                },
            ],
        });
        store = TestBed.inject(CollidingCategoryStore);
    });

    it.each([
        ['live', 'Synthetic News'],
        ['vod', 'Synthetic Films'],
        ['series', 'Synthetic Dramas'],
    ] as const)(
        'names the %s category when another type shares its id',
        (type, name) => {
            store.setSelectedContentType(type);
            store.setSelectedCategory(5);

            expect(store.getSelectedCategory()?.category_name).toBe(name);
        }
    );

    it("still finds a category that is only in another type's list", () => {
        store.setSelectedContentType('vod');
        store.setSelectedCategory(9);

        expect(store.getSelectedCategory()?.category_name).toBe(
            'Synthetic Sports'
        );
    });
});
