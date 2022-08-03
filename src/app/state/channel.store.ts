import { Injectable } from '@angular/core';
import { EntityState, EntityStore, StoreConfig } from '@datorama/akita';
import * as moment from 'moment';
import { createChannel } from '.';
import { Channel } from '../../../shared/channel.interface';
import {
    CHANNEL_SET_USER_AGENT,
    EPG_GET_PROGRAM,
    PLAYLIST_UPDATE_FAVORITES,
} from '../../../shared/ipc-commands';
import { Playlist } from '../../../shared/playlist.interface';
import { EpgProgram } from '../player/models/epg-program.model';
import { DataService } from '../services/data.service';

export interface ChannelState extends EntityState<Channel> {
    active: Channel;
    epgAvailable: boolean;
    currentEpgProgram: EpgProgram;
    favorites: string[];
    playlistId: string;
    playlistFilename: string;
}

@Injectable({ providedIn: 'root' })
@StoreConfig({ name: 'channel', resettable: true })
export class ChannelStore extends EntityStore<ChannelState> {
    /**
     * Creates an instance of ChannelStore
     * @param electronService electron service
     */
    constructor(private electronService: DataService) {
        super({
            active: undefined,
            currentEpgProgram: undefined,
            epgAvailable: false,
            favorites: [],
            playlistId: '',
            playlistFilename: '',
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
            this.electronService.sendIpcEvent(PLAYLIST_UPDATE_FAVORITES, {
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
                this.electronService.sendIpcEvent(EPG_GET_PROGRAM, {
                    channel,
                });
                if (channel.http['user-agent']) {
                    this.electronService.sendIpcEvent(CHANNEL_SET_USER_AGENT, {
                        referer: channel.http.referrer,
                        userAgent: channel.http['user-agent'],
                    });
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
                this.electronService.sendIpcEvent(EPG_GET_PROGRAM, {
                    channelName: store.active.name,
                });
            }

            return {
                ...store,
                epgAvailable: value,
            };
        });
    }

    /**
     * Updates the active epg program for the active channel
     * @param currentEpgProgram program to set
     */
    setCurrentEpgProgram(currentEpgProgram: EpgProgram): void {
        this.update((store) => ({
            ...store,
            currentEpgProgram,
        }));
    }

    /**
     * Sets the given playlist as active for the current session
     * @param playlist playlist object
     */
    setPlaylist(playlist: Playlist): void {
        this.remove();
        const favorites = playlist?.favorites || [];
        const channels = playlist?.playlist.items.map((element) =>
            createChannel(element)
        );
        this.upsertMany(channels);
        this.update((store) => ({
            ...store,
            active: undefined,
            favorites,
            playlistId: playlist._id,
            playlistFilename: playlist.title || playlist.filename,
        }));
    }
}
