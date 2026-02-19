import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { EpgItem } from 'shared-interfaces';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../../services/xtream-api.service';
import { createLogger } from '../../../shared/utils/logger';

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
    return signalStoreFeature(
        withState<EpgState>(initialEpgState),

        withMethods((store) => {
            const apiService = inject(XtreamApiService);

            /**
             * Helper to get credentials from parent store
             */
            const getCredentialsFromStore = (): XtreamCredentials | null => {
                const storeAny = store as any;
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
                    const storeAny = store as any;
                    const selectedItem = storeAny.selectedItem?.();

                    if (!selectedItem?.xtream_id) {
                        patchState(store, { epgItems: [] });
                        return [];
                    }

                    patchState(store, { isLoadingEpg: true });

                    try {
                        const epgItems = await apiService.getShortEpg(
                            credentials,
                            selectedItem.xtream_id,
                            10
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
                            1
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
