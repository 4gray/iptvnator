import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ChannelActions, FavoritesActions } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistsService } from '@iptvnator/services';
import { Channel, Playlist } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { M3uWorkspaceRouteSession } from './m3u-workspace-route-session.service';

const PLAYLIST_ID = 'playlist-1';
const NEXT_PLAYLIST_ID = 'playlist-2';

const PRIMARY_CHANNEL = {
    epgParams: '',
    http: {
        origin: '',
        referrer: '',
        'user-agent': '',
    },
    id: 'channel-1',
    name: 'Primary channel',
    radio: 'false',
    tvg: {
        id: 'primary-channel',
        logo: '',
        name: 'Primary channel',
        rec: '',
        url: '',
    },
    url: 'https://example.com/primary.m3u8',
} as Channel;

const NEXT_CHANNEL = {
    ...PRIMARY_CHANNEL,
    id: 'channel-2',
    name: 'Next channel',
    tvg: {
        ...PRIMARY_CHANNEL.tvg,
        id: 'next-channel',
        name: 'Next channel',
    },
    url: 'https://example.com/next.m3u8',
} as Channel;

async function flushEffects(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function getM3uRouteContext(url: string): {
    inWorkspace: boolean;
    playlistId: string | null;
    provider: 'playlists' | null;
    section: 'all' | 'favorites' | 'groups' | 'recent' | null;
} {
    const match = url.match(
        /^\/workspace\/playlists\/([^/]+)\/([^/?]+)(?:\/|$)/
    );

    return {
        inWorkspace: true,
        playlistId: match?.[1] ?? null,
        provider: match ? 'playlists' : null,
        section:
            (match?.[2] as 'all' | 'favorites' | 'groups' | 'recent' | null) ??
            null,
    };
}

describe('M3uWorkspaceRouteSession', () => {
    const routerEvents = new Subject<NavigationEnd>();
    const playlistContext = {
        syncFromUrl: jest.fn(),
    };
    const playlistsService = {
        getPlaylist: jest.fn(),
    };
    const store = {
        dispatch: jest.fn(),
    };
    const router = {
        url: `/workspace/playlists/${PLAYLIST_ID}/all`,
        events: routerEvents.asObservable(),
    };

    beforeEach(async () => {
        router.url = `/workspace/playlists/${PLAYLIST_ID}/all`;
        playlistContext.syncFromUrl.mockImplementation((url: string) =>
            getM3uRouteContext(url)
        );
        playlistsService.getPlaylist.mockReset();
        store.dispatch.mockClear();

        await TestBed.configureTestingModule({
            providers: [
                M3uWorkspaceRouteSession,
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
                    provide: Store,
                    useValue: store,
                },
            ],
        });
    });

    it('does not start channel loading for collection routes like favorites', async () => {
        router.url = `/workspace/playlists/${PLAYLIST_ID}/favorites`;

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        expect(store.dispatch).toHaveBeenCalledWith(
            ChannelActions.resetActiveChannel()
        );
        expect(store.dispatch).toHaveBeenCalledWith(
            ChannelActions.setChannelsLoading({ loading: false })
        );
        expect(playlistsService.getPlaylist).not.toHaveBeenCalled();
    });

    it('ignores stale playlist responses after a newer route request wins', async () => {
        const firstResponse = new Subject<Playlist>();
        const secondResponse = new Subject<Playlist>();

        playlistsService.getPlaylist.mockImplementation((playlistId: string) => {
            return playlistId === PLAYLIST_ID
                ? firstResponse.asObservable()
                : secondResponse.asObservable();
        });

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        router.url = `/workspace/playlists/${NEXT_PLAYLIST_ID}/all`;
        routerEvents.next(new NavigationEnd(1, router.url, router.url));
        await flushEffects();

        secondResponse.next({
            favorites: [NEXT_CHANNEL.url],
            playlist: {
                items: [NEXT_CHANNEL],
            },
        } as Playlist);
        secondResponse.complete();
        await flushEffects();

        firstResponse.next({
            favorites: [PRIMARY_CHANNEL.url],
            playlist: {
                items: [PRIMARY_CHANNEL],
            },
        } as Playlist);
        firstResponse.complete();
        await flushEffects();

        const setChannelsCalls = store.dispatch.mock.calls.filter(
            ([action]) => action.type === ChannelActions.setChannels.type
        );

        expect(setChannelsCalls).toEqual([
            [ChannelActions.setChannels({ channels: [NEXT_CHANNEL] })],
        ]);
        expect(store.dispatch).toHaveBeenCalledWith(
            FavoritesActions.setFavorites({
                channelIds: [NEXT_CHANNEL.url],
            })
        );
    });
});
