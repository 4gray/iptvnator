import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PortalStatusType,
    XtreamContentInitBlockReason,
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistMeta } from 'shared-interfaces';
import { XtreamWorkspaceRouteSession } from './xtream-workspace-route-session.service';

const PLAYLIST_ID = 'playlist-1';
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

async function flushEffects(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function getXtreamSectionFromUrl(url: string): string | null {
    const match = url.match(
        /^\/workspace\/xtreams\/[^/]+\/([^/?]+)(?:\/|$)/
    );

    return match?.[1] ?? null;
}

describe('XtreamWorkspaceRouteSession', () => {
    const routerEvents = new Subject<NavigationEnd>();
    const routeProvider = signal<'xtreams' | null>('xtreams');
    const routePlaylistId = signal<string | null>(PLAYLIST_ID);
    const activePlaylist = signal<PlaylistMeta | null>(ACTIVE_PLAYLIST);
    const currentPlaylist = signal<XtreamPlaylistData | null>(XTREAM_PLAYLIST);
    const playlistId = signal<string | null>(PLAYLIST_ID);
    const portalStatus = signal<PortalStatusType>('active');
    const selectedContentType = signal<'live' | 'vod' | 'series'>('vod');
    const selectedCategoryId = signal<number | null>(null);
    const isContentInitialized = signal(false);
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
        }),
        setCurrentPlaylist: jest.fn((playlist: XtreamPlaylistData | null) => {
            currentPlaylist.set(playlist);
        }),
        fetchXtreamPlaylist: jest.fn().mockResolvedValue(undefined),
        checkPortalStatus: jest.fn(),
        hasUsableOfflineCache: jest.fn().mockImplementation(async () => {
            return hasUsableOfflineCache;
        }),
        isContentInitialized,
        contentInitBlockReason,
        initializeContent: jest.fn().mockImplementation(async () => {
            isContentInitialized.set(true);
        }),
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
        xtreamStore.initializeContent.mockClear();
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
        expect(xtreamStore.initializeContent).toHaveBeenCalled();
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

        TestBed.inject(XtreamWorkspaceRouteSession);
        await flushEffects();

        expect(xtreamStore.setSelectedContentType).toHaveBeenCalledWith('vod');
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(101);
        expect(xtreamStore.resetStore).not.toHaveBeenCalled();
        expect(xtreamStore.fetchXtreamPlaylist).not.toHaveBeenCalled();
        expect(xtreamStore.checkPortalStatus).not.toHaveBeenCalled();
        expect(xtreamStore.initializeContent).not.toHaveBeenCalled();
    });

    it('does not treat null and undefined Xtream connection metadata as a playlist change', async () => {
        router.url = `/workspace/xtreams/${PLAYLIST_ID}/vod/101`;
        currentPlaylist.set(XTREAM_PLAYLIST_WITH_NULL_OPTIONALS);
        playlistId.set(PLAYLIST_ID);
        isContentInitialized.set(true);

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

    it('allows unavailable portals to initialize cached content', async () => {
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
        expect(xtreamStore.hasUsableOfflineCache).toHaveBeenCalled();
        expect(xtreamStore.setContentInitBlockReason).toHaveBeenCalledWith(
            null
        );
        expect(xtreamStore.initializeContent).toHaveBeenCalled();
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
