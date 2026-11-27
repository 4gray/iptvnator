import { createReducer } from '@ngrx/store';
import { Channel, Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { ChannelActions, PlaylistActions } from '../actions';
import { selectChannelsPlaylistId } from '../m3u-catalog-index.service';
import { playlistsAdapter } from '../playlists.state';
import { PlaylistState, initialState } from '../state';
import { channelReducers } from './channel.reducers';
import { playlistReducers } from './playlist.reducers';

const reducer = createReducer(
    initialState,
    ...channelReducers,
    ...playlistReducers
);

const row = (id: string) =>
    ({ id, url: `https://example.com/${id}.m3u8`, name: id }) as Channel;

/** What the lazily loaded catalog reads: null whenever the owner is unknown. */
const ownerOf = (state: PlaylistState) =>
    selectChannelsPlaylistId.projector(state);

const withPlaylists = (
    selectedId: string,
    ...ids: string[]
): PlaylistState => ({
    ...initialState,
    playlists: playlistsAdapter.addMany(
        ids.map((_id) => ({ _id, title: _id }) as PlaylistMeta),
        { ...initialState.playlists, selectedId }
    ),
});

/**
 * Which playlist the stored channel rows belong to. The catalog offers a
 * playlist its Movies and Series sections from these rows, and the player
 * consumes a handoff against them, so an owner that lags behind the rows
 * shows one playlist's content as another's.
 */
describe('channelsPlaylistId', () => {
    it('is unknown before any rows are loaded', () => {
        expect(ownerOf(initialState)).toBeNull();
    });

    it('follows the playlist a route session loaded rows for', () => {
        const state = reducer(
            initialState,
            ChannelActions.setChannels({
                channels: [row('a')],
                playlistId: 'playlist-1',
            })
        );

        expect(ownerOf(state)).toBe('playlist-1');
    });

    it('is unknown again when rows are set without a playlist', () => {
        const loaded = reducer(
            initialState,
            ChannelActions.setChannels({
                channels: [row('a')],
                playlistId: 'playlist-1',
            })
        );

        const cleared = reducer(
            loaded,
            ChannelActions.setChannels({ channels: [] })
        );

        expect(ownerOf(cleared)).toBeNull();
    });

    it('moves to the active playlist when its refresh replaces the rows', () => {
        const state = {
            ...withPlaylists('playlist-2', 'playlist-1', 'playlist-2'),
            channels: [row('a')],
            channelsPlaylistId: 'playlist-1',
        };

        const next = reducer(
            state,
            PlaylistActions.updatePlaylist({
                playlistId: 'playlist-2',
                playlist: { playlist: { items: [row('b')] } } as Playlist,
            })
        );

        expect(next.channels).toEqual([row('b')]);
        expect(ownerOf(next)).toBe('playlist-2');
    });

    it('stays put when another playlist refreshes in the background', () => {
        const state = {
            ...withPlaylists('playlist-1', 'playlist-1', 'playlist-2'),
            channels: [row('a')],
            channelsPlaylistId: 'playlist-1',
        };

        const next = reducer(
            state,
            PlaylistActions.updatePlaylist({
                playlistId: 'playlist-2',
                playlist: { playlist: { items: [row('b')] } } as Playlist,
            })
        );

        expect(next.channels).toEqual([row('a')]);
        expect(ownerOf(next)).toBe('playlist-1');
    });

    it('follows a temporary playlist opened by URL', () => {
        const next = reducer(
            initialState,
            PlaylistActions.handleAddingPlaylistByUrl({
                isTemporary: true,
                playlist: {
                    _id: 'temporary-1',
                    playlist: { items: [row('t')] },
                } as Playlist,
            })
        );

        expect(next.channels).toEqual([row('t')]);
        expect(ownerOf(next)).toBe('temporary-1');
    });
});
