import { Channel } from './channel.interface';

export interface M3uFavoriteChannel {
    favoriteId: string;
    favoriteIndex: number;
    channel: Channel;
}
