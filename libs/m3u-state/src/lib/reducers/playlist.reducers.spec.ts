import { createReducer } from '@ngrx/store';
import { PlaylistActions } from '../actions';
import { playlistsAdapter } from '../playlists.state';
import { initialState } from '../state';
import { playlistReducers } from './playlist.reducers';
import { Channel, Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';

const reducer = createReducer(initialState, ...playlistReducers);

describe('playlistReducers', () => {
    it.each(['url', 'userAgent'] as const)(
        'discards refresh channels captured before a %s edit',
        (field) => {
            const current = {
                _id: 'shared',
                title: 'Current name',
                url: 'https://provider.test/current',
                userAgent: 'Current agent',
                playlist: { items: [{ id: 'current', name: 'Current' }] },
            } as Playlist;
            const state = {
                ...initialState,
                channels: current.playlist!.items as Channel[],
                playlists: {
                    ...playlistsAdapter.addOne(current, initialState.playlists),
                    selectedId: current._id,
                },
            };
            const delayed = {
                ...current,
                [field]: 'old',
                playlist: { items: [{ id: 'old', name: 'Old' }] },
            } as Playlist;
            expect(
                reducer(
                    state,
                    PlaylistActions.updatePlaylist({
                        playlistId: current._id,
                        playlist: delayed,
                    })
                )
            ).toBe(state);
        }
    );
    it('drops removed source metadata while retaining only the parsed payload', () => {
        const before = {
            _id: 'shared',
            title: 'Before',
            referrer: 'https://old.test',
            stalkerDeviceId1: 'old-device',
            stalkerToken: 'old-session',
            playlist: { items: [{ name: 'Cached' }] },
        } as Playlist;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(before, initialState.playlists),
        };
        const incoming = {
            _id: 'shared',
            title: 'After',
            count: 1,
            importDate: '',
            autoRefresh: false,
        };
        const next = reducer(
            state,
            PlaylistActions.loadPlaylistsSuccess({
                playlists: [incoming],
                authoritative: true,
            })
        );
        expect(next.playlists.entities['shared']).toEqual({
            ...incoming,
            playlist: before.playlist,
        });
    });
    it('rehydrates an open shared M3U with the latest parsed channels', () => {
        const playlist = {
            _id: 'shared',
            title: 'Before',
            count: 1,
            importDate: '2026-01-01',
            lastUsage: '',
            autoRefresh: false,
            playlist: { items: [{ name: 'Old channel' }] },
            favorites: ['local-favorite'],
        } as Playlist;
        const state = {
            ...initialState,
            channels: playlist.playlist.items,
            playlists: {
                ...playlistsAdapter.addOne(playlist, initialState.playlists),
                selectedId: playlist._id,
            },
        };
        const updated = {
            ...playlist,
            title: 'After',
            playlist: { items: [{ name: 'New channel' }] },
        };
        const next = reducer(
            state,
            PlaylistActions.hydrateSharedPlaylist({
                playlistId: playlist._id,
                playlist: updated,
            })
        );
        expect(next.channels).toEqual(updated.playlist.items);
        expect(
            (next.playlists.entities[playlist._id] as Playlist)?.playlist
        ).toEqual(updated.playlist);
        expect(next.playlists.entities[playlist._id]?.favorites).toEqual([
            'local-favorite',
        ]);
    });
    it('applies remote renames and deletions while preserving the retained active payload', () => {
        const kept = {
            _id: 'keep',
            title: 'Before',
            count: 1,
            importDate: '2026-01-01',
            autoRefresh: false,
            playlist: { items: [{ name: 'Channel' }] },
        } as Playlist;
        const removed = { ...kept, _id: 'removed' };
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addMany(
                [kept, removed],
                initialState.playlists
            ),
        };
        const next = reducer(
            state,
            PlaylistActions.loadPlaylistsSuccess({
                playlists: [{ ...kept, title: 'After' }],
                authoritative: true,
            })
        );
        expect(next.playlists.entities['keep']?.title).toBe('After');
        expect((next.playlists.entities['keep'] as Playlist)?.playlist).toEqual(
            kept.playlist
        );
        expect(next.playlists.entities['removed']).toBeUndefined();
    });
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
        'retains the saved User-Agent when a refresh carries an absent or superseded agent: %s',
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
                existing.userAgent
            );
            if (userAgent !== undefined) expect(nextState).toBe(state);
        }
    );

    it('accepts a changed User-Agent from authoritative source hydration', () => {
        const existing = {
            _id: 'shared',
            userAgent: 'Old agent',
        } as PlaylistMeta;
        const state = {
            ...initialState,
            playlists: playlistsAdapter.addOne(
                existing,
                initialState.playlists
            ),
        };
        const updated = {
            ...existing,
            userAgent: 'New agent',
            playlist: { items: [] },
        } as Playlist;
        const next = reducer(
            state,
            PlaylistActions.hydrateSharedPlaylist({
                playlistId: existing._id,
                playlist: updated,
            })
        );
        expect(next.playlists.entities[existing._id]?.userAgent).toBe(
            'New agent'
        );
    });

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
});
