import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withProps,
    withState,
} from '@ngrx/signals';
import { PlaylistMeta, STALKER_REQUEST } from 'shared-interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import { DataService } from 'services';
import { StalkerSessionService } from '../../stalker-session.service';
import { toStalkerSessionPlaylist } from '../utils';

type StalkerPortalWindow = Window & {
    electron?: {
        dbCreatePlaylist: (playlist: {
            id: string;
            name: string;
            macAddress: string;
            url: string;
            type: 'stalker';
        }) => Promise<unknown>;
        dbGetPlaylist: (playlistId: string) => Promise<unknown>;
    };
};

/**
 * Portal/session state and methods.
 */
export interface StalkerPortalState {
    currentPlaylist: PlaylistMeta | undefined;
}

const initialPortalState: StalkerPortalState = {
    currentPlaylist: undefined,
};

export function withStalkerPortal() {
    const logger = createLogger('withStalkerPortal');
    return signalStoreFeature(
        withState<StalkerPortalState>(initialPortalState),
        withProps(
            (
                _store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService)
            ) => ({
                /**
                 * Helper to make stalker requests with automatic token handling
                 */
                async makeStalkerRequest(
                    playlist: PlaylistMeta,
                    params: Record<string, string | number>
                ) {
                    // Get token if it's a full stalker portal
                    let token: string | undefined;
                    let serialNumber: string | undefined;
                    if (playlist.isFullStalkerPortal) {
                        try {
                            const result = await stalkerSession.ensureToken(
                                toStalkerSessionPlaylist(playlist)
                            );
                            token = result.token ?? undefined;
                            serialNumber = playlist.stalkerSerialNumber;
                        } catch (error) {
                            logger.error('Failed to get stalker token', error);
                        }
                    }

                    return dataService.sendIpcEvent(STALKER_REQUEST, {
                        url: playlist.portalUrl,
                        macAddress: playlist.macAddress,
                        params,
                        token,
                        serialNumber,
                    });
                },
            })
        ),
        withMethods(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService)
            ) => ({
                async setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
                    stalkerSession.setActiveWatchdogPlaylist(
                        playlist
                            ? toStalkerSessionPlaylist(playlist)
                            : undefined
                    );
                    patchState(store, { currentPlaylist: playlist });

                    // Ensure Stalker playlist exists in SQLite for playback positions
                    // Only sync if this is actually a Stalker playlist (has macAddress and portalUrl)
                    if (
                        playlist &&
                        dataService.isElectron &&
                        playlist._id &&
                        playlist.macAddress &&
                        playlist.portalUrl
                    ) {
                        try {
                            const electronApi = (window as StalkerPortalWindow)
                                .electron;
                            if (!electronApi) {
                                return;
                            }

                            const playlistId = String(playlist._id);
                            // Check if playlist exists in SQLite
                            const existing =
                                await electronApi.dbGetPlaylist(playlistId);
                            if (!existing) {
                                // Create playlist in SQLite
                                await electronApi.dbCreatePlaylist({
                                    id: playlistId,
                                    name: playlist.title || '',
                                    macAddress: playlist.macAddress || '',
                                    url: playlist.portalUrl || '',
                                    type: 'stalker',
                                });
                            }
                        } catch (error) {
                            logger.error(
                                'Error syncing Stalker playlist to SQLite',
                                error
                            );
                        }
                    }
                },
            })
        )
    );
}
