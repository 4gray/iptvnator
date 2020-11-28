import { Injectable } from '@angular/core';
import { EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import { ElectronService } from '../services/electron.service';
import { Channel } from './channel.model';

export interface ChannelState extends EntityState<Channel> {
    favorites: string[];
    playlistId: string;
    active: Channel;
}

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'channel', resettable: true })
export class ChannelStore extends EntityStore<ChannelState> {
    /**
     * Creates an instance of ChannelStore
     * @param channelStore channels store
     */
    constructor(private electronService: ElectronService) {
        super({
            favorites: [],
            playlistId: '',
            active: undefined,
        });
    }

    /**
     * Adds/removes the given channel from the favorites list
     * @param channel channel to add/remove
     */
    updateFavorite(channel: Channel): void {
        let favorites;
        this.update((store) => {
            if (store.favorites.includes(channel.id)) {
                favorites = [
                    ...store.favorites.filter((id) => id !== channel.id),
                ];
            } else {
                favorites = [...store.favorites, channel.id];
            }
            this.electronService.ipcRenderer.send('update-favorites', {
                id: store.playlistId,
                favorites,
            });
            return { favorites };
        });
    }
}
