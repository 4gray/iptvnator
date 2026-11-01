import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import {
    createContentTestProviders,
    createContentTestStore,
    createPendingRestoreServiceMock,
    TEST_PLAYLIST,
} from './with-content.feature.spec-helpers';

const TestStore = createContentTestStore(async () => 'unavailable');

afterEach(() => localStorage.clear());

it.each([
    { selection: [] as 'live'[], status: 'unavailable' as const },
    { selection: ['live'] as 'live'[], status: 'unavailable' as const },
    { selection: [] as 'live'[], status: 'expired' as const },
])(
    'settles a disabled scope for $status with selection $selection',
    ({ selection, status }) => {
        const dataSource = {
            getCachedCategories: jest.fn(),
            getCachedContent: jest.fn(),
        };
        TestBed.configureTestingModule({
            providers: [
                ...createContentTestProviders(TestStore, {
                    dataSource,
                    databaseService: {},
                    xtreamApiService: {},
                    dataService: {},
                    pendingRestoreService: createPendingRestoreServiceMock(),
                }),
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: true },
                },
            ],
        });
        const store = TestBed.inject(TestStore);
        patchState(unprotected(store), {
            currentPlaylist: {
                ...TEST_PLAYLIST,
                xtreamContentTypes: selection,
            },
            portalStatus: status,
        });
        store.prepareContentLoading('vod');
        expect(store.isCachedContentScopeReady('vod')).toBe(true);
        expect(store.isLoadingCategories()).toBe(false);
        expect(store.isLoadingContent()).toBe(false);
        expect(dataSource.getCachedCategories).not.toHaveBeenCalled();
        expect(dataSource.getCachedContent).not.toHaveBeenCalled();
    }
);
