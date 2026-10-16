import { Channel } from '@iptvnator/shared/interfaces';
import { initialPlaylistMetaState, PlaylistMetaState } from './playlists.state';

import { EpgProgram } from '@iptvnator/shared/interfaces';

export interface PlaylistState {
    active: Channel | undefined;
    activePlaybackUrl: string | null;
    activeEpgProgram: EpgProgram | undefined;
    currentEpgProgram: EpgProgram | undefined;
    epgAvailable: boolean;
    channelsLoading: boolean;
    channels: Channel[]; // TODO: use entity store
    /**
     * The playlist `channels` was read from, or null when unknown. The
     * active playlist can change without an M3U route loading its rows, so
     * the two are not the same thing.
     */
    channelsPlaylistId: string | null;
    playlists: PlaylistMetaState;
}

export const initialState: PlaylistState = {
    active: undefined,
    activePlaybackUrl: null,
    activeEpgProgram: undefined,
    currentEpgProgram: undefined,
    epgAvailable: false,
    channelsLoading: false,
    channels: [],
    channelsPlaylistId: null,
    playlists: initialPlaylistMetaState,
};
