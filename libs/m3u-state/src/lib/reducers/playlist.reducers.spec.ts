import { createReducer } from '@ngrx/store';
import { PlaylistActions } from '../actions';
import { playlistsAdapter } from '../playlists.state';
import { initialState } from '../state';
import { playlistReducers } from './playlist.reducers';
import { Channel, Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';

const reducer = createReducer(initialState, ...playlistReducers);

describe('playlistReducers', () => {
    it('keeps a failed initial inventory unready until a retry succeeds', () => {
        const failed = reducer(
            initialState,
            PlaylistActions.loadPlaylistsFailure()
        );
        expect(failed.playlists.loadFailed).toBe(true);
        expect(failed.playlists.allPlaylistsLoaded).toBe(false);
        const retrying = reducer(failed, PlaylistActions.loadPlaylists());
        expect(retrying.playlists.loadFailed).toBe(false);
        expect(retrying.playlists.allPlaylistsLoaded).toBe(false);
        const recovered = reducer(
            retrying,
            PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
        );
        expect(recovered.playlists.loadFailed).toBe(false);
        expect(recovered.playlists.allPlaylistsLoaded).toBe(true);
    });

    it('clears readiness when a backup replaces an already loaded inventory', () => {
        const loaded = reducer(
            initialState,
            PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
        );
        const emptied = reducer(loaded, PlaylistActions.removeAllPlaylists());
        const loading = reducer(emptied, PlaylistActions.loadPlaylists());
        expect(loading.playlists.allPlaylistsLoaded).toBe(false);
        const failed = reducer(loading, PlaylistActions.loadPlaylistsFailure());
        expect(failed.playlists.allPlaylistsLoaded).toBe(false);
        expect(failed.playlists.loadFailed).toBe(true);
        const retrying = reducer(failed, PlaylistActions.loadPlaylists());
        expect(retrying.playlists.allPlaylistsLoaded).toBe(false);
        expect(retrying.playlists.loadFailed).toBe(false);
        const recovered = reducer(
            retrying,
            PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
        );
        expect(recovered.playlists.allPlaylistsLoaded).toBe(true);
        expect(recovered.playlists.loadFailed).toBe(false);
    });

    it('persists updateDate and hiddenGroupTitles when playlist meta is updated', () => {
        const existingPlaylist: PlaylistMeta = {
            _id: 'playlist-1',
            title: 'Xtream Playlist',
            count: 0,
            importDate: '2026-03-28T00:00:00.000Z',
            autoRefresh: false,
            serverUrl: 'http://localhost:8080',
            username: 'demo',
            password: 'secret',
        };
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(
                existingPlaylist,
                initialState.playlists
            ),
        };

        const nextState = reducer(
            state,
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    ...existingPlaylist,
                    hiddenGroupTitles: ['Movies', 'News'],
                    updateDate: 1712145600000,
                },
            })
        );

        expect(nextState.playlists.entities['playlist-1']?.updateDate).toBe(
            1712145600000
        );
        expect(
            nextState.playlists.entities['playlist-1']?.hiddenGroupTitles
        ).toEqual(['Movies', 'News']);
    });

    it('updates a resolved Stalker connection and projects the transient session patch', () => {
        const existingPlaylist = {
            _id: 'stalker-1',
            title: 'Stalker Portal',
            count: 0,
            importDate: '2026-08-08T00:00:00.000Z',
            portalUrl: 'https://old.example.com/portal.php',
            macAddress: '00:1A:79:AA:BB:CC',
            isFullStalkerPortal: false,
            stalkerSerialNumber: 'OLD-SERIAL',
        } as PlaylistMeta;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(
                existingPlaylist,
                initialState.playlists
            ),
        };

        const nextState = reducer(
            state,
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    ...existingPlaylist,
                    portalUrl: 'https://new.example.com/server/load.php',
                    isFullStalkerPortal: true,
                    macAddress: '00:1A:79:DD:EE:FF',
                    username: 'subscriber',
                    password: 'secret',
                    stalkerSerialNumber: 'NEW-SERIAL',
                    stalkerDeviceId1: 'DEVICE-1',
                    stalkerDeviceId2: 'DEVICE-2',
                    stalkerSignature1: 'SIGNATURE-1',
                    stalkerSignature2: 'SIGNATURE-2',
                    stalkerSessionPatch: {
                        stalkerToken: 'NEW_TOKEN',
                        stalkerSessionIdentity: 'new-fingerprint',
                        stalkerWatchdogTimeout: 90,
                        stalkerTimeslot: 3,
                        stalkerAccountInfo: {
                            login: 'subscriber',
                            status: 1,
                        },
                    },
                },
            })
        );
        const stored = nextState.playlists.entities['stalker-1'];

        expect(stored).toEqual(
            expect.objectContaining({
                portalUrl: 'https://new.example.com/server/load.php',
                isFullStalkerPortal: true,
                macAddress: '00:1A:79:DD:EE:FF',
                username: 'subscriber',
                password: 'secret',
                stalkerSerialNumber: 'NEW-SERIAL',
                stalkerDeviceId1: 'DEVICE-1',
                stalkerDeviceId2: 'DEVICE-2',
                stalkerSignature1: 'SIGNATURE-1',
                stalkerSignature2: 'SIGNATURE-2',
                stalkerToken: 'NEW_TOKEN',
                stalkerSessionIdentity: 'new-fingerprint',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 3,
                stalkerAccountInfo: {
                    login: 'subscriber',
                    status: 1,
                },
            })
        );
        expect(stored).not.toHaveProperty('stalkerSessionPatch');
    });

    it('clears the active Stalker session when the transient patch is null', () => {
        const existingPlaylist = {
            _id: 'stalker-1',
            title: 'Stalker Portal',
            count: 0,
            importDate: '2026-08-08T00:00:00.000Z',
            portalUrl: 'https://old.example.com/server/load.php',
            macAddress: '00:1A:79:AA:BB:CC',
            stalkerToken: 'OLD_TOKEN',
            stalkerSessionIdentity: 'old-fingerprint',
            stalkerWatchdogTimeout: 120,
            stalkerTimeslot: 7,
            stalkerAccountInfo: { login: 'old-user' },
        } as Playlist;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(
                existingPlaylist,
                initialState.playlists
            ),
        };

        const nextState = reducer(
            state,
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    ...existingPlaylist,
                    stalkerSessionPatch: null,
                },
            })
        );
        const stored = nextState.playlists.entities['stalker-1'];

        expect(stored).toEqual(
            expect.objectContaining({
                stalkerToken: undefined,
                stalkerSessionIdentity: undefined,
                stalkerWatchdogTimeout: undefined,
                stalkerTimeslot: undefined,
                stalkerAccountInfo: undefined,
            })
        );
        expect(stored).not.toHaveProperty('stalkerSessionPatch');
    });

    it('updates the active playlist channel cache and clears loading on playlist refresh', () => {
        const refreshedChannel = {
            epgParams: '',
            http: {
                origin: '',
                referrer: '',
                'user-agent': '',
            },
            id: 'channel-1',
            name: 'Refreshed TV',
            radio: 'false',
            tvg: {
                id: 'channel-1',
                logo: '',
                name: 'Refreshed TV',
                rec: '',
                url: '',
            },
            url: 'https://example.com/refreshed.m3u8',
        } as Channel;
        const existingPlaylist: PlaylistMeta = {
            _id: 'playlist-1',
            count: 1,
            importDate: '2026-03-28T00:00:00.000Z',
            title: 'Playlist One',
        } as PlaylistMeta;
        const refreshedPlaylist = {
            playlist: {
                items: [refreshedChannel],
            },
        } as Playlist;
        const state = {
            ...initialState,
            channelsLoading: true,
            playlists: playlistsAdapter.addOne(existingPlaylist, {
                ...initialState.playlists,
                selectedId: 'playlist-1',
            }),
        };

        const nextState = reducer(
            state,
            PlaylistActions.updatePlaylist({
                playlist: refreshedPlaylist,
                playlistId: 'playlist-1',
            })
        );

        expect(nextState.channels).toEqual([refreshedChannel]);
        expect(nextState.channelsLoading).toBe(false);
    });

    it.each([undefined, '', 'Replacement/2.0'])(
        'preserves the saved User-Agent unless refresh explicitly replaces it: %s',
        (userAgent) => {
            const existing = {
                _id: 'playlist-1',
                userAgent: 'IPTVnator-Test/1.0',
            } as PlaylistMeta;
            const state = {
                ...initialState,
                playlists: playlistsAdapter.addOne(
                    existing,
                    initialState.playlists
                ),
            };
            const nextState = reducer(
                state,
                PlaylistActions.updatePlaylist({
                    playlistId: existing._id,
                    playlist: {
                        playlist: { items: [] },
                        ...(userAgent !== undefined ? { userAgent } : {}),
                    } as Playlist,
                })
            );
            expect(nextState.playlists.entities[existing._id]?.userAgent).toBe(
                userAgent ?? existing.userAgent
            );
        }
    );

    it('keeps hiddenGroupTitles on playlist refresh when the refreshed payload omits them', () => {
        const existingPlaylist: PlaylistMeta = {
            _id: 'playlist-1',
            count: 1,
            hiddenGroupTitles: ['Radio-de'],
            importDate: '2026-03-28T00:00:00.000Z',
            title: 'Playlist One',
        } as PlaylistMeta;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(existingPlaylist, {
                ...initialState.playlists,
                selectedId: 'playlist-1',
            }),
        };

        const nextState = reducer(
            state,
            PlaylistActions.updatePlaylist({
                playlist: {
                    playlist: {
                        items: [],
                    },
                } as Playlist,
                playlistId: 'playlist-1',
            })
        );

        expect(
            nextState.playlists.entities['playlist-1']?.hiddenGroupTitles
        ).toEqual(['Radio-de']);
    });

    it('keeps autoRefresh enabled on playlist refresh when the parser payload defaults it to false', () => {
        const existingPlaylist: PlaylistMeta = {
            _id: 'playlist-1',
            autoRefresh: true,
            count: 1,
            importDate: '2026-03-28T00:00:00.000Z',
            title: 'Playlist One',
        } as PlaylistMeta;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(existingPlaylist, {
                ...initialState.playlists,
                selectedId: 'playlist-1',
            }),
        };

        const nextState = reducer(
            state,
            PlaylistActions.updatePlaylist({
                playlist: {
                    autoRefresh: false,
                    playlist: {
                        items: [],
                    },
                } as Playlist,
                playlistId: 'playlist-1',
            })
        );

        expect(nextState.playlists.entities['playlist-1']?.autoRefresh).toBe(
            true
        );
    });

    it('keeps autoRefresh disabled on playlist refresh when the existing playlist has it disabled', () => {
        const existingPlaylist: PlaylistMeta = {
            _id: 'playlist-1',
            autoRefresh: false,
            count: 1,
            importDate: '2026-03-28T00:00:00.000Z',
            title: 'Playlist One',
        } as PlaylistMeta;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(existingPlaylist, {
                ...initialState.playlists,
                selectedId: 'playlist-1',
            }),
        };

        const nextState = reducer(
            state,
            PlaylistActions.updatePlaylist({
                playlist: {
                    autoRefresh: true,
                    playlist: {
                        items: [],
                    },
                } as Playlist,
                playlistId: 'playlist-1',
            })
        );

        expect(nextState.playlists.entities['playlist-1']?.autoRefresh).toBe(
            false
        );
    });

    it('keeps only metas in the entity map: the channel list is never stored twice', () => {
        const channel = { id: 'c1', name: 'One', url: 'http://x/1' } as Channel;
        const full = {
            _id: 'p1',
            title: 'Full record',
            count: 1,
            importDate: '2026-03-28T00:00:00.000Z',
            playlist: { items: [channel] },
            items: [channel],
            header: { raw: '#EXTM3U' },
        } as Playlist;
        const payloadOf = (state: typeof initialState) => {
            const entity = state.playlists.entities['p1'] as Playlist;
            return [entity.playlist, entity.items, entity.header];
        };

        const added = reducer(
            initialState,
            PlaylistActions.addPlaylist({ playlist: full })
        );
        expect(added.playlists.entities['p1']?.title).toBe('Full record');
        expect(payloadOf(added)).toEqual([undefined, undefined, undefined]);

        const byUrl = reducer(
            initialState,
            PlaylistActions.handleAddingPlaylistByUrl({
                isTemporary: false,
                playlist: full,
            })
        );
        expect(payloadOf(byUrl)).toEqual([undefined, undefined, undefined]);

        const refreshed = reducer(
            {
                ...added,
                playlists: { ...added.playlists, selectedId: 'p1' },
            },
            PlaylistActions.updatePlaylist({ playlist: full, playlistId: 'p1' })
        );
        expect(refreshed.channels).toEqual([channel]);
        expect(refreshed.playlists.entities['p1']?.count).toBe(1);
        expect(payloadOf(refreshed)).toEqual([undefined, undefined, undefined]);

        const many = reducer(
            initialState,
            PlaylistActions.addManyPlaylists({ playlists: [full] })
        );
        expect(payloadOf(many)).toEqual([undefined, undefined, undefined]);
        const updatedMany = reducer(
            many,
            PlaylistActions.updateManyPlaylists({ playlists: [full] })
        );
        expect(payloadOf(updatedMany)).toEqual([undefined, undefined, undefined]);
        // The action payload itself is left intact for the effects that persist it.
        expect(full.playlist.items).toEqual([channel]);
    });
});
