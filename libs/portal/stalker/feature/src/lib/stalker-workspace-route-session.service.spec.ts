import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { EMPTY, Subject, of } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerConnectionFlowService } from './stalker-connection-flow/stalker-connection-flow.service';
import { StalkerWorkspaceRouteSession } from './stalker-workspace-route-session.service';

const PLAYLIST_ID = 'stalker-1';
const ACTIVE_PLAYLIST: PlaylistMeta = {
    _id: PLAYLIST_ID,
    filename: 'stalker.m3u',
    macAddress: '00:1A:79:12:34:56',
    portalUrl: 'http://localhost/stalker_portal/server/load.php',
    title: 'Test Stalker',
} as PlaylistMeta;

const FULL_STALKER_PLAYLIST: PlaylistMeta = {
    ...ACTIVE_PLAYLIST,
    isFullStalkerPortal: true,
    stalkerSerialNumber: 'CUSTOMSN123',
    stalkerDeviceId1: 'DEVICE-ID-1',
    stalkerDeviceId2: 'DEVICE-ID-2',
    stalkerSignature1: 'SIGNATURE-1',
    stalkerSignature2: 'SIGNATURE-2',
} as PlaylistMeta;

async function flushEffects(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function getStalkerSectionFromUrl(url: string): string | null {
    const match = url.match(/^\/workspace\/stalker\/[^/]+\/([^/?]+)(?:\/|$)/);

    return match?.[1] ?? null;
}

describe('StalkerWorkspaceRouteSession', () => {
    const routerEvents = new Subject<NavigationEnd>();
    const connectionReady = new Subject<PlaylistMeta>();
    const activePlaylist = signal<PlaylistMeta | null>(ACTIVE_PLAYLIST);
    const selectedContentType = signal<'vod' | 'itv' | 'series' | 'radio'>(
        'vod'
    );

    const playlistContext = {
        activePlaylist,
        syncFromUrl: jest.fn(),
    };

    const stalkerStore = {
        resetCategories: jest.fn(),
        setSelectedCategory: jest.fn(),
        clearSelectedItem: jest.fn(),
        setCurrentPlaylist: jest.fn().mockResolvedValue(undefined),
        setSelectedContentType: jest.fn(
            (type: 'vod' | 'itv' | 'series' | 'radio') => {
                selectedContentType.set(type);
            }
        ),
        setSearchPhrase: jest.fn(),
    };

    const playlistsService = {
        getPlaylistById: jest.fn(() => of(ACTIVE_PLAYLIST)),
    };

    const connectionFlow = {
        cancel: jest.fn().mockResolvedValue(undefined),
        connectionReady$: connectionReady.asObservable(),
        ensureConnected: jest.fn(
            async (playlist: PlaylistMeta) => playlist
        ),
    };

    const router = {
        url: `/workspace/stalker/${PLAYLIST_ID}/vod`,
        events: routerEvents.asObservable(),
    };

    beforeEach(async () => {
        router.url = `/workspace/stalker/${PLAYLIST_ID}/vod`;
        activePlaylist.set(ACTIVE_PLAYLIST);
        selectedContentType.set('vod');

        playlistContext.syncFromUrl.mockImplementation((url: string) => ({
            inWorkspace: true,
            provider: 'stalker',
            playlistId: PLAYLIST_ID,
            section: getStalkerSectionFromUrl(url) as
                | 'favorites'
                | 'itv'
                | 'radio'
                | 'recent'
                | 'search'
                | 'series'
                | 'vod'
                | null,
        }));

        stalkerStore.resetCategories.mockClear();
        stalkerStore.setSelectedCategory.mockClear();
        stalkerStore.clearSelectedItem.mockClear();
        stalkerStore.setCurrentPlaylist.mockClear();
        stalkerStore.setSelectedContentType.mockClear();
        stalkerStore.setSearchPhrase.mockClear();
        playlistsService.getPlaylistById.mockClear();
        connectionFlow.cancel.mockClear();
        connectionFlow.ensureConnected.mockClear();

        await TestBed.configureTestingModule({
            providers: [
                StalkerWorkspaceRouteSession,
                {
                    provide: PlaylistContextFacade,
                    useValue: playlistContext,
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsService,
                },
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: StalkerStore,
                    useValue: stalkerStore,
                },
                {
                    provide: StalkerConnectionFlowService,
                    useValue: connectionFlow,
                },
            ],
        });
    });

    it('keeps the itv route selection after playlist bootstrap', async () => {
        router.url = `/workspace/stalker/${PLAYLIST_ID}/itv`;

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(stalkerStore.resetCategories).toHaveBeenCalled();
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            ACTIVE_PLAYLIST
        );
        expect(connectionFlow.ensureConnected).toHaveBeenCalledWith(
            ACTIVE_PLAYLIST
        );
        expect(
            connectionFlow.ensureConnected.mock.invocationCallOrder[0]
        ).toBeLessThan(
            stalkerStore.setCurrentPlaylist.mock.invocationCallOrder[0]
        );
        expect(stalkerStore.setSelectedContentType).toHaveBeenCalledWith('itv');
        expect(selectedContentType()).toBe('itv');
        expect(
            stalkerStore.setSelectedContentType.mock.invocationCallOrder[0]
        ).toBeGreaterThan(
            stalkerStore.setCurrentPlaylist.mock.invocationCallOrder[0]
        );
    });

    it('keeps the radio route selection after playlist bootstrap', async () => {
        router.url = `/workspace/stalker/${PLAYLIST_ID}/radio`;

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(stalkerStore.setSelectedContentType).toHaveBeenCalledWith(
            'radio'
        );
        expect(selectedContentType()).toBe('radio');
        expect(stalkerStore.setSelectedCategory).toHaveBeenCalledWith(null);
        expect(stalkerStore.clearSelectedItem).toHaveBeenCalled();
        expect(stalkerStore.setSearchPhrase).toHaveBeenCalledWith('');
    });

    it('loads the full Stalker playlist when the active route meta lacks auth fields', async () => {
        activePlaylist.set(ACTIVE_PLAYLIST);
        playlistsService.getPlaylistById.mockReturnValue(
            of(FULL_STALKER_PLAYLIST)
        );

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(playlistsService.getPlaylistById).toHaveBeenCalledWith(
            PLAYLIST_ID
        );
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
    });

    it('falls back to the active playlist when the full playlist lookup completes empty', async () => {
        activePlaylist.set(ACTIVE_PLAYLIST);
        playlistsService.getPlaylistById.mockReturnValue(EMPTY);

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(playlistsService.getPlaylistById).toHaveBeenCalledWith(
            PLAYLIST_ID
        );
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            ACTIVE_PLAYLIST
        );
    });

    it('uses active Stalker playlist metadata directly when the portal mode is explicit', async () => {
        activePlaylist.set(FULL_STALKER_PLAYLIST);

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(playlistsService.getPlaylistById).not.toHaveBeenCalled();
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
    });

    it('does not expose a playlist to catalog resources when connection flow is cancelled', async () => {
        connectionFlow.ensureConnected.mockResolvedValueOnce(undefined);

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(stalkerStore.setCurrentPlaylist).not.toHaveBeenCalled();
    });

    it('cancels a provisional route attempt before leaving the Stalker workspace', async () => {
        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();
        router.url = '/workspace/m3u/playlist-2';
        playlistContext.syncFromUrl.mockReturnValueOnce({
            inWorkspace: true,
            playlistId: 'playlist-2',
            provider: 'm3u',
            section: null,
        });

        routerEvents.next(
            new NavigationEnd(
                2,
                `/workspace/stalker/${PLAYLIST_ID}/vod`,
                router.url
            )
        );
        await flushEffects();

        expect(connectionFlow.cancel).toHaveBeenCalledTimes(1);
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenLastCalledWith(
            undefined
        );
    });

    it('activates a connection completed by Save Again while the route is still current', async () => {
        connectionFlow.ensureConnected.mockResolvedValueOnce(undefined);
        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        connectionReady.next(FULL_STALKER_PLAYLIST);
        await flushEffects();

        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
    });
});
