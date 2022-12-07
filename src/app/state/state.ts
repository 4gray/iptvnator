import { Channel } from '../../../shared/channel.interface';
import { EpgProgram } from '../player/models/epg-program.model';

export interface PlaylistState {
    active: Channel | undefined;
    currentEpgProgram: EpgProgram | undefined;
    epgAvailable: boolean;
    favorites: string[];
    playlistId: string;
    playlistFilename: string;
    channels: Channel[]; // TODO: use entity store
}

export const initialState: PlaylistState = {
    active: undefined,
    currentEpgProgram: undefined,
    epgAvailable: false,
    favorites: [],
    playlistId: '',
    playlistFilename: '',
    channels: [],
};
