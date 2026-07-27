/* eslint-disable max-lines -- route lifecycle and navigation race matrix is kept together */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { EMPTY, Subject, of } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    StalkerSessionService,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
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
    stalkerRecipeClassifierVersion: 1,
    stalkerRequestRecipe: 'full-session',
    stalkerSerialNumber: 'CUSTOMSN123',
    stalkerDeviceId1: 'DEVICE-ID-1',
    stalkerDeviceId2: 'DEVICE-ID-2',
    stalkerSignature1: 'SIGNATURE-1',
    stalkerSignature2: 'SIGNATURE-2',
} as PlaylistMeta;

async function flushEffects(): Promise<void> {
    for (let index = 0; index < 12; index += 1) {
        await Promise.resolve();
    }
}

function createDeferred<T>(): {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
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
        ensureConnected: jest.fn(async (playlist: PlaylistMeta) => playlist),
        offerRetry: jest.fn(),
    };

    const session = {
        activate: jest.fn().mockResolvedValue({
            action: 'activate',
            kind: 'success',
            requestId: 'activate-success',
        }),
        close: jest.fn().mockResolvedValue({
            action: 'close',
            kind: 'success',
            requestId: 'close-success',
        }),
        deactivate: jest.fn().mockResolvedValue({
            action: 'deactivate',
            kind: 'success',
            requestId: 'deactivate-success',
        }),
        getLeaseRef: jest.fn((playlistId: string) => `lease-${playlistId}`),
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
        playlistsService.getPlaylistById.mockImplementation(() =>
            of(ACTIVE_PLAYLIST)
        );
        connectionFlow.cancel.mockClear();
        connectionFlow.ensureConnected.mockClear();
        connectionFlow.offerRetry.mockClear();
        session.activate.mockClear();
        session.close.mockClear();
        session.deactivate.mockClear();
        session.getLeaseRef.mockClear();
        session.getLeaseRef.mockImplementation(
            (playlistId: string) => `lease-${playlistId}`
        );

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
                {
                    provide: StalkerSessionService,
                    useValue: session,
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
        expect(session.activate).toHaveBeenCalledWith(`lease-${PLAYLIST_ID}`);
        expect(session.activate.mock.invocationCallOrder[0]).toBeLessThan(
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

    it('uses active Stalker playlist metadata directly when its recipe is current', async () => {
        activePlaylist.set(FULL_STALKER_PLAYLIST);

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(playlistsService.getPlaylistById).not.toHaveBeenCalled();
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
    });

    it('does not let a legacy boolean on temporary route metadata shadow the full stored playlist', async () => {
        activePlaylist.set({
            ...ACTIVE_PLAYLIST,
            isFullStalkerPortal: false,
            title: 'Untitled playlist',
        });
        playlistsService.getPlaylistById.mockReturnValue(
            of(FULL_STALKER_PLAYLIST)
        );

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(playlistsService.getPlaylistById).toHaveBeenCalledWith(
            PLAYLIST_ID
        );
        expect(connectionFlow.ensureConnected).toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
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

    it('offers a retry instead of exposing a playlist when lease activation fails', async () => {
        session.activate.mockResolvedValueOnce({
            kind: 'failure',
            reason: 'portal-unavailable',
            requestId: 'activate-failure',
            retryable: true,
            stage: 'ready',
        });

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(connectionFlow.offerRetry).toHaveBeenCalledWith(
            expect.objectContaining({ _id: PLAYLIST_ID }),
            'portal-unavailable'
        );
        expect(stalkerStore.setCurrentPlaylist).not.toHaveBeenCalled();
    });

    it('does not let a stale activation failure close or retry a newer lease for the same playlist', async () => {
        const staleActivation = createDeferred<{
            kind: 'failure';
            reason: string;
            requestId: string;
            retryable: boolean;
            stage: 'ready';
        }>();
        let currentLeaseRef = 'lease-stale';
        session.getLeaseRef.mockImplementation(() => currentLeaseRef);
        session.activate
            .mockReturnValueOnce(staleActivation.promise)
            .mockResolvedValueOnce({
                action: 'activate',
                kind: 'success',
                requestId: 'activate-current',
            });

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();
        expect(session.activate).toHaveBeenCalledWith('lease-stale');

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

        currentLeaseRef = 'lease-current';
        router.url = `/workspace/stalker/${PLAYLIST_ID}/vod`;
        routerEvents.next(
            new NavigationEnd(
                3,
                '/workspace/m3u/playlist-2',
                router.url
            )
        );
        await flushEffects();
        expect(session.activate).toHaveBeenLastCalledWith('lease-current');
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenLastCalledWith(
            expect.objectContaining({ _id: PLAYLIST_ID })
        );

        staleActivation.resolve({
            kind: 'failure',
            reason: 'stale-portal-unavailable',
            requestId: 'activate-stale-failure',
            retryable: true,
            stage: 'ready',
        });
        await flushEffects();

        expect(session.deactivate).not.toHaveBeenCalledWith('lease-current');
        expect(session.close).not.toHaveBeenCalledWith('lease-current');
        expect(connectionFlow.offerRetry).not.toHaveBeenCalled();
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
        expect(session.deactivate).toHaveBeenCalledWith(`lease-${PLAYLIST_ID}`);
        expect(session.close).toHaveBeenCalledWith(`lease-${PLAYLIST_ID}`);
        expect(session.deactivate.mock.invocationCallOrder[0]).toBeLessThan(
            session.close.mock.invocationCallOrder[0]
        );
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

    it('does not connect a stale playlist after its lookup resolves behind a newer route', async () => {
        const staleLookup = new Subject<PlaylistMeta>();
        const nextPlaylist = {
            ...FULL_STALKER_PLAYLIST,
            _id: 'stalker-2',
            title: 'Second Stalker',
        };
        playlistsService.getPlaylistById.mockImplementation(
            (playlistId: string) =>
                playlistId === PLAYLIST_ID
                    ? staleLookup.asObservable()
                    : of(nextPlaylist)
        );
        playlistContext.syncFromUrl.mockImplementation((url: string) => {
            const match = url.match(
                /^\/workspace\/stalker\/([^/]+)\/([^/?]+)(?:\/|$)/
            );
            return {
                inWorkspace: true,
                provider: match ? 'stalker' : null,
                playlistId: match?.[1] ?? null,
                section: (match?.[2] ?? null) as
                    | 'favorites'
                    | 'itv'
                    | 'radio'
                    | 'recent'
                    | 'search'
                    | 'series'
                    | 'vod'
                    | null,
            };
        });

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();
        expect(playlistsService.getPlaylistById).toHaveBeenCalledWith(
            PLAYLIST_ID
        );

        router.url = '/workspace/stalker/stalker-2/series';
        routerEvents.next(
            new NavigationEnd(
                2,
                `/workspace/stalker/${PLAYLIST_ID}/vod`,
                router.url
            )
        );
        await flushEffects();

        expect(connectionFlow.ensureConnected).toHaveBeenCalledWith(
            nextPlaylist
        );

        staleLookup.next(FULL_STALKER_PLAYLIST);
        staleLookup.complete();
        await flushEffects();

        expect(connectionFlow.ensureConnected).not.toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
        expect(stalkerStore.setCurrentPlaylist).not.toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            nextPlaylist
        );
    });

    it('keeps a newer section while the same playlist connection is still completing', async () => {
        const deferredConnection = createDeferred<PlaylistMeta>();
        connectionFlow.ensureConnected.mockReturnValueOnce(
            deferredConnection.promise
        );

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();
        expect(connectionFlow.ensureConnected).toHaveBeenCalledTimes(1);

        router.url = `/workspace/stalker/${PLAYLIST_ID}/itv`;
        routerEvents.next(
            new NavigationEnd(
                2,
                `/workspace/stalker/${PLAYLIST_ID}/vod`,
                router.url
            )
        );
        await flushEffects();
        expect(selectedContentType()).toBe('itv');

        deferredConnection.resolve(FULL_STALKER_PLAYLIST);
        await flushEffects();

        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
        expect(selectedContentType()).toBe('itv');
    });

    it('closes the old lease before activating a switched Stalker playlist', async () => {
        const nextPlaylist = {
            ...FULL_STALKER_PLAYLIST,
            _id: 'stalker-2',
            title: 'Second Stalker',
        };
        playlistsService.getPlaylistById.mockImplementation(
            (playlistId: string) =>
                of(
                    playlistId === PLAYLIST_ID
                        ? FULL_STALKER_PLAYLIST
                        : nextPlaylist
                )
        );
        playlistContext.syncFromUrl.mockImplementation((url: string) => {
            const match = url.match(
                /^\/workspace\/stalker\/([^/]+)\/([^/?]+)(?:\/|$)/
            );
            return {
                inWorkspace: true,
                provider: match ? 'stalker' : null,
                playlistId: match?.[1] ?? null,
                section: (match?.[2] ?? null) as
                    | 'favorites'
                    | 'itv'
                    | 'radio'
                    | 'recent'
                    | 'search'
                    | 'series'
                    | 'vod'
                    | null,
            };
        });

        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        router.url = '/workspace/stalker/stalker-2/vod';
        routerEvents.next(
            new NavigationEnd(
                2,
                `/workspace/stalker/${PLAYLIST_ID}/vod`,
                router.url
            )
        );
        await flushEffects();

        expect(session.deactivate).toHaveBeenCalledWith(`lease-${PLAYLIST_ID}`);
        expect(session.close).toHaveBeenCalledWith(`lease-${PLAYLIST_ID}`);
        expect(session.activate).toHaveBeenCalledWith('lease-stalker-2');
        expect(session.close.mock.invocationCallOrder[0]).toBeLessThan(
            session.activate.mock.invocationCallOrder.at(-1) as number
        );
    });

    it('deactivates and closes the current lease when the route provider is destroyed', async () => {
        TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();
        session.deactivate.mockClear();
        session.close.mockClear();

        TestBed.resetTestingModule();
        await flushEffects();

        expect(session.deactivate).toHaveBeenCalledWith(`lease-${PLAYLIST_ID}`);
        expect(session.close).toHaveBeenCalledWith(`lease-${PLAYLIST_ID}`);
    });
});
