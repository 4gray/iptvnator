import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta, StalkerPortalActions } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { withStalkerContent } from './with-stalker-content.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const PLAYLIST = {
    _id: 'playlist-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

const TestContentStore = signalStore(
    withState({
        currentPlaylist: undefined as PlaylistMeta | undefined,
        selectedContentType: 'vod' as 'vod' | 'series' | 'itv' | 'radio',
        selectedCategoryId: undefined as string | null | undefined,
        searchPhrase: '',
        page: 0,
        limit: 14,
    }),
    withMethods((store) => ({
        setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
            patchState(store, { currentPlaylist: playlist });
        },
        setSelectedContentType(type: 'vod' | 'series' | 'itv' | 'radio') {
            patchState(store, { selectedContentType: type });
        },
        setSelectedCategory(id: string | null | undefined) {
            patchState(store, { selectedCategoryId: id });
        },
        setPage(page: number) {
            patchState(store, { page });
        },
    })),
    withStalkerContent()
);

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

function createContentResponse(title: string) {
    return {
        js: {
            data: [
                {
                    id: title,
                    name: title,
                    category_id: '5',
                },
            ],
            total_items: 28,
        },
    };
}

async function flushResources(): Promise<void> {
    TestBed.flushEffects();
    await Promise.resolve();
    await Promise.resolve();
    TestBed.flushEffects();
    await Promise.resolve();
}

async function waitForCondition(
    predicate: () => boolean,
    attempts = 20
): Promise<void> {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) {
            return;
        }

        await flushResources();
    }

    throw new Error('Timed out waiting for resource activity');
}

describe('withStalkerContent failure states', () => {
    let store: InstanceType<typeof TestContentStore>;
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;
    };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                TestContentStore,
                { provide: DataService, useValue: dataService },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        makeAuthenticatedRequest: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
            ],
        });

        store = TestBed.inject(TestContentStore);
    });

    it('normalizes category failures into empty arrays and explicit error state', async () => {
        dataService.sendIpcEvent.mockRejectedValue(
            new Error('get_genres failed')
        );

        store.setSelectedContentType('itv');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isCategoryResourceLoading();

        await waitForCondition(
            () => dataService.sendIpcEvent.mock.calls.length > 0
        );
        await flushResources();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                url: PLAYLIST.portalUrl,
                macAddress: PLAYLIST.macAddress,
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetGenres,
                    type: 'itv',
                }),
            })
        );
        expect(store.getCategoryResource()).toEqual([]);
        expect(store.itvCategories()).toEqual([]);
        expect(store.isCategoryResourceFailed()).toBeInstanceOf(Error);
        expect((store.isCategoryResourceFailed() as Error).message).toBe(
            'get_genres failed'
        );
    });

    it('derives the selected category from the normalized category collections', () => {
        store.setSelectedContentType('series');
        store.setCategories('series', [
            {
                category_id: '7',
                category_name: 'Drama',
            },
        ]);
        store.setSelectedCategory('7');

        expect(store.getSelectedCategory()).toEqual({
            category_id: '7',
            category_name: 'Drama',
        });
    });

    it('preserves server category order while keeping the all category first', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: [
                { id: 'z', title: 'Zulu' },
                { id: 'a', title: 'Alpha' },
                { id: 'm', title: 'Movies' },
            ],
        });

        store.setSelectedContentType('vod');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isCategoryResourceLoading();

        await waitForCondition(
            () => dataService.sendIpcEvent.mock.calls.length > 0
        );
        await flushResources();

        expect(
            store
                .getCategoryResource()
                .map((category) => category.category_name)
        ).toEqual(['PORTALS.ALL_CATEGORIES', 'Zulu', 'Alpha', 'Movies']);
    });

    it('normalizes content failures into empty collections instead of undefined state', async () => {
        dataService.sendIpcEvent.mockRejectedValue(
            new Error('get_ordered_list failed')
        );

        store.setSelectedContentType('itv');
        store.setCategories('itv', [
            {
                category_id: '5',
                category_name: 'News',
            },
        ]);
        store.setSelectedCategory('5');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isPaginatedContentLoading();

        await waitForCondition(
            () => dataService.sendIpcEvent.mock.calls.length > 0
        );
        await flushResources();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'itv',
                    category: '5',
                    genre: '5',
                }),
            })
        );
        expect(store.getPaginatedContent()).toEqual([]);
        expect(store.itvChannels()).toEqual([]);
        expect(store.hasMoreChannels()).toBe(false);
        expect(store.isPaginatedContentFailed()).toBeInstanceOf(Error);
        expect((store.isPaginatedContentFailed() as Error).message).toBe(
            'get_ordered_list failed'
        );
    });

    it('loads live TV channels page by page and appends later pages', async () => {
        dataService.sendIpcEvent.mockImplementation(
            (_event: unknown, payload: { params?: { p?: number } }) => {
                const page = Number(payload.params?.p ?? 1);

                return Promise.resolve({
                    js: {
                        data: [
                            {
                                id: `channel-${page}`,
                                name: `Channel page ${page}`,
                                category_id: '5',
                            },
                        ],
                        total_items: 2,
                    },
                });
            }
        );

        store.setSelectedContentType('itv');
        store.setCategories('itv', [
            {
                category_id: '5',
                category_name: 'News',
            },
        ]);
        store.setSelectedCategory('5');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isPaginatedContentLoading();

        await waitForCondition(() => store.itvChannels().length === 1);

        expect(dataService.sendIpcEvent).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'itv',
                    category: '5',
                    genre: '5',
                    p: 1,
                }),
            })
        );
        expect(store.itvChannels().map((channel) => channel.name)).toEqual([
            'Channel page 1',
        ]);
        expect(store.hasMoreChannels()).toBe(true);

        store.setPage(1);

        await waitForCondition(() => store.itvChannels().length === 2);

        expect(dataService.sendIpcEvent).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'itv',
                    category: '5',
                    genre: '5',
                    p: 2,
                }),
            })
        );
        expect(store.itvChannels().map((channel) => channel.name)).toEqual([
            'Channel page 1',
            'Channel page 2',
        ]);
        expect(store.hasMoreChannels()).toBe(false);
    });

    it('falls back to a synthetic all-radio category when radio categories are unavailable', async () => {
        dataService.sendIpcEvent.mockRejectedValue(
            new Error('radio categories unsupported')
        );

        store.setSelectedContentType('radio');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isCategoryResourceLoading();

        await waitForCondition(
            () => dataService.sendIpcEvent.mock.calls.length > 0
        );
        await flushResources();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetCategories,
                    type: 'radio',
                }),
            })
        );
        expect(store.getCategoryResource()).toEqual([
            {
                category_id: '*',
                category_name: 'PORTALS.ALL_RADIO',
            },
        ]);
        expect(store.radioCategories()).toEqual([
            {
                category_id: '*',
                category_name: 'PORTALS.ALL_RADIO',
            },
        ]);
        expect(store.isCategoryResourceFailed()).toBeNull();
    });

    it('loads radio stations separately from live TV channels', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                data: [
                    {
                        id: 'radio-1',
                        name: 'Jazz FM',
                        cmd: 'ifm https://stream.example/jazz.mp3',
                    },
                ],
                total_items: 1,
            },
        });

        store.setSelectedContentType('radio');
        store.setCategories('radio', [
            {
                category_id: 'radio-all',
                category_name: 'Radio',
            },
        ]);
        store.setSelectedCategory('radio-all');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isPaginatedContentLoading();

        await waitForCondition(() => store.radioChannels().length === 1);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'radio',
                    category: 'radio-all',
                    p: 1,
                }),
            })
        );
        expect(store.radioChannels().map((channel) => channel.name)).toEqual([
            'Jazz FM',
        ]);
        expect(store.itvChannels()).toEqual([]);
    });

    it('ignores stale content responses after the selected page changes', async () => {
        const pendingByPage = new Map<
            number,
            ReturnType<typeof createDeferred<unknown>>[]
        >();

        dataService.sendIpcEvent.mockImplementation(
            (_event: unknown, payload: { params?: { p?: number } }) => {
                const page = Number(payload.params?.p);
                const deferred = createDeferred<unknown>();
                const pending = pendingByPage.get(page) ?? [];
                pending.push(deferred);
                pendingByPage.set(page, pending);
                return deferred.promise;
            }
        );

        store.setSelectedContentType('vod');
        store.setCategories('vod', [
            {
                category_id: '5',
                category_name: 'Movies',
            },
        ]);
        store.setSelectedCategory('5');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isPaginatedContentLoading();

        await waitForCondition(() => pendingByPage.get(1)?.length === 1);
        pendingByPage
            .get(1)?.[0]
            .resolve(createContentResponse('Page 1 initial'));
        await waitForCondition(
            () => store.getPaginatedContent()[0]?.name === 'Page 1 initial'
        );

        store.setPage(1);
        await waitForCondition(() => pendingByPage.get(2)?.length === 1);

        store.setPage(0);
        await waitForCondition(() => pendingByPage.get(1)?.length === 2);
        pendingByPage
            .get(1)?.[1]
            .resolve(createContentResponse('Page 1 restored'));
        await waitForCondition(
            () => store.getPaginatedContent()[0]?.name === 'Page 1 restored'
        );

        pendingByPage
            .get(2)?.[0]
            .resolve(createContentResponse('Page 2 stale'));
        await flushResources();

        expect(store.page()).toBe(0);
        expect(store.getPaginatedContent()[0]?.name).toBe('Page 1 restored');
    });
});
