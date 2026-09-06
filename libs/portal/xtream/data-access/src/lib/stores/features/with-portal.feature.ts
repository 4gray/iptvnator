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
import {
    resolveXtreamPortalStatus,
    resolveXtreamServerTimezone,
} from '@iptvnator/shared/interfaces';

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

            /**
             * Whether a playlist (the store's current one, or the stored
             * row) still points at the panel an account-info answer came
             * from. The playlist id alone is not enough: an in-place edit
             * keeps the id while moving the source, and an answer already on
             * the wire for the OLD panel must not describe the new one.
             */
            const answersFor = (
                candidate: {
                    serverUrl?: string;
                    username?: string;
                    password?: string;
                } | null,
                credentials: XtreamCredentials
            ): boolean =>
                !!candidate &&
                candidate.serverUrl === credentials.serverUrl &&
                candidate.username === credentials.username &&
                candidate.password === credentials.password;

            /**
             * The Favorites / Recent catch-up resolver reads the STORED
             * playlist row, not this store, so a timezone learned here has
             * to reach storage or that path keeps rendering programme
             * start times in the viewer's clock (issue #1562). The data
             * source applies it atomically against the row's current
             * connection (see `IXtreamDataSource.rememberServerTimezone`);
             * a failed write never fails the status check that learned it.
             */
            const rememberServerTimezone = async (
                playlistId: string,
                credentials: XtreamCredentials,
                serverTimezone: string
            ): Promise<void> => {
                try {
                    await dataSource.rememberServerTimezone(
                        playlistId,
                        credentials,
                        serverTimezone
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
                        // The answer belongs to the panel whose credentials
                        // were sent: its timezone is offered to THAT row
                        // regardless, while the store is patched only if the
                        // selected playlist is still that panel — neither a
                        // source switch nor an in-place edit during the
                        // request may hand the old panel's status or clock
                        // to the new one.
                        const current = store.currentPlaylist();
                        const describesCurrent =
                            current?.id === playlist.id &&
                            answersFor(current, credentials);
                        if (describesCurrent) {
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
                        // Always offered to storage, never gated on the
                        // in-memory value: after a transient write failure
                        // the store already carries the clock, and only the
                        // row-level check inside the transform knows whether
                        // the row does too.
                        if (serverTimezone) {
                            await rememberServerTimezone(
                                playlist.id,
                                credentials,
                                serverTimezone
                            );
                        }
                        // Callers gate content initialization on this value
                        // for whatever is selected NOW; an answer about
                        // another panel must not unblock it.
                        return describesCurrent
                            ? portalStatus
                            : store.portalStatus();
                    } catch (error) {
                        logger.error('Error checking portal status', error);
                        const current = store.currentPlaylist();
                        if (
                            current?.id === playlist.id &&
                            answersFor(current, credentials)
                        ) {
                            patchState(store, { portalStatus: 'unavailable' });
                        }
                        // The old panel's failure says nothing about a
                        // playlist selected or edited meanwhile.
                        return store.portalStatus();
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
