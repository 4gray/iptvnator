import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import {
    ChannelActions,
    FavoritesActions,
    PlaylistActions,
} from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistsService } from '@iptvnator/services';
import { Channel, Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';
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
    const playlistEntities = new BehaviorSubject<
        Record<string, PlaylistMeta | undefined>
    >({});
    const store = {
        dispatch: jest.fn(),
        select: jest.fn(() => playlistEntities.asObservable()),
        selectSignal: jest.fn(() => () => playlistEntities.value),
    };
    const electronApi = {
        setUserAgent: jest.fn().mockResolvedValue(true),
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
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: electronApi,
        });
        electronApi.setUserAgent.mockClear();
        playlistsService.getPlaylist.mockReset();
        store.dispatch.mockClear();
        playlistEntities.next({
            [PLAYLIST_ID]: { _id: PLAYLIST_ID } as PlaylistMeta,
        });

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

    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
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

    it('configures playlist-level user agent overrides when loading channels', async () => {
        playlistsService.getPlaylist.mockReturnValue(
            of({
                playlist: {
                    items: [PRIMARY_CHANNEL],
                },
                referrer: 'https://portal.example/referrer',
                userAgent: 'PlaylistAgent/1.0',
            } as Playlist)
        );

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        expect(electronApi.setUserAgent).toHaveBeenCalledWith(
            'PlaylistAgent/1.0',
            'https://portal.example/referrer'
        );
    });

    it('clears stale playlist-level user agent overrides when the playlist has none', async () => {
        playlistsService.getPlaylist.mockReturnValue(
            of({
                playlist: {
                    items: [PRIMARY_CHANNEL],
                },
            } as Playlist)
        );

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        expect(electronApi.setUserAgent).toHaveBeenCalledWith(
            undefined,
            undefined
        );
    });

    it('hydrates persisted favorites without dispatching the persistence action', async () => {
        playlistsService.getPlaylist.mockReturnValue(
            of({
                favorites: [PRIMARY_CHANNEL.url],
                playlist: {
                    items: [PRIMARY_CHANNEL],
                },
            } as Playlist)
        );

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        expect(store.dispatch).toHaveBeenCalledWith(
            FavoritesActions.hydrateFavorites({
                channelIds: [PRIMARY_CHANNEL.url],
            })
        );
        expect(
            store.dispatch.mock.calls.some(
                ([action]) => action.type === FavoritesActions.setFavorites.type
            )
        ).toBe(false);
    });

    it('hydrates the hidden groups the startup metadata list leaves out, before the channels (#1894)', async () => {
        playlistsService.getPlaylist.mockReturnValue(
            of({
                hiddenGroupTitles: ['Sports'],
                playlist: {
                    items: [PRIMARY_CHANNEL],
                },
            } as Playlist)
        );

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        const types = store.dispatch.mock.calls.map(([action]) => action.type);
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: PLAYLIST_ID,
                    hiddenGroupTitles: ['Sports'],
                } as PlaylistMeta,
                persist: false,
            })
        );
        expect(
            types.indexOf(PlaylistActions.updatePlaylistMeta.type)
        ).toBeLessThan(types.indexOf(ChannelActions.setChannels.type));
    });

    it('hydrates no hidden groups for a playlist that never saved any', async () => {
        playlistsService.getPlaylist.mockReturnValue(
            of({ playlist: { items: [PRIMARY_CHANNEL] } } as Playlist)
        );

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: PLAYLIST_ID,
                    hiddenGroupTitles: [] as string[],
                } as PlaylistMeta,
                persist: false,
            })
        );
    });

    it('keeps hidden groups saved while the playlist read was queued', async () => {
        const response = new Subject<Playlist>();
        playlistsService.getPlaylist.mockReturnValue(response.asObservable());

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        // The dialog's save lands in the store before the queued read returns
        // the row as it was before that save.
        playlistEntities.next({
            [PLAYLIST_ID]: {
                _id: PLAYLIST_ID,
                hiddenGroupTitles: ['News'],
            } as PlaylistMeta,
        });
        response.next({
            hiddenGroupTitles: [] as string[],
            playlist: { items: [PRIMARY_CHANNEL] },
        } as Playlist);
        response.complete();
        await flushEffects();

        expect(store.dispatch).toHaveBeenCalledWith(
            ChannelActions.setChannels({ channels: [PRIMARY_CHANNEL] })
        );
        expect(
            store.dispatch.mock.calls.some(
                ([action]) =>
                    action.type === PlaylistActions.updatePlaylistMeta.type
            )
        ).toBe(false);
    });

    it('waits for the startup inventory when a restored route reads the playlist first', async () => {
        playlistEntities.next({});
        playlistsService.getPlaylist.mockReturnValue(
            of({
                hiddenGroupTitles: ['Sports'],
                playlist: { items: [PRIMARY_CHANNEL] },
            } as Playlist)
        );
        const hydration = PlaylistActions.updatePlaylistMeta({
            playlist: {
                _id: PLAYLIST_ID,
                hiddenGroupTitles: ['Sports'],
            } as PlaylistMeta,
            persist: false,
        });

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        // An update for an entity that is not in the store yet is dropped.
        expect(store.dispatch).not.toHaveBeenCalledWith(hydration);

        playlistEntities.next({
            [PLAYLIST_ID]: { _id: PLAYLIST_ID } as PlaylistMeta,
        });

        expect(store.dispatch).toHaveBeenCalledWith(hydration);
        expect(
            store.dispatch.mock.calls.filter(
                ([action]) =>
                    action.type === PlaylistActions.updatePlaylistMeta.type
            )
        ).toHaveLength(1);
    });

    it('clears in-memory favorites without dispatching persistence when playlist loading fails', async () => {
        playlistsService.getPlaylist.mockReturnValue(
            throwError(() => new Error('Playlist loading failed'))
        );

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        expect(store.dispatch).toHaveBeenCalledWith(
            ChannelActions.setChannels({ channels: [] })
        );
        expect(store.dispatch).toHaveBeenCalledWith(
            FavoritesActions.hydrateFavorites({ channelIds: [] })
        );
        expect(
            store.dispatch.mock.calls.some(
                ([action]) => action.type === FavoritesActions.setFavorites.type
            )
        ).toBe(false);
    });

    it('ignores stale playlist responses after a newer route request wins', async () => {
        const firstResponse = new Subject<Playlist>();
        const secondResponse = new Subject<Playlist>();

        playlistsService.getPlaylist.mockImplementation(
            (playlistId: string) => {
                return playlistId === PLAYLIST_ID
                    ? firstResponse.asObservable()
                    : secondResponse.asObservable();
            }
        );

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
            FavoritesActions.hydrateFavorites({
                channelIds: [NEXT_CHANNEL.url],
            })
        );
    });
});
