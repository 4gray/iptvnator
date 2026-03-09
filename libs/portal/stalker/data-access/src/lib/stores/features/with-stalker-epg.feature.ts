import { inject } from '@angular/core';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { DataService } from 'services';
import { StalkerSessionService } from '../../stalker-session.service';
import {
    EpgItem,
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
} from 'shared-interfaces';

interface EpgStoreContext {
    currentPlaylist(): Playlist | undefined;
}

interface StalkerEpgEntry {
    id?: string | number;
    name?: string;
    descr?: string;
    time?: string;
    time_to?: string;
    ch_id?: string | number;
    start_timestamp?: string | number;
    stop_timestamp?: string | number;
}

interface StalkerEpgResponse {
    js?: StalkerEpgEntry[] | { data?: StalkerEpgEntry[] };
}

/**
 * EPG concern methods.
 */
export function withStalkerEpg() {
    return signalStoreFeature(
        withMethods(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService)
            ) => {
                const storeContext = store as unknown as EpgStoreContext;

                return {
                    async fetchChannelEpg(
                        channelId: number | string,
                        size = 10
                    ): Promise<EpgItem[]> {
                        const playlist = storeContext.currentPlaylist();
                        if (!playlist) return [];

                        const queryParams: Record<string, string> = {
                            action: StalkerPortalActions.GetShortEpg,
                            type: 'itv',
                            ch_id: String(channelId),
                            size: String(size),
                        };

                        let response: StalkerEpgResponse;
                        if (playlist.isFullStalkerPortal) {
                            response =
                                await stalkerSession.makeAuthenticatedRequest(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            response =
                                await dataService.sendIpcEvent<StalkerEpgResponse>(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        const epgData = Array.isArray(response?.js)
                            ? response.js
                            : response?.js?.data ?? [];
                        const items = Array.isArray(epgData) ? epgData : [];

                        return items.map((item) => ({
                            id: String(item.id ?? ''),
                            epg_id: '',
                            title: item.name ?? '',
                            description: item.descr ?? '',
                            lang: '',
                            start: item.time ?? '',
                            end: item.time_to ?? '',
                            stop: item.time_to ?? '',
                            channel_id: String(item.ch_id ?? channelId),
                            start_timestamp: String(item.start_timestamp ?? ''),
                            stop_timestamp: String(item.stop_timestamp ?? ''),
                        }));
                    },
                };
            }
        )
    );
}
