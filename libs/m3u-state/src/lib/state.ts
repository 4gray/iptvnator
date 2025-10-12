import { Channel } from 'shared-interfaces';
import { initialPlaylistMetaState, PlaylistMetaState } from './playlists.state';

import { EpgProgram } from 'shared-interfaces';

export interface PlaylistState {
    active: Channel | undefined;
    currentEpgProgram: EpgProgram | undefined;
    epgAvailable: boolean;
    channels: Channel[]; // TODO: use entity store
    playlists: PlaylistMetaState;
    currentPlaylistId: string | undefined;
}

export const initialState: PlaylistState = {
    active: undefined,
    currentEpgProgram: undefined,
    epgAvailable: false,
    channels: [],
    playlists: initialPlaylistMetaState,
    currentPlaylistId: undefined,
};
