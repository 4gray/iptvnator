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
import { PlaylistsService } from '@iptvnator/services';
import {
    resolveXtreamPortalStatus,
    resolveXtreamServerTimezone,
} from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';

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

    return signalStoreFeature(
        withState<PortalState>(initialPortalState),

        withMethods((store) => {
            const apiService = inject(XtreamApiService);
            const dataSource = inject(XTREAM_DATA_SOURCE);
            const playlistsService = inject(PlaylistsService);

            /**
             * The Favorites / Recent catch-up resolver reads the STORED
             * playlist row, not this store, so a timezone learned here has
             * to reach storage or that path keeps rendering programme
             * start times in the viewer's clock (issue #1562). The write
             * lands only on a row that still points at the panel the answer
             * came from — an edit that moved the source during the request
             * keeps the clock the edit flow dropped — is skipped when the
             * row already carries the value, and never fails the status
             * check that learned it.
             */
            const rememberServerTimezone = async (
                playlistId: string,
                credentials: XtreamCredentials,
                serverTimezone: string
            ): Promise<void> => {
                try {
                    await firstValueFrom(
                        playlistsService.transformPlaylistMeta(
                            playlistId,
                            (playlist) =>
                                playlist.serverUrl !== credentials.serverUrl ||
                                playlist.username !== credentials.username ||
                                playlist.password !== credentials.password ||
                                playlist.serverTimezone === serverTimezone
                                    ? null
                                    : { ...playlist, serverTimezone }
                        )
                    );
                } catch (error) {
                    logger.error(
                        'Failed to persist the portal timezone',
                        error
                    );
                }
            };

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
                        const portalStatus =
                            resolveXtreamPortalStatus(response);
                        // A response without a usable clock keeps whatever
                        // the row already knows; only a learned value
                        // replaces it.
                        const serverTimezone = resolveXtreamServerTimezone(
                            response?.server_info
                        );
                        const allowedOutputFormats = response?.user_info
                            ?.allowed_output_formats?.length
                            ? response.user_info.allowed_output_formats
                                  .map((format) => format.trim())
                                  .filter(Boolean)
                            : undefined;
                        // The answer belongs to the playlist whose
                        // credentials were sent: its timezone is persisted
                        // under THAT id regardless, while the store is
                        // patched only if that playlist is still the
                        // selected one — a source switch during the request
                        // must not hand playlist A's status or clock to
                        // playlist B.
                        const current = store.currentPlaylist();
                        if (current?.id === playlist.id) {
                            patchState(store, {
                                portalStatus,
                                currentPlaylist: {
                                    ...current,
                                    allowedOutputFormats,
                                    ...(serverTimezone
                                        ? { serverTimezone }
                                        : {}),
                                },
                            });
                        }
                        if (
                            serverTimezone &&
                            serverTimezone !== playlist.serverTimezone
                        ) {
                            await rememberServerTimezone(
                                playlist.id,
                                credentials,
                                serverTimezone
                            );
                        }
                        return portalStatus;
                    } catch (error) {
                        logger.error('Error checking portal status', error);
                        if (store.currentPlaylist()?.id === playlist.id) {
                            patchState(store, { portalStatus: 'unavailable' });
                        }
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
