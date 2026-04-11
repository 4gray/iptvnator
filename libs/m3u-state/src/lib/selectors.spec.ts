import { PlaylistMeta } from 'shared-interfaces';
import { PlaylistState } from './state';
import { selectActivePlaylist, selectChannelsLoading } from './selectors';

describe('selectors', () => {
    const playlistOne = {
        _id: 'playlist-1',
        title: 'Playlist One',
    } as PlaylistMeta;
    const playlistTwo = {
        _id: 'playlist-2',
        title: 'Playlist Two',
    } as PlaylistMeta;
    const entities = {
        'playlist-1': playlistOne,
        'playlist-2': playlistTwo,
    };

    describe('selectActivePlaylist', () => {
        it('resolves the active playlist from entity state and selected id', () => {
            expect(selectActivePlaylist.projector(entities, 'playlist-2')).toBe(
                playlistTwo
            );
        });

        it('returns null when there is no active playlist id', () => {
            expect(selectActivePlaylist.projector(entities, '')).toBeNull();
        });
    });

    describe('selectChannelsLoading', () => {
        it('returns the current M3U channel loading flag', () => {
            expect(
                selectChannelsLoading.projector({
                    channelsLoading: true,
                } as PlaylistState)
            ).toBe(true);
            expect(
                selectChannelsLoading.projector({
                    channelsLoading: false,
                } as PlaylistState)
            ).toBe(false);
        });
    });
});
