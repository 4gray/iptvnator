import { inject } from '@angular/core';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { DataService, StalkerSessionService } from 'services';
import {
    EpgItem,
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
} from 'shared-interfaces';

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
                const storeAny = store as any;

                return {
                    async fetchChannelEpg(
                        channelId: number | string,
                        size = 10
                    ): Promise<EpgItem[]> {
                        const playlist = storeAny.currentPlaylist() as Playlist;
                        if (!playlist) return [];

                        const queryParams: Record<string, string> = {
                            action: StalkerPortalActions.GetShortEpg,
                            type: 'itv',
                            ch_id: String(channelId),
                            size: String(size),
                        };

                        let response: any;
                        if (playlist.isFullStalkerPortal) {
                            response =
                                await stalkerSession.makeAuthenticatedRequest(
                                    playlist,
                                    queryParams
                                );
                        } else {
                            response = await dataService.sendIpcEvent(
                                STALKER_REQUEST,
                                {
                                    url: playlist.portalUrl,
                                    macAddress: playlist.macAddress,
                                    params: queryParams,
                                }
                            );
                        }

                        const epgData = response?.js?.data ?? response?.js ?? [];
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
