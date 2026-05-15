import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PortalStatusType,
    XtreamContentInitBlockReason,
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { XtreamWorkspaceRouteSession } from './xtream-workspace-route-session.service';

const PLAYLIST_ID = 'playlist-1';
const NEXT_PLAYLIST_ID = 'playlist-2';
const ACTIVE_PLAYLIST: PlaylistMeta = {
    _id: PLAYLIST_ID,
    filename: 'xtream.m3u',
    password: 'secret',
    serverUrl: 'http://localhost:3211',
    title: 'Test Xtream',
    username: 'user1',
} as PlaylistMeta;
const UPDATED_ACTIVE_PLAYLIST: PlaylistMeta = {
    ...ACTIVE_PLAYLIST,
    serverUrl: 'http://localhost:65530',
} as PlaylistMeta;

const XTREAM_PLAYLIST: XtreamPlaylistData = {
    id: PLAYLIST_ID,
    name: 'Test Xtream',
    title: 'Test Xtream',
    serverUrl: 'http://localhost:3211',
    username: 'user1',
    password: 'secret',
    type: 'xtream',
};
const XTREAM_PLAYLIST_WITH_NULL_OPTIONALS = {
    ...XTREAM_PLAYLIST,
    origin: null,
    referrer: null,
    userAgent: null,
} as XtreamPlaylistData;
type CachedScope = 'live' | 'vod' | 'series' | 'search' | 'recently-added';

async function flushEffects(): Promise<void> {
    for (let index = 0; index < 6; index += 1) {
        await Promise.resolve();
    }
}

function getXtreamSectionFromUrl(url: string): string | null {
    const match = url.match(
        /^\/workspace\/xtreams\/[^/]+\/([^/?]+)(?:[/?]|$)/
    );

    return match?.[1] ?? null;
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

describe('XtreamWorkspaceRouteSession', () => {
    const routerEvents = new Subject<NavigationEnd | NavigationStart>();
    const routeProvider = signal<'xtreams' | null>('xtreams');
    const routePlaylistId = signal<string | null>(PLAYLIST_ID);
    const activePlaylist = signal<PlaylistMeta | null>(ACTIVE_PLAYLIST);
    const currentPlaylist = signal<XtreamPlaylistData | null>(XTREAM_PLAYLIST);
    const playlistId = signal<string | null>(PLAYLIST_ID);
    const portalStatus = signal<PortalStatusType>('active');
    const selectedContentType = signal<'live' | 'vod' | 'series'>('vod');
    const selectedCategoryId = signal<number | null>(null);
    const isContentInitialized = signal(false);
    const contentLoadStateByType = signal<
        Record<'live' | 'vod' | 'series', 'idle' | 'loading' | 'ready' | 'error'>
    >({
        live: 'idle',
        vod: 'idle',
        series: 'idle',
    });
    const contentInitBlockReason =
        signal<XtreamContentInitBlockReason | null>(null);
    let hasUsableOfflineCache = false;

    const playlistContext = {
        routeProvider,
        routePlaylistId,
        activePlaylist,
        syncFromUrl: jest.fn(),
    };

    const xtreamStore = {
        currentPlaylist,
        playlistId,
        portalStatus,
        resetStore: jest.fn((nextPlaylistId?: string) => {
            playlistId.set(nextPlaylistId ?? null);
            currentPlaylist.set(null);
            selectedContentType.set('vod');
            isContentInitialized.set(false);
            contentLoadStateByType.set({
                live: 'idle',
                vod: 'idle',
                series: 'idle',
            });
        }),
        setCurrentPlaylist: jest.fn((playlist: XtreamPlaylistData | null) => {
            currentPlaylist.set(playlist);
        }),
        fetchXtreamPlaylist: jest.fn().mockResolvedValue(undefined),
        checkPortalStatus: jest.fn(),
        hasUsableOfflineCache: jest.fn().mockImplementation(async () => {
            return hasUsableOfflineCache;
        }),
        isCachedContentScopeReady: jest.fn(
            (scope?: CachedScope | null): boolean => {
                const loadStates = contentLoadStateByType();
                if (scope === 'live' || scope === 'vod' || scope === 'series') {
                    return loadStates[scope] === 'ready';
                }

                return (
                    loadStates.live === 'ready' &&
                    loadStates.vod === 'ready' &&
                    loadStates.series === 'ready'
                );
            }
        ),
        isContentInitialized,
        contentLoadStateByType,
        contentInitBlockReason,
        initializeContent: jest.fn().mockImplementation(async () => {
            isContentInitialized.set(true);
            contentLoadStateByType.set({
                live: 'ready',
                vod: 'ready',
                series: 'ready',
            });
        }),
        hydrateCachedContent: jest.fn().mockImplementation(
            async (scope?: CachedScope | null) => {
                isContentInitialized.set(true);
                contentInitBlockReason.set(null);
                if (scope === 'live' || scope === 'vod' || scope === 'series') {
                    contentLoadStateByType.update((state) => ({
                        ...state,
                        [scope]: 'ready',
                    }));
                } else {
                    contentLoadStateByType.set({
                        live: 'ready',
                        vod: 'ready',
                        series: 'ready',
                    });
                }
            }
        ),
        prepareContentLoading: jest.fn(
            (scope?: CachedScope | null) => {
                isContentInitialized.set(false);
                if (scope === 'live' || scope === 'vod' || scope === 'series') {
                    contentLoadStateByType.update((state) => ({
                        ...state,
                        [scope]: 'loading',
                    }));
                } else {
                    contentLoadStateByType.set({
                        live: 'loading',
                        vod: 'loading',
                        series: 'loading',
                    });
                }
            }
        ),
        setSelectedContentType: jest.fn(
            (type: 'live' | 'vod' | 'series') => {
                selectedContentType.set(type);
            }
        ),
        setSelectedCategory: jest.fn((categoryId: number | null) => {
            selectedCategoryId.set(categoryId);
        }),
        setContentInitBlockReason: jest.fn(
            (reason: XtreamContentInitBlockReason | null) => {
                contentInitBlockReason.set(reason);
            }
        ),
    };

    const router = {
        url: `/workspace/xtreams/${PLAYLIST_ID}/vod`,
        events: routerEvents.asObservable(),
    };

    beforeEach(async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/vod`;
        routeProvider.set('xtreams');
        routePlaylistId.set(PLAYLIST_ID);
        activePlaylist.set(ACTIVE_PLAYLIST);
        currentPlaylist.set(null);
        playlistId.set(null);
        portalStatus.set('active');
        selectedContentType.set('vod');
        selectedCategoryId.set(null);
        isContentInitialized.set(false);
        contentLoadStateByType.set({
            live: 'idle',
            vod: 'idle',
            series: 'idle',
        });
        contentInitBlockReason.set(null);
        hasUsableOfflineCache = false;

        playlistContext.syncFromUrl.mockImplementation((url: string) => ({
            inWorkspace: true,
            provider: 'xtreams',
            playlistId: PLAYLIST_ID,
            section: getXtreamSectionFromUrl(url) as
                | 'favorites'
                | 'live'
                | 'recently-added'
                | 'search'
                | 'series'
                | 'vod'
                | null,
        }));

        xtreamStore.resetStore.mockClear();
        xtreamStore.setCurrentPlaylist.mockClear();
        xtreamStore.fetchXtreamPlaylist.mockClear();
        xtreamStore.checkPortalStatus.mockReset();
        xtreamStore.hasUsableOfflineCache.mockClear();
        xtreamStore.isCachedContentScopeReady.mockClear();
        xtreamStore.initializeContent.mockClear();
        xtreamStore.hydrateCachedContent.mockClear();
        xtreamStore.prepareContentLoading.mockClear();
        xtreamStore.setSelectedContentType.mockClear();
        xtreamStore.setSelectedCategory.mockClear();
        xtreamStore.setContentInitBlockReason.mockClear();

        await TestBed.configureTestingModule({
            providers: [
                XtreamWorkspaceRouteSession,
                {
                    provide: PlaylistContextFacade,
                    useValue: playlistContext,
                },
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: XtreamStore,
                    useValue: xtreamStore,
                },
            ],
        });
    });

    it('initializes content for active import-driven routes', async () => {
        xtreamStore.checkPortalStatus.mockImplementation(async () => {
            portalStatus.set('active');
            return 'active';
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.checkPortalStatus).toHaveBeenCalled();
        expect(xtreamStore.setContentInitBlockReason).toHaveBeenCalledWith(null);
        expect(xtreamStore.setSelectedContentType).toHaveBeenCalledWith('vod');
        expect(xtreamStore.prepareContentLoading).toHaveBeenCalledWith('vod');
        expect(xtreamStore.initializeContent).toHaveBeenCalled();
    });

    it('marks the routed section loading before status checks complete during playlist switches', async () => {
        const portalStatusCheck = createDeferred<PortalStatusType>();
        xtreamStore.checkPortalStatus.mockReturnValue(
            portalStatusCheck.promise
        );

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.resetStore).toHaveBeenCalledWith(PLAYLIST_ID);
        expect(xtreamStore.prepareContentLoading).toHaveBeenCalledWith('vod');
        expect(contentLoadStateByType().vod).toBe('loading');
        expect(xtreamStore.initializeContent).not.toHaveBeenCalled();

        portalStatus.set('active');
        portalStatusCheck.resolve('active');
        await flushEffects();

        expect(xtreamStore.initializeContent).toHaveBeenCalled();
    });

    it('prepares loading on navigation start when switching Xtream playlists', async () => {
        currentPlaylist.set(XTREAM_PLAYLIST);
        playlistId.set(PLAYLIST_ID);
        isContentInitialized.set(true);
        contentLoadStateByType.set({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();
        xtreamStore.prepareContentLoading.mockClear();

        routerEvents.next(
            new NavigationStart(
                1,
                `/workspace/xtreams/${NEXT_PLAYLIST_ID}/live`
            )
        );

        expect(xtreamStore.prepareContentLoading).toHaveBeenCalledWith('live');
        expect(contentLoadStateByType().live).toBe('loading');
    });

    it('does not prepare loading on navigation start for category changes in the current playlist', async () => {
        currentPlaylist.set(XTREAM_PLAYLIST);
        playlistId.set(PLAYLIST_ID);
        isContentInitialized.set(true);
        contentLoadStateByType.set({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();
        xtreamStore.prepareContentLoading.mockClear();

        routerEvents.next(
            new NavigationStart(1, `/workspace/xtreams/${PLAYLIST_ID}/vod/202`)
        );

        expect(xtreamStore.prepareContentLoading).not.toHaveBeenCalled();
        expect(contentLoadStateByType().vod).toBe('ready');
    });

    it('reapplies a live route section after resetStore restores the default selection', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/live`;
        xtreamStore.checkPortalStatus.mockImplementation(async () => {
            portalStatus.set('active');
            return 'active';
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.resetStore).toHaveBeenCalledWith(PLAYLIST_ID);
        expect(xtreamStore.setSelectedContentType).toHaveBeenCalledWith('live');
        expect(xtreamStore.prepareContentLoading).toHaveBeenCalledWith('live');
        expect(selectedContentType()).toBe('live');
        expect(
            xtreamStore.setSelectedContentType.mock.invocationCallOrder[0]
        ).toBeGreaterThan(xtreamStore.resetStore.mock.invocationCallOrder[0]);
    });

    it('does not bootstrap again when the store already holds the active playlist', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/vod/101`;
        currentPlaylist.set(XTREAM_PLAYLIST);
        playlistId.set(PLAYLIST_ID);
        isContentInitialized.set(true);
        contentLoadStateByType.set({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.setSelectedContentType).toHaveBeenCalledWith('vod');
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(101);
        expect(xtreamStore.resetStore).not.toHaveBeenCalled();
        expect(xtreamStore.fetchXtreamPlaylist).not.toHaveBeenCalled();
        expect(xtreamStore.checkPortalStatus).not.toHaveBeenCalled();
        expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
    });

    it('does not treat blank and null Xtream connection metadata as a playlist change', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/vod/101`;
        activePlaylist.set({
            ...ACTIVE_PLAYLIST,
            origin: '',
            referrer: '',
            userAgent: '',
        } as PlaylistMeta);
        currentPlaylist.set(XTREAM_PLAYLIST_WITH_NULL_OPTIONALS);
        playlistId.set(PLAYLIST_ID);
        isContentInitialized.set(true);
        contentLoadStateByType.set({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.resetStore).not.toHaveBeenCalled();
        expect(xtreamStore.fetchXtreamPlaylist).not.toHaveBeenCalled();
        expect(xtreamStore.checkPortalStatus).not.toHaveBeenCalled();
        expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
    });

    it('does not reinitialize content when switching categories in an initialized playlist', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/vod/101`;
        xtreamStore.checkPortalStatus.mockImplementation(async () => {
            portalStatus.set('active');
            return 'active';
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();
        await flushEffects();

        expect(isContentInitialized()).toBe(true);

        xtreamStore.resetStore.mockClear();
        xtreamStore.fetchXtreamPlaylist.mockClear();
        xtreamStore.checkPortalStatus.mockClear();
        xtreamStore.initializeContent.mockClear();
        xtreamStore.setSelectedContentType.mockClear();
        xtreamStore.setSelectedCategory.mockClear();

        router.url = `/workspace/xtreams/${PLAYLIST_ID}/vod/202`;
        routerEvents.next(
            new NavigationEnd(1, router.url, router.url)
        );
        await flushEffects();

        expect(xtreamStore.setSelectedContentType).toHaveBeenCalledWith('vod');
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(202);
        expect(selectedCategoryId()).toBe(202);
        expect(xtreamStore.resetStore).not.toHaveBeenCalled();
        expect(xtreamStore.fetchXtreamPlaylist).not.toHaveBeenCalled();
        expect(xtreamStore.checkPortalStatus).not.toHaveBeenCalled();
        expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
    });

    it('preserves the selected live category during query-only search navigation', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/live`;
        currentPlaylist.set(XTREAM_PLAYLIST);
        playlistId.set(PLAYLIST_ID);
        isContentInitialized.set(true);
        contentLoadStateByType.set({
            live: 'ready',
            vod: 'ready',
            series: 'ready',
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        selectedCategoryId.set(101);
        xtreamStore.setSelectedCategory.mockClear();

        router.url = `/workspace/xtreams/${PLAYLIST_ID}/live?q=world`;
        routerEvents.next(new NavigationEnd(1, router.url, router.url));
        await flushEffects();

        expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalledWith(null);
        expect(selectedCategoryId()).toBe(101);
    });

    it('does not rehydrate cached offline content when switching categories in a ready section', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/vod/101`;
        currentPlaylist.set(XTREAM_PLAYLIST);
        playlistId.set(PLAYLIST_ID);
        portalStatus.set('unavailable');
        isContentInitialized.set(true);
        contentLoadStateByType.set({
            live: 'idle',
            vod: 'ready',
            series: 'idle',
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.setSelectedContentType).toHaveBeenCalledWith('vod');
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(101);
        expect(selectedCategoryId()).toBe(101);
        expect(xtreamStore.hasUsableOfflineCache).not.toHaveBeenCalled();
        expect(xtreamStore.hydrateCachedContent).not.toHaveBeenCalled();
        expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
    });

    it('hydrates an offline cached type once and skips later category hydrations', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/series`;
        currentPlaylist.set(XTREAM_PLAYLIST);
        playlistId.set(PLAYLIST_ID);
        portalStatus.set('unavailable');
        isContentInitialized.set(true);
        hasUsableOfflineCache = true;
        contentLoadStateByType.set({
            live: 'idle',
            vod: 'ready',
            series: 'idle',
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.hasUsableOfflineCache).toHaveBeenCalledWith(
            'series'
        );
        expect(xtreamStore.hydrateCachedContent).toHaveBeenCalledWith(
            'series'
        );
        expect(contentLoadStateByType().series).toBe('ready');

        xtreamStore.hasUsableOfflineCache.mockClear();
        xtreamStore.hydrateCachedContent.mockClear();
        xtreamStore.setSelectedCategory.mockClear();

        router.url = `/workspace/xtreams/${PLAYLIST_ID}/series/303`;
        routerEvents.next(new NavigationEnd(1, router.url, router.url));
        await flushEffects();

        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(303);
        expect(xtreamStore.hasUsableOfflineCache).not.toHaveBeenCalled();
        expect(xtreamStore.hydrateCachedContent).not.toHaveBeenCalled();
        expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
    });

    it.each(['expired', 'inactive', 'unavailable'] as const)(
        'blocks %s portals before import-driven initialization starts',
        async (status) => {
            xtreamStore.checkPortalStatus.mockImplementation(async () => {
                portalStatus.set(status);
                return status;
            });

            TestBed.inject(XtreamWorkspaceRouteSession);
            await flushEffects();

            expect(xtreamStore.checkPortalStatus).toHaveBeenCalled();
            expect(xtreamStore.setContentInitBlockReason).toHaveBeenCalledWith(
                status
            );
            expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
        }
    );

    it.each(['expired', 'inactive', 'unavailable'] as const)(
        'hydrates cached content for %s portals',
        async (status) => {
            hasUsableOfflineCache = true;
            activePlaylist.set(UPDATED_ACTIVE_PLAYLIST);
            xtreamStore.checkPortalStatus.mockImplementation(async () => {
                portalStatus.set(status);
                return status;
            });

            TestBed.inject(XtreamWorkspaceRouteSession);
            await flushEffects();
            await flushEffects();

            expect(xtreamStore.checkPortalStatus).toHaveBeenCalled();
            expect(xtreamStore.hasUsableOfflineCache).toHaveBeenCalledWith(
                'vod'
            );
            expect(xtreamStore.setContentInitBlockReason).toHaveBeenCalledWith(
                null
            );
            expect(xtreamStore.hydrateCachedContent).toHaveBeenCalledWith(
                'vod'
            );
            expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
        }
    );

    it('keeps active cached playlists on the normal initialization path', async () => {
        hasUsableOfflineCache = true;
        activePlaylist.set(UPDATED_ACTIVE_PLAYLIST);
        xtreamStore.checkPortalStatus.mockImplementation(async () => {
            portalStatus.set('active');
            return 'active';
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();
        await flushEffects();

        expect(xtreamStore.checkPortalStatus).toHaveBeenCalled();
        expect(xtreamStore.hasUsableOfflineCache).not.toHaveBeenCalled();
        expect(xtreamStore.initializeContent).toHaveBeenCalled();
        expect(xtreamStore.hydrateCachedContent).not.toHaveBeenCalled();
    });

    it('hydrates cached search routes when any Xtream content is persisted', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/search`;
        hasUsableOfflineCache = true;
        activePlaylist.set(UPDATED_ACTIVE_PLAYLIST);
        xtreamStore.checkPortalStatus.mockImplementation(async () => {
            portalStatus.set('unavailable');
            return 'unavailable';
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();
        await flushEffects();

        expect(xtreamStore.checkPortalStatus).toHaveBeenCalled();
        expect(xtreamStore.hasUsableOfflineCache).toHaveBeenCalledWith(
            'search'
        );
        expect(xtreamStore.setContentInitBlockReason).toHaveBeenCalledWith(
            null
        );
        expect(xtreamStore.hydrateCachedContent).toHaveBeenCalledWith(
            'search'
        );
        expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
    });

    it('rebootstraps the current Xtream playlist when its connection details change', async () => {
        activePlaylist.set(UPDATED_ACTIVE_PLAYLIST);
        currentPlaylist.set(XTREAM_PLAYLIST);
        playlistId.set(PLAYLIST_ID);
        xtreamStore.checkPortalStatus.mockImplementation(async () => {
            portalStatus.set('active');
            return 'active';
        });

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();
        await flushEffects();

        expect(xtreamStore.resetStore).toHaveBeenCalledWith(PLAYLIST_ID);
        expect(xtreamStore.setCurrentPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                id: PLAYLIST_ID,
                serverUrl: UPDATED_ACTIVE_PLAYLIST.serverUrl,
            })
        );
        expect(xtreamStore.checkPortalStatus).toHaveBeenCalled();
    });

    it('does not clear a cancelled block while an active portal bootstrap finishes', async () => {
        xtreamStore.checkPortalStatus.mockImplementation(async () => {
            portalStatus.set('active');
            return 'active';
        });
        contentInitBlockReason.set('cancelled');

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.checkPortalStatus).toHaveBeenCalled();
        expect(xtreamStore.setContentInitBlockReason).not.toHaveBeenCalledWith(
            null
        );
    });
});
