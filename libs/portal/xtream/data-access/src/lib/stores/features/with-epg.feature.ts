import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withState,
} from '@ngrx/signals';
import { EpgItem } from 'shared-interfaces';
import { DataService } from 'services';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../../services/xtream-api.service';
import { createLogger } from '@iptvnator/portal/shared/util';

/**
 * EPG state for managing Electronic Program Guide data
 */
export interface EpgState {
    epgItems: EpgItem[];
    isLoadingEpg: boolean;
}

/**
 * Initial EPG state
 */
const initialEpgState: EpgState = {
    epgItems: [],
    isLoadingEpg: false,
};

/**
 * EPG feature store for managing Electronic Program Guide data.
 * Handles:
 * - Loading EPG for selected stream
 * - Loading channel EPG for preview
 */
export function withEpg() {
    const logger = createLogger('withEpg');
    type ParentSelectionStoreLike = {
        currentPlaylist?: () => {
            password: string;
            serverUrl: string;
            username: string;
        } | null;
        selectedItem?: () => {
            xtream_id?: number | null;
        } | null;
    };

    return signalStoreFeature(
        withState<EpgState>(initialEpgState),
        withComputed((store) => ({
            currentEpgItem: computed(() => {
                const now = Date.now();
                const items = [...store.epgItems()].sort(
                    (left, right) =>
                        getEpgTimestampMs(
                            left.start,
                            left.start_timestamp
                        ) -
                        getEpgTimestampMs(
                            right.start,
                            right.start_timestamp
                        )
                );

                return (
                    items.find((item) => {
                        const start = getEpgTimestampMs(
                            item.start,
                            item.start_timestamp
                        );
                        const stop = getEpgTimestampMs(
                            item.stop ?? item.end,
                            item.stop_timestamp
                        );
                        return now >= start && now < stop;
                    }) ?? null
                );
            }),
        })),

        withMethods((store) => {
            const apiService = inject(XtreamApiService);
            const dataService = inject(DataService);

            /**
             * Helper to get credentials from parent store
             */
            const getCredentialsFromStore = (): XtreamCredentials | null => {
                const storeAny = store as ParentSelectionStoreLike;
                const playlist = storeAny.currentPlaylist?.();

                if (!playlist) {
                    return null;
                }

                return {
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                };
            };

            return {
                /**
                 * Load EPG for the currently selected item
                 */
                async loadEpg(): Promise<EpgItem[]> {
                    const credentials = getCredentialsFromStore();
                    if (!credentials) {
                        patchState(store, { epgItems: [] });
                        return [];
                    }

                    // Access selected item from parent store (from withSelection)
                    const storeAny = store as ParentSelectionStoreLike;
                    const selectedItem = storeAny.selectedItem?.();

                    if (!selectedItem?.xtream_id) {
                        patchState(store, { epgItems: [] });
                        return [];
                    }

                    patchState(store, { epgItems: [], isLoadingEpg: true });

                    try {
                        const epgItems = dataService.isElectron
                            ? await apiService.getFullEpg(
                                  credentials,
                                  selectedItem.xtream_id,
                                  {
                                      suppressErrorLog: true,
                                  }
                              )
                            : await apiService.getShortEpg(
                                  credentials,
                                  selectedItem.xtream_id,
                                  10,
                                  {
                                      suppressErrorLog: true,
                                  }
                              );

                        patchState(store, {
                            epgItems,
                            isLoadingEpg: false,
                        });

                        return epgItems;
                    } catch (error) {
                        logger.error('Error loading EPG', error);
                        patchState(store, {
                            epgItems: [],
                            isLoadingEpg: false,
                        });
                        return [];
                    }
                },

                /**
                 * Load EPG for a specific channel (for preview)
                 */
                async loadChannelEpg(streamId: number): Promise<EpgItem[]> {
                    const credentials = getCredentialsFromStore();
                    if (!credentials) {
                        return [];
                    }

                    try {
                        return await apiService.getShortEpg(
                            credentials,
                            streamId,
                            1,
                            {
                                suppressErrorLog: true,
                            }
                        );
                    } catch (error) {
                        logger.error('Error loading channel EPG', error);
                        return [];
                    }
                },

                /**
                 * Clear EPG data
                 */
                clearEpg(): void {
                    patchState(store, initialEpgState);
                },
            };
        })
    );
}

function getEpgTimestampMs(
    dateValue: string | undefined,
    unixTimestampValue: string | undefined
): number {
    const unixTimestamp = Number.parseInt(String(unixTimestampValue ?? ''), 10);
    if (Number.isFinite(unixTimestamp) && unixTimestamp > 0) {
        return unixTimestamp * 1000;
    }

    return Date.parse(String(dateValue ?? ''));
}
