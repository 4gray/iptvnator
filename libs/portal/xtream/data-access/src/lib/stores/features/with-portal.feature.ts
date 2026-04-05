import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import {
    XTREAM_DATA_SOURCE,
    XtreamPlaylistData,
} from '../../data-sources/xtream-data-source.interface';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../../services/xtream-api.service';
import { PortalStatusType } from '../../xtream-state';
import { createLogger } from '@iptvnator/portal/shared/util';

/**
 * Portal state for managing playlist and portal status
 */
export interface PortalState {
    playlistId: string | null;
    currentPlaylist: XtreamPlaylistData | null;
    portalStatus: PortalStatusType;
}

/**
 * Initial portal state
 */
const initialPortalState: PortalState = {
    playlistId: null,
    currentPlaylist: null,
    portalStatus: 'unavailable',
};

/**
 * Portal feature store for managing the current Xtream playlist and status.
 * Handles:
 * - Setting/clearing playlist ID
 * - Fetching playlist details
 * - Checking portal status (active, inactive, expired, unavailable)
 */
export function withPortal() {
    const logger = createLogger('withPortal');

    const resolvePortalStatus = (response: {
        user_info?: {
            exp_date?: string;
            status?: string;
        };
    } | null): PortalStatusType => {
        if (!response?.user_info?.status) {
            return 'unavailable';
        }

        if (response.user_info.status === 'Active') {
            if (!response.user_info.exp_date) {
                return 'active';
            }

            const expDate = new Date(
                parseInt(response.user_info.exp_date, 10) * 1000
            );
            return expDate < new Date() ? 'expired' : 'active';
        }

        return 'inactive';
    };

    return signalStoreFeature(
        withState<PortalState>(initialPortalState),

        withMethods((store) => {
            const apiService = inject(XtreamApiService);
            const dataSource = inject(XTREAM_DATA_SOURCE);

            return {
                /**
                 * Set the current playlist ID
                 */
                setPlaylistId(playlistId: string): void {
                    patchState(store, { playlistId });
                },

                /**
                 * Fetch playlist details from data source
                 */
                async fetchPlaylist(): Promise<void> {
                    const playlistId = store.playlistId();
                    if (!playlistId) {
                        return;
                    }

                    try {
                        const playlist =
                            await dataSource.getPlaylist(playlistId);

                        if (playlist) {
                            patchState(store, { currentPlaylist: playlist });
                            return;
                        }

                        const currentPlaylist = store.currentPlaylist();
                        if (
                            !currentPlaylist ||
                            currentPlaylist.id !== playlistId
                        ) {
                            return;
                        }

                        await dataSource.createPlaylist(currentPlaylist);
                        patchState(store, { currentPlaylist });
                    } catch (error) {
                        logger.error('Error fetching playlist', error);
                    }
                },

                setCurrentPlaylist(playlist: XtreamPlaylistData | null): void {
                    patchState(store, { currentPlaylist: playlist });
                },

                /**
                 * Check portal status via API
                 */
                async checkPortalStatus(): Promise<PortalStatusType> {
                    const playlist = store.currentPlaylist();
                    if (!playlist) {
                        patchState(store, { portalStatus: 'unavailable' });
                        return 'unavailable';
                    }

                    const credentials: XtreamCredentials = {
                        serverUrl: playlist.serverUrl,
                        username: playlist.username,
                        password: playlist.password,
                    };

                    try {
                        const response =
                            await apiService.getAccountInfo(credentials);
                        const portalStatus = resolvePortalStatus(response);
                        patchState(store, { portalStatus });
                        return portalStatus;
                    } catch (error) {
                        logger.error('Error checking portal status', error);
                        patchState(store, { portalStatus: 'unavailable' });
                        return 'unavailable';
                    }
                },

                /**
                 * Update playlist details
                 */
                updatePlaylist(updates: Partial<XtreamPlaylistData>): void {
                    const current = store.currentPlaylist();
                    if (current) {
                        patchState(store, {
                            currentPlaylist: { ...current, ...updates },
                        });
                    }
                },

                /**
                 * Reset portal state
                 */
                resetPortal(): void {
                    patchState(store, initialPortalState);
                },
            };
        })
    );
}
