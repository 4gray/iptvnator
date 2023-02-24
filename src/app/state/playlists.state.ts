import { createEntityAdapter, EntityAdapter, EntityState } from '@ngrx/entity';
import { Playlist } from '../../../shared/playlist.interface';
import { PlaylistMeta } from '../shared/playlist-meta.type';

export const playlistsAdapter: EntityAdapter<PlaylistMeta> =
    createEntityAdapter<PlaylistMeta>({
        selectId: (item: Playlist) => item._id,
    });

export interface PlaylistMetaState extends EntityState<PlaylistMeta> {
    selectedId: string;
    allPlaylistsLoaded: boolean;
}

export const initialPlaylistMetaState: PlaylistMetaState =
    playlistsAdapter.getInitialState({
        selectedId: '',
        allPlaylistsLoaded: false,
    });

export const {
    selectIds,
    selectEntities: getPlaylistMetaEntities,
    selectAll: getAllPlaylistsMeta,
    selectTotal,
} = playlistsAdapter.getSelectors();
