import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withProps,
    withMethods,
    withState,
} from '@ngrx/signals';
import { Playlist, PlaylistMeta, STALKER_REQUEST } from 'shared-interfaces';
import { DataService, StalkerSessionService } from 'services';
import { createLogger } from '../../../shared/utils/logger';

/**
 * Portal/session state and methods.
 */
export interface StalkerPortalState {
    currentPlaylist: PlaylistMeta;
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
                    params: Record<string, any>
                ) {
                    // Get token if it's a full stalker portal
                    let token: string | undefined;
                    let serialNumber: string | undefined;
                    if ((playlist as Playlist).isFullStalkerPortal) {
                        try {
                            const result = await stalkerSession.ensureToken(
                                playlist as Playlist
                            );
                            token = result.token ?? undefined;
                            serialNumber = (playlist as Playlist)
                                .stalkerSerialNumber;
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
        withMethods((store, dataService = inject(DataService)) => ({
            async setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
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
                        const playlistId = String(playlist._id);
                        // Check if playlist exists in SQLite
                        const existing =
                            await window.electron.dbGetPlaylist(playlistId);
                        if (!existing) {
                            // Create playlist in SQLite
                            await window.electron.dbCreatePlaylist({
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
        }))
    );
}
