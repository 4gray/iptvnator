import { Injectable } from '@angular/core';
import { EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import { EPG_GET_PROGRAM } from '../shared/ipc-commands';
import { ElectronService } from '../services/electron.service';
import { Channel } from './channel.model';

export interface ChannelState extends EntityState<Channel> {
    active: Channel;
    epgAvailable: boolean;
    favorites: string[];
    playlistId: string;
}

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'channel', resettable: true })
export class ChannelStore extends EntityStore<ChannelState> {
    /**
     * Creates an instance of ChannelStore
     * @param electronService electron service
     */
    constructor(private electronService: ElectronService) {
        super({
            active: undefined,
            epgAvailable: false,
            favorites: [],
            playlistId: '',
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

    /**
     * Updates selected/active channel in store
     * @param channel selected channel
     */
    setActiveChannel(channel: Channel): void {
        this.update((store) => ({
            ...store,
            active: channel,
        }));
        this.electronService.ipcRenderer.send(EPG_GET_PROGRAM, {
            channelName: channel.name,
        });
    }
}
