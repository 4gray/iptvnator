import { createEntityAdapter, EntityAdapter, EntityState } from '@ngrx/entity';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';

export const playlistsAdapter: EntityAdapter<PlaylistMeta> =
    createEntityAdapter<PlaylistMeta>({
        selectId: (item: PlaylistMeta) => item._id,
    });

export interface PlaylistMetaState extends EntityState<PlaylistMeta> {
    selectedId: string;
    allPlaylistsLoaded: boolean;
    loadFailed: boolean;
}

export const initialPlaylistMetaState: PlaylistMetaState =
    playlistsAdapter.getInitialState({
        selectedId: '',
        allPlaylistsLoaded: false,
        loadFailed: false,
    });

export const {
    selectIds,
    selectEntities: getPlaylistMetaEntities,
    selectAll: getAllPlaylistsMeta,
    selectTotal,
} = playlistsAdapter.getSelectors();
