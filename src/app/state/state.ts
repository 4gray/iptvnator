import { Channel } from '../../../shared/channel.interface';
import { initialPlaylistMetaState, PlaylistMetaState } from './playlists.state';

import { EpgProgram } from '../player/models/epg-program.model';

export interface PlaylistState {
    active: Channel | undefined;
    currentEpgProgram: EpgProgram | undefined;
    epgAvailable: boolean;
    channels: Channel[]; // TODO: use entity store
    playlists: PlaylistMetaState;
}

export const initialState: PlaylistState = {
    active: undefined,
    currentEpgProgram: undefined,
    epgAvailable: false,
    channels: [],
    playlists: initialPlaylistMetaState,
};
