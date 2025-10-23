import { EpgChannel } from './epg-channel.model';
import { EpgProgram } from './epg-program.model';

/**
 * EPG Channel with associated programs
 */
export interface EpgChannelWithPrograms extends EpgChannel {
    programs: EpgProgram[];
}

/**
 * EPG Data structure
 */
export interface EpgData {
    channels: EpgChannel[];
    programs: EpgProgram[];
}
