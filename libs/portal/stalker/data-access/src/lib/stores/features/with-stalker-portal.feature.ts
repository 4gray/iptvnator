import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withProps,
    withState,
} from '@ngrx/signals';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import { DataService, RuntimeCapabilitiesService } from '@iptvnator/services';
import { StalkerSessionService } from '../../stalker-session.service';
import { executeStalkerRequest } from '../utils';

type StalkerPortalWindow = Window & {
    electron: {
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
                 * Routes full portals through the main-owned session facade.
                 */
                async makeStalkerRequest(
                    playlist: PlaylistMeta,
                    params: Record<string, string | number>
                ) {
                    return executeStalkerRequest(
                        {
                            dataService,
                            stalkerSession,
                        },
                        playlist,
                        params
                    );
                },
            })
        ),
        withMethods((store, runtime = inject(RuntimeCapabilitiesService)) => ({
            async setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
                patchState(store, { currentPlaylist: playlist });

                // Ensure Stalker playlist exists in SQLite for playback positions
                // Only sync if this is actually a Stalker playlist (has macAddress and portalUrl)
                if (
                    playlist &&
                    runtime.supportsStalkerPlaylistSqliteSync &&
                    playlist._id &&
                    playlist.macAddress &&
                    playlist.portalUrl
                ) {
                    try {
                        const electronApi = (window as StalkerPortalWindow)
                            .electron;

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
        }))
    );
}
