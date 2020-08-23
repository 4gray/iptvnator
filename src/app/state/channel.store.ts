import { Injectable } from '@angular/core';
import { EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import { Channel } from './channel.model';

export interface ChannelState extends EntityState<Channel> {
    favorites: string[];
    playlistId: string;
    active: Channel;
}

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'channel', resettable: true })
export class ChannelStore extends EntityStore<ChannelState> {
    constructor() {
        super({
            favorites: [],
            playlistId: '',
            active: undefined,
        });
    }

    setChannels(channels: Channel[]): void {
        this.upsertMany(channels);
    }
}
