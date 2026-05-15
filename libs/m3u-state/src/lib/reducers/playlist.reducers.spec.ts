import { createReducer } from '@ngrx/store';
import { PlaylistActions } from '../actions';
import { playlistsAdapter } from '../playlists.state';
import { initialState } from '../state';
import { playlistReducers } from './playlist.reducers';
import { Channel, Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';

const reducer = createReducer(initialState, ...playlistReducers);

describe('playlistReducers', () => {
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

        expect(
            nextState.playlists.entities['playlist-1']?.autoRefresh
        ).toBe(true);
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

        expect(
            nextState.playlists.entities['playlist-1']?.autoRefresh
        ).toBe(false);
    });
});
