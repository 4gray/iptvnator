import { type Playlist } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { PlaylistActions } from './actions';
import { persistPlaylistUpdate } from './playlist-update.effect-handler';

describe('PlaylistEffects updatePlaylist', () => {
    it('forwards the refresh operation ID to playlist persistence', () => {
        const playlistsService = {
            updatePlaylist: jest.fn(() => of(undefined)),
        };
        const playlist = {
            _id: 'playlist-1',
            playlist: { items: [] },
        } as unknown as Playlist;
        const action = PlaylistActions.updatePlaylist({
            playlist,
            playlistId: playlist._id,
            refreshEpg: true,
            operationId: 'playlist-refresh-operation',
        });

        persistPlaylistUpdate(playlistsService, action);

        expect(playlistsService.updatePlaylist).toHaveBeenCalledWith(
            playlist._id,
            playlist,
            'playlist-refresh-operation'
        );
    });
});
