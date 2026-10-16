import { TestBed } from '@angular/core/testing';
import { signalStore, withMethods, withState } from '@ngrx/signals';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { XtreamContentType } from '@iptvnator/shared/interfaces';
import { withContent } from './with-content.feature';
import {
    createContentTestProviders,
    createPendingRestoreServiceMock,
    TEST_PLAYLIST,
} from './with-content.feature.spec-helpers';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

describe('catalog selection runtime compatibility', () => {
    it.each<{
        desktop: boolean;
        selected: XtreamContentType[];
        expected: XtreamContentType[];
    }>([
        { desktop: true, selected: [], expected: [] },
        { desktop: true, selected: ['live'], expected: ['live'] },
        {
            desktop: true,
            selected: ['movie', 'series'],
            expected: ['movie', 'series'],
        },
        { desktop: false, selected: [], expected: ['live', 'movie', 'series'] },
        {
            desktop: false,
            selected: ['live'],
            expected: ['live', 'movie', 'series'],
        },
    ])(
        'imports $expected with desktop=$desktop and metadata=$selected',
        async ({ desktop, selected, expected }) => {
            const TestStore = signalStore(
                withState({
                    playlistId: TEST_PLAYLIST.id,
                    currentPlaylist: {
                        ...TEST_PLAYLIST,
                        xtreamContentTypes: selected,
                    },
                    portalStatus: 'active' as const,
                    selectedContentType: 'vod' as const,
                }),
                withMethods(() => ({
                    checkPortalStatus: async () => 'active' as const,
                })),
                withContent()
            );
            const dataSource = {
                hasCategories: jest.fn().mockResolvedValue(false),
                hasContent: jest.fn().mockResolvedValue(false),
                getCategories: jest.fn().mockResolvedValue([]),
                getCachedCategories: jest.fn().mockResolvedValue([]),
                getContent: jest.fn().mockResolvedValue([]),
                getCachedContent: jest.fn().mockResolvedValue([]),
                restoreUserData: jest.fn().mockResolvedValue(undefined),
            };
            TestBed.configureTestingModule({
                providers: [
                    ...createContentTestProviders(TestStore, {
                        dataSource,
                        databaseService: {
                            createOperationId: jest
                                .fn()
                                .mockReturnValue('operation'),
                            getXtreamImportStatus: jest
                                .fn()
                                .mockResolvedValue('idle'),
                            setXtreamImportStatus: jest
                                .fn()
                                .mockResolvedValue(true),
                            supportsDbOperationCancellation: jest
                                .fn()
                                .mockReturnValue(false),
                        },
                        pendingRestoreService:
                            createPendingRestoreServiceMock(),
                        xtreamApiService: {
                            cancelSession: jest.fn().mockResolvedValue(true),
                        },
                        dataService: {
                            sendIpcEvent: jest
                                .fn()
                                .mockResolvedValue({ success: true }),
                        },
                    }),
                    {
                        provide: RuntimeCapabilitiesService,
                        useValue: { supportsXtreamSqliteDataSource: desktop },
                    },
                ],
            });
            const store = TestBed.inject(TestStore);
            await store.initializeContent();
            expect(
                dataSource.getContent.mock.calls.map((call) => call[2])
            ).toEqual(expected);
            expect(store.isContentInitialized()).toBe(true);
        }
    );
});
