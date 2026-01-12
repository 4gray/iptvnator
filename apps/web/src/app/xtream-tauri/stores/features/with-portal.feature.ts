import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { selectActivePlaylist } from 'm3u-state';
import { Playlist } from 'shared-interfaces';
import {
    XTREAM_DATA_SOURCE,
    XtreamPlaylistData,
} from '../../data-sources/xtream-data-source.interface';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../../services/xtream-api.service';
import { PortalStatusType } from '../../xtream-state';

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
    return signalStoreFeature(
        withState<PortalState>(initialPortalState),

        withMethods((store) => {
            const apiService = inject(XtreamApiService);
            const dataSource = inject(XTREAM_DATA_SOURCE);
            const ngrxStore = inject(Store);

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
                        } else {
                            // Fallback to NgRx store for M3U playlists that might not be in DB yet
                            const activePlaylist = ngrxStore.selectSignal(
                                selectActivePlaylist
                            )() as Playlist;

                            if (activePlaylist) {
                                const newPlaylist: XtreamPlaylistData = {
                                    id: activePlaylist._id,
                                    name: activePlaylist.title,
                                    serverUrl: activePlaylist.serverUrl,
                                    username: activePlaylist.username,
                                    password: activePlaylist.password,
                                    type: 'xtream',
                                };

                                await dataSource.createPlaylist(newPlaylist);
                                patchState(store, {
                                    currentPlaylist: newPlaylist,
                                });
                            }
                        }
                    } catch (error) {
                        console.error('Error fetching playlist:', error);
                    }
                },

                /**
                 * Check portal status via API
                 */
                async checkPortalStatus(): Promise<void> {
                    const playlist = store.currentPlaylist();
                    if (!playlist) {
                        patchState(store, { portalStatus: 'unavailable' });
                        return;
                    }

                    const credentials: XtreamCredentials = {
                        serverUrl: playlist.serverUrl,
                        username: playlist.username,
                        password: playlist.password,
                    };

                    try {
                        const response =
                            await apiService.getAccountInfo(credentials);

                        if (!response?.user_info?.status) {
                            patchState(store, { portalStatus: 'unavailable' });
                            return;
                        }

                        if (response.user_info.status === 'Active') {
                            const expDate = new Date(
                                parseInt(response.user_info.exp_date) * 1000
                            );
                            if (expDate < new Date()) {
                                patchState(store, { portalStatus: 'expired' });
                            } else {
                                patchState(store, { portalStatus: 'active' });
                            }
                        } else {
                            patchState(store, { portalStatus: 'inactive' });
                        }
                    } catch (error) {
                        console.error('Error checking portal status:', error);
                        patchState(store, { portalStatus: 'unavailable' });
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
