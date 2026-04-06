import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from 'services';
import { PlaylistMeta } from 'shared-interfaces';
import { StalkerWorkspaceRouteSession } from './stalker-workspace-route-session.service';

const PLAYLIST_ID = 'stalker-1';
const ACTIVE_PLAYLIST: PlaylistMeta = {
    _id: PLAYLIST_ID,
    filename: 'stalker.m3u',
    macAddress: '00:1A:79:12:34:56',
    portalUrl: 'http://localhost/stalker_portal/server/load.php',
    title: 'Test Stalker',
} as PlaylistMeta;

async function flushEffects(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function getStalkerSectionFromUrl(url: string): string | null {
    const match = url.match(
        /^\/workspace\/stalker\/[^/]+\/([^/?]+)(?:\/|$)/
    );

    return match?.[1] ?? null;
}

describe('StalkerWorkspaceRouteSession', () => {
    const routerEvents = new Subject<NavigationEnd>();
    const activePlaylist = signal<PlaylistMeta | null>(ACTIVE_PLAYLIST);
    const selectedContentType = signal<'vod' | 'itv' | 'series'>('vod');

    const playlistContext = {
        activePlaylist,
        syncFromUrl: jest.fn(),
    };

    const stalkerStore = {
        resetCategories: jest.fn(),
        setSelectedCategory: jest.fn(),
        clearSelectedItem: jest.fn(),
        setCurrentPlaylist: jest.fn().mockResolvedValue(undefined),
        setSelectedContentType: jest.fn((type: 'vod' | 'itv' | 'series') => {
            selectedContentType.set(type);
        }),
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
});
