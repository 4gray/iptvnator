import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { EMPTY, Observable, Subject, of } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerWorkspaceRouteSession } from './stalker-workspace-route-session.service';

const PLAYLIST_ID = 'stalker-1';
const ACTIVE_PLAYLIST: PlaylistMeta = {
    _id: PLAYLIST_ID,
    filename: 'stalker.m3u',
    macAddress: '00:1A:79:12:34:56',
    portalUrl: 'http://localhost/stalker_portal/server/load.php',
    title: 'Test Stalker',
} as PlaylistMeta;

const OTHER_PLAYLIST_ID = 'stalker-2';
const OTHER_PLAYLIST: PlaylistMeta = {
    ...ACTIVE_PLAYLIST,
    _id: OTHER_PLAYLIST_ID,
    title: 'Other Stalker',
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
    // The route session serializes its syncs on a promise queue, so settling
    // one arrival costs several microtask hops rather than a fixed two.
    for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
    }
}

function getStalkerSectionFromUrl(url: string): string | null {
    const match = url.match(/^\/workspace\/stalker\/[^/]+\/([^/?]+)(?:\/|$)/);

    return match?.[1] ?? null;
}

describe('StalkerWorkspaceRouteSession', () => {
    const routerEvents = new Subject<NavigationEnd>();
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
        // mockClear keeps a return value a previous case installed, so restore
        // the default here: a leaked pending observable hangs the next sync.
        playlistsService.getPlaylistById.mockReturnValue(of(ACTIVE_PLAYLIST));

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
    it('stays unready until an overlapping sync has installed the portal row', async () => {
        // The constructor starts one sync; a NavigationEnd starts a second
        // while the first is still awaiting the playlist. The second must not
        // skip the bootstrap and report ready against the previous row.
        let releasePlaylist: (playlist: PlaylistMeta) => void = () => undefined;
        playlistsService.getPlaylistById.mockReturnValue(
            new Observable<PlaylistMeta>((subscriber) => {
                releasePlaylist = (playlist) => {
                    subscriber.next(playlist);
                    subscriber.complete();
                };
            })
        );

        const session = TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(stalkerStore.setCurrentPlaylist).not.toHaveBeenCalled();

        routerEvents.next(
            new NavigationEnd(1, router.url, router.url) as NavigationEnd
        );
        await flushEffects();

        expect(session.isReady()).toBe(false);

        releasePlaylist(FULL_STALKER_PLAYLIST);
        await flushEffects();
        await flushEffects();

        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledTimes(1);
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            FULL_STALKER_PLAYLIST
        );
        expect(session.isReady()).toBe(true);
    });

    it('does not let a superseded sync publish readiness', async () => {
        const session = TestBed.inject(StalkerWorkspaceRouteSession);
        await flushEffects();

        expect(session.isReady()).toBe(true);

        let releaseSecond: (playlist: PlaylistMeta) => void = () => undefined;
        playlistsService.getPlaylistById.mockReturnValue(
            new Observable<PlaylistMeta>((subscriber) => {
                releaseSecond = (playlist) => {
                    subscriber.next(playlist);
                    subscriber.complete();
                };
            })
        );

        // Arrive at a DIFFERENT portal, then immediately at a third: the
        // first arrival must not flip readiness back on behind the newest one.
        activePlaylist.set(null);
        router.url = `/workspace/stalker/${OTHER_PLAYLIST_ID}/itv`;
        playlistContext.syncFromUrl.mockImplementation((url: string) => ({
            inWorkspace: true,
            provider: 'stalker',
            playlistId: OTHER_PLAYLIST_ID,
            section: getStalkerSectionFromUrl(url) as 'itv',
        }));

        routerEvents.next(
            new NavigationEnd(2, router.url, router.url) as NavigationEnd
        );
        await flushEffects();
        routerEvents.next(
            new NavigationEnd(3, router.url, router.url) as NavigationEnd
        );
        await flushEffects();

        expect(session.isReady()).toBe(false);

        releaseSecond(OTHER_PLAYLIST);
        await flushEffects();
        await flushEffects();

        expect(session.isReady()).toBe(true);
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            OTHER_PLAYLIST
        );
    });
});
