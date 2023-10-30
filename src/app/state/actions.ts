import { createAction, props } from '@ngrx/store';
import { Channel } from '../../../shared/channel.interface';
import { Playlist } from '../../../shared/playlist.interface';
import { EpgProgram } from '../player/models/epg-program.model';
import { PlaylistMeta } from '../shared/playlist-meta.type';

const STORE_KEY = '[GLOBAL STORE]';
const PLAYLISTS_STORE_KEY = '[PLAYLISTS STORE]';

export const loadPlaylists = createAction(
    `${PLAYLISTS_STORE_KEY} Load playlists from db`
);

export const loadPlaylistsSuccess = createAction(
    `${PLAYLISTS_STORE_KEY} Successfully loaded playlists from db`,
    props<{ playlists: PlaylistMeta[] }>()
);

export const addPlaylist = createAction(
    `${PLAYLISTS_STORE_KEY} Add new playlist`,
    props<{ playlist: Playlist }>()
);

export const addManyPlaylists = createAction(
    `${PLAYLISTS_STORE_KEY} Add many playlists`,
    props<{ playlists: Playlist[] }>()
);

export const removePlaylist = createAction(
    `${PLAYLISTS_STORE_KEY} Remove playlist by id`,
    props<{ playlistId: string }>()
);

export const updatePlaylistMeta = createAction(
    `${PLAYLISTS_STORE_KEY} update playlist meta`,
    props<{ playlist: PlaylistMeta }>()
);

export const updatePlaylist = createAction(
    `${PLAYLISTS_STORE_KEY} update playlist`,
    props<{ playlist: Playlist; playlistId: string }>()
);

export const updateManyPlaylists = createAction(
    `${PLAYLISTS_STORE_KEY} Update many playlists (auto-update mechanism)`,
    props<{ playlists: Playlist[] }>()
);

export const parsePlaylist = createAction(
    `${PLAYLISTS_STORE_KEY} parse playlist`,
    props<{
        uploadType: 'FILE' | 'URL' | 'TEXT';
        playlist: string;
        title: string;
        path?: string;
    }>()
);

export const setActivePlaylist = createAction(
    `${PLAYLISTS_STORE_KEY} set active playlist`,
    props<{ playlistId: string }>()
);

export const updateFavorites = createAction(
    `${STORE_KEY} Add/remove provided channel to the favorites`,
    props<{ channel: Channel }>()
);

export const setFavorites = createAction(
    `${STORE_KEY} Set favorites`,
    props<{ channelIds: string[] }>()
);

export const setActiveChannel = createAction(
    `${STORE_KEY} Set active channel`,
    props<{ channel: Channel }>()
);

export const resetActiveChannel = createAction(
    `${STORE_KEY} Reset active channel`
);

export const setActiveChannelSuccess = createAction(
    `${STORE_KEY} Set active channel success`,
    props<{ channel: Channel }>()
);

export const setActiveEpgProgram = createAction(
    `${STORE_KEY} Sets the given timestamp for the epg program`,
    props<{ program: EpgProgram }>()
);

export const setCurrentEpgProgram = createAction(
    `${STORE_KEY} Updates the active epg program for the active channel`,
    props<{ program: EpgProgram }>()
);

export const resetActiveEpgProgram = createAction(
    `${STORE_KEY} Reset active epg program`
);

export const setEpgAvailableFlag = createAction(
    `${STORE_KEY} Reset active epg program`,
    props<{ value: boolean }>()
);

export const setChannels = createAction(
    `${STORE_KEY} Set channels`,
    props<{ channels: Channel[] }>()
);

export const updatePlaylistPositions = createAction(
    `${STORE_KEY} Update playlist positions`,
    props<{
        positionUpdates: { id: string; changes: { position: number } }[];
    }>()
);

export const removeAllPlaylists = createAction(
    `${STORE_KEY} Remove all playlists`
);

export const setAdjacentChannelAsActive = createAction(
    `${STORE_KEY} Set adjacent channel as active`,
    props<{
        direction: 'next' | 'previous';
    }>()
);
