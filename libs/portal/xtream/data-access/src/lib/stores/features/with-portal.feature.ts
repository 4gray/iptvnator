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
            auth?: number | string | boolean;
            exp_date?: string;
            status?: string;
        };
    } | null): PortalStatusType => {
        const userInfo = response?.user_info;
        const status = userInfo?.status?.trim().toLowerCase();
        const auth = userInfo?.auth;
        const isAuthenticated =
            auth === true || auth === 1 || auth === '1' || auth === 'true';

        if (!status && !isAuthenticated) {
            return 'unavailable';
        }

        if (!status || status === 'active') {
            const rawExpDate = userInfo?.exp_date;
            if (!rawExpDate || rawExpDate === '0') {
                return 'active';
            }

            const expTimestamp = parseInt(rawExpDate, 10);
            if (!Number.isFinite(expTimestamp) || expTimestamp <= 0) {
                return 'active';
            }

            const expDate = new Date(expTimestamp * 1000);
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
                            const currentPlaylist = store.currentPlaylist();
                            patchState(store, {
                                currentPlaylist: {
                                    ...playlist,
                                    vpnProvider:
                                        playlist.vpnProvider ??
                                        currentPlaylist?.vpnProvider,
                                    vpnLocation:
                                        playlist.vpnLocation ??
                                        currentPlaylist?.vpnLocation,
                                    vpnAutoConnectOnOpen:
                                        playlist.vpnAutoConnectOnOpen ??
                                        currentPlaylist?.vpnAutoConnectOnOpen,
                                    vpnAutoConnectWhenDefault:
                                        playlist.vpnAutoConnectWhenDefault ??
                                        currentPlaylist
                                            ?.vpnAutoConnectWhenDefault,
                                },
                            });
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
                        sourceVpn: {
                            provider: playlist.vpnProvider,
                            location: playlist.vpnLocation,
                            sourceId: playlist.id,
                            sourceTitle: playlist.name ?? playlist.title,
                        },
                    };

                    try {
                        const response =
                            await apiService.getAccountInfo(credentials);
                        const portalStatus = resolvePortalStatus(response);
                        const serverTimezone =
                            response?.server_info?.timezone ?? undefined;
                        patchState(store, { portalStatus });
                        if (serverTimezone) {
                            const current = store.currentPlaylist();
                            if (current) {
                                patchState(store, {
                                    currentPlaylist: {
                                        ...current,
                                        serverTimezone,
                                    },
                                });
                            }
                        }
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
