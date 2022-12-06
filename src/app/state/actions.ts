import { createAction, props } from '@ngrx/store';
import { Channel } from '../../../shared/channel.interface';
import { Playlist } from '../../../shared/playlist.interface';
import { EpgProgram } from '../player/models/epg-program.model';

const STORE_KEY = '[PLAYLIST STORE]';

export const updateFavorites = createAction(
    `${STORE_KEY} Add/remove provided channel to the favorites`,
    props<{ channel: Channel }>()
);

export const setActiveChannel = createAction(
    `${STORE_KEY} Set active channel`,
    props<{ channel: Channel }>()
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

export const setPlaylist = createAction(
    `${STORE_KEY} Set playlist as active`,
    props<{ playlist: Playlist }>()
);
