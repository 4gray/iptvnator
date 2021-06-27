import { Injectable } from '@angular/core';
import { EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import { CHANNEL_SET_USER_AGENT, EPG_GET_PROGRAM } from '../../../ipc-commands';
import { ElectronService } from '../services/electron.service';
import { Channel } from './channel.model';
import * as moment from 'moment';
import { EpgProgram } from '../player/models/epg-program.model';

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
        this.update((store) => {
            if (store.epgAvailable) {
                this.electronService.ipcRenderer.send(EPG_GET_PROGRAM, {
                    channelName: channel.name,
                });
                if (channel.http['user-agent']) {
                    this.electronService.ipcRenderer.send(
                        CHANNEL_SET_USER_AGENT,
                        {
                            referer: channel.http.referrer,
                            userAgent: channel.http['user-agent'],
                        }
                    );
                }
            }
            return {
                ...store,
                active: { ...channel, epgParams: '' },
            };
        });
    }

    /**
     * Sets the given timestamp for the epg program
     * @param program epg program to set as active
     */
    setActiveEpgProgram(program: EpgProgram): void {
        const from = moment(
            program['_attributes'].start,
            'YYYYMMDDHHmm ZZ'
        ).unix();
        const now = moment(Date.now()).unix();
        const epgParams = `?utc=${from}&lutc=${now}`;
        this.update((store) => ({
            ...store,
            active: { ...store.active, epgParams },
        }));
    }

    /**
     * Sets the active channel from epg program back to the live translation
     */
    resetActiveEpgProgram(): void {
        this.update((store) => ({
            ...store,
            active: { ...store.active, epgParams: '' },
        }));
    }

    /**
     * Updates the epg availability flag
     * @param value
     */
    setEpgAvailableFlag(value: boolean): void {
        this.update((store) => {
            if (store.active && store.active.name) {
                this.electronService.ipcRenderer.send(EPG_GET_PROGRAM, {
                    channelName: store.active.name,
                });
            }

            return {
                ...store,
                epgAvailable: value,
            };
        });
    }
}
