import { createReducer, on } from '@ngrx/store';
import * as moment from 'moment';
import { createChannel } from '../shared/channel.model';
import * as PlaylistActions from './actions';
import { initialState, PlaylistState } from './state';

export const playlistReducer = createReducer(
    initialState,
    on(PlaylistActions.setActiveEpgProgram, (state, action): PlaylistState => {
        const { program } = action;
        const from = moment(program.start, 'YYYYMMDDHHmm ZZ').unix();
        const now = moment(Date.now()).unix();
        const epgParams = `?utc=${from}&lutc=${now}`;
        return {
            ...state,
            active: { ...state.active, epgParams },
        };
    }),
    on(
        PlaylistActions.resetActiveEpgProgram,
        (state): PlaylistState => ({
            ...state,
            active: { ...state.active, epgParams: '' },
        })
    ),
    on(
        PlaylistActions.setActiveChannelSuccess,
        (state, action): PlaylistState => {
            const { channel } = action;
            return {
                ...state,
                active: { ...channel, epgParams: '' },
            };
        }
    ),
    on(
        PlaylistActions.setCurrentEpgProgram,
        (state, action): PlaylistState => ({
            ...state,
            currentEpgProgram: action.program,
        })
    ),
    on(
        PlaylistActions.setEpgAvailableFlag,
        (state, action): PlaylistState => ({
            ...state,
            epgAvailable: action.value,
        })
    ),
    on(PlaylistActions.setPlaylist, (state, action): PlaylistState => {
        const { playlist } = action;

        return {
            ...state,
            channels: playlist?.playlist.items.map((element) =>
                createChannel(element)
            ),
            favorites: playlist?.favorites || [],
            active: undefined,
            playlistId: playlist._id,
            playlistFilename: playlist.title || playlist.filename,
        };
    }),
    on(PlaylistActions.updateFavorites, (state, action): PlaylistState => {
        let favorites;
        const { channel } = action;
        if (state.favorites.includes(channel.id)) {
            favorites = [...state.favorites.filter((id) => id !== channel.id)];
        } else {
            favorites = [...state.favorites, channel.id];
        }
        return { ...state, favorites };
    })
);

export const selectFavorites = (state: PlaylistState) => state.favorites;
export const selectPlaylistId = (state: PlaylistState) => state.playlistId;
export const selectPlaylistFilename = (state: PlaylistState) =>
    state.playlistFilename;
export const selectIsEpgAvailable = (state: PlaylistState) =>
    state.epgAvailable;
export const selectActive = (state: PlaylistState) => state.active;
export const selectCurrentEpgProgram = (state: PlaylistState) =>
    state.currentEpgProgram;
export const selectChannels = (state: PlaylistState) => state.channels;
