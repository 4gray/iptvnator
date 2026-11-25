import { TestBed } from '@angular/core/testing';
import {
    ParentalLockService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { PwaXtreamDataSource } from '../../data-sources/pwa-xtream-data-source';
import { XTREAM_DATA_SOURCE } from '../../data-sources/xtream-data-source.interface';
import {
    createContentTestProviders,
    createContentTestStore,
    createPendingRestoreServiceMock,
    TEST_PLAYLIST,
} from './with-content.feature.spec-helpers';

const TestStore = createContentTestStore(async () => 'active');

afterEach(() => localStorage.clear());

it('publishes the restored browser visibility on the first catalog read', async () => {
    const pending = createPendingRestoreServiceMock();
    pending.getOrThrow.mockReturnValue({
        favoritesRestoreId: 'synthetic-restore',
        favorites: [],
        recentlyViewed: [],
        playbackPositions: [],
        hiddenCategories: [{ categoryType: 'movies', xtreamId: 7 }],
    });
    const categories = jest.fn(async (_credentials, type) =>
        type === 'vod'
            ? [
                  { category_id: '7', category_name: 'Hidden genre' },
                  { category_id: '8', category_name: 'Visible genre' },
              ]
            : []
    );
    const streams = jest.fn(async (_credentials, type) =>
        type === 'movie'
            ? [
                  { stream_id: 11, category_id: '7', name: 'Hidden title' },
                  { stream_id: 12, category_id: '8', name: 'Visible title' },
              ]
            : []
    );
    TestBed.configureTestingModule({
        providers: [
            ...createContentTestProviders(TestStore, {
                dataSource: null,
                pendingRestoreService: pending,
                xtreamApiService: {
                    getCategories: categories,
                    getStreams: streams,
                },
                databaseService: { createOperationId: jest.fn((type) => type) },
                dataService: {},
            }),
            { provide: XTREAM_DATA_SOURCE, useExisting: PwaXtreamDataSource },
            {
                provide: RuntimeCapabilitiesService,
                useValue: { supportsXtreamSqliteDataSource: false },
            },
            { provide: ParentalLockService, useValue: { active: () => false } },
        ],
    });

    const store = TestBed.inject(TestStore);
    await store.initializeContent();

    expect(store.isContentInitialized()).toBe(true);
    expect(store.vodCategories().map((row) => row.category_id)).toEqual(['8']);
    expect(store.vodStreams()).toEqual([
        expect.objectContaining({ xtream_id: 12 }),
    ]);
    expect(pending.getOrThrow(TEST_PLAYLIST.id)).toBeNull();
});
