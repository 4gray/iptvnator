import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta, StalkerPortalActions } from '@iptvnator/shared/interfaces';
import { StalkerItvChannel } from '../../models';
import { StalkerItvCacheService } from '../../stalker-itv-cache.service';
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

/**
 * Controllable stand-in for StalkerItvCacheService so the legacy paged flow
 * can be tested in isolation and the cache-served flow deterministically.
 */
function createItvCacheMock(initialChannels: StalkerItvChannel[] | null = null) {
    const version = signal(0);
    let channels = initialChannels;

    return {
        versionFor: jest.fn(() => version()),
        getChannels: jest.fn(() => channels),
        ensureLoaded: jest.fn().mockResolvedValue(undefined),
        refresh: jest.fn().mockResolvedValue(undefined),
        isReady: jest.fn(() => channels !== null),
        isLoading: jest.fn(() => false),
        progressOf: jest.fn(() => null),
        setChannels(next: StalkerItvChannel[] | null) {
            channels = next;
            version.update((value) => value + 1);
        },
    };
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
                    provide: StalkerItvCacheService,
                    useValue: createItvCacheMock(),
                },
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

describe('withStalkerContent full ITV channel list cache', () => {
    const CACHED_CHANNELS: StalkerItvChannel[] = [
        { id: '1', cmd: 'ffrt http://x/1', name: 'News One', tv_genre_id: '5' },
        { id: '2', cmd: 'ffrt http://x/2', name: 'Sports HD', tv_genre_id: '9' },
        { id: '3', cmd: 'ffrt http://x/3', name: 'News Two', tv_genre_id: '5' },
    ];

    let store: InstanceType<typeof TestContentStore>;
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;
    };
    let itvCache: ReturnType<typeof createItvCacheMock>;

    function setup(initialChannels: StalkerItvChannel[] | null) {
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        itvCache = createItvCacheMock(initialChannels);

        TestBed.configureTestingModule({
            providers: [
                TestContentStore,
                { provide: DataService, useValue: dataService },
                { provide: StalkerItvCacheService, useValue: itvCache },
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
    }

    function enterItvCategory(categoryId: string) {
        store.setSelectedContentType('itv');
        store.setCategories('itv', [
            { category_id: '5', category_name: 'News' },
            { category_id: '9', category_name: 'Sports' },
        ]);
        store.setSelectedCategory(categoryId);
        store.setCurrentPlaylist(PLAYLIST);
        void store.isPaginatedContentLoading();
    }

    it('serves the whole category from the cache without portal requests', async () => {
        setup(CACHED_CHANNELS);
        enterItvCategory('5');

        await waitForCondition(() => store.itvChannels().length === 2);

        expect(store.itvChannels().map((channel) => channel.name)).toEqual([
            'News One',
            'News Two',
        ]);
        expect(store.totalCount()).toBe(2);
        expect(store.hasMoreChannels()).toBe(false);
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('serves all channels for the "*" category so search can cover everything', async () => {
        setup(CACHED_CHANNELS);
        enterItvCategory('*');

        await waitForCondition(() => store.itvChannels().length === 3);

        // Regression for the "search only finds the first 14 loaded items"
        // bug: the full list is available at once, no paging required.
        expect(store.itvChannels()).toHaveLength(3);
        expect(store.hasMoreChannels()).toBe(false);
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('falls back to the legacy paged fetch for a genre absent from the cache (censored/adult)', async () => {
        setup(CACHED_CHANNELS);
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                data: [
                    {
                        id: 'adult-1',
                        name: 'Adult One',
                        cmd: 'ffrt http://x/adult-1',
                    },
                ],
                total_items: 40,
            },
        });

        // Genre '19' has no channels in the cached full list.
        store.setSelectedContentType('itv');
        store.setCategories('itv', [
            { category_id: '5', category_name: 'News' },
            { category_id: '19', category_name: 'For adults', censored: true },
        ]);
        store.setSelectedCategory('19');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isPaginatedContentLoading();

        await waitForCondition(() => store.itvChannels().length === 1);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'itv',
                    genre: '19',
                    p: 1,
                }),
            })
        );
        expect(store.itvChannels()[0]?.name).toBe('Adult One');
        // Portal pagination stays in charge for this genre.
        expect(store.hasMoreChannels()).toBe(true);
    });

    it('reports whether the selected category is served from the cache', () => {
        setup(CACHED_CHANNELS);
        enterItvCategory('5');
        expect(store.itvSelectedCategoryFromCache()).toBe(true);

        store.setSelectedCategory('*');
        expect(store.itvSelectedCategoryFromCache()).toBe(true);

        // Genre with zero cached channels — e.g. a censored/adult category.
        store.setSelectedCategory('19');
        expect(store.itvSelectedCategoryFromCache()).toBe(false);
    });

    it('omits genres without cached channels from the count map (adult genres)', () => {
        setup(CACHED_CHANNELS);
        store.setSelectedContentType('itv');
        store.setCategories('itv', [
            { category_id: '*', category_name: 'All' },
            { category_id: '5', category_name: 'News' },
            { category_id: '19', category_name: 'For adults', censored: true },
        ]);
        store.setCurrentPlaylist(PLAYLIST);

        const counts = store.itvCategoryItemCounts();
        expect(counts.get(5)).toBe(2);
        // Adult genres are excluded from get_all_channels — regardless of any
        // `censored` flag — so their count is unknown: no entry, no badge.
        expect(counts.has(19)).toBe(false);
    });

    it('preloadItvChannels kicks off the cache load for the current playlist', () => {
        setup(null);
        store.setCurrentPlaylist(PLAYLIST);

        store.preloadItvChannels();

        expect(itvCache.ensureLoaded).toHaveBeenCalledWith(PLAYLIST);
    });

    it('exposes per-genre channel counts for category badges (with the total under the "All" key)', () => {
        setup(CACHED_CHANNELS);
        enterItvCategory('*');

        const counts = store.itvCategoryItemCounts();
        // Two channels in genre 5, one in genre 9.
        expect(counts.get(5)).toBe(2);
        expect(counts.get(9)).toBe(1);
        // "All" category is category_id '*' → Number('*') is NaN; the grand
        // total lives under the NaN key so the "All" row shows every channel.
        expect(counts.get(Number.NaN)).toBe(3);
    });

    it('has an empty count map when no full list is cached', () => {
        setup(null);
        enterItvCategory('*');

        const counts = store.itvCategoryItemCounts();
        // No genre entries at all — counts are unknown without the cache.
        expect(counts.get(5)).toBeUndefined();
        expect(counts.get(Number.NaN)).toBe(0);
    });

    it('drops a stale legacy page response that resolves after the cache took over', async () => {
        setup(null);
        const legacyResponse = createDeferred<unknown>();
        dataService.sendIpcEvent.mockReturnValue(legacyResponse.promise);

        enterItvCategory('5');

        await waitForCondition(
            () => dataService.sendIpcEvent.mock.calls.length > 0
        );

        // The background full-list load finishes while the legacy page-1
        // request is still in flight; the resource re-fires and serves the
        // complete category from the cache.
        itvCache.setChannels(CACHED_CHANNELS);
        await waitForCondition(() => store.itvChannels().length === 2);

        // The late legacy response must not overwrite the full list with the
        // first 14-item page again.
        legacyResponse.resolve({
            js: {
                data: [
                    {
                        id: 'legacy-1',
                        name: 'Legacy page one',
                        cmd: 'ffrt http://x/legacy',
                    },
                ],
                total_items: 28,
            },
        });
        await flushResources();

        expect(store.itvChannels().map((channel) => channel.name)).toEqual([
            'News One',
            'News Two',
        ]);
        expect(store.hasMoreChannels()).toBe(false);
    });

    it('kicks off a background full-list load and swaps it in once ready', async () => {
        setup(null);
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                data: [
                    {
                        id: 'legacy-1',
                        name: 'Legacy page one',
                        cmd: 'ffrt http://x/legacy',
                    },
                ],
                total_items: 28,
            },
        });

        enterItvCategory('5');

        await waitForCondition(() => store.itvChannels().length === 1);

        // Legacy paged flow stays in charge while the cache is cold.
        expect(store.itvChannels()[0]?.name).toBe('Legacy page one');
        expect(store.hasMoreChannels()).toBe(true);
        expect(itvCache.ensureLoaded).toHaveBeenCalledWith(PLAYLIST);

        // Full list finished loading in the background.
        itvCache.setChannels(CACHED_CHANNELS);

        await waitForCondition(() => store.itvChannels().length === 2);

        expect(store.itvChannels().map((channel) => channel.name)).toEqual([
            'News One',
            'News Two',
        ]);
        expect(store.hasMoreChannels()).toBe(false);
    });
});
