import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { XtreamSerieEpisode, XtreamVodDetails } from 'shared-interfaces';
import { PlayerService } from '../../../services/player.service';
import { XtreamCredentials } from '../../services/xtream-api.service';
import { XtreamUrlService } from '../../services/xtream-url.service';

/**
 * Player state for managing stream URLs and player settings
 */
export interface PlayerState {
    streamUrl: string | null;
    hideExternalInfoDialog: boolean;
}

/**
 * Initial player state
 */
const initialPlayerState: PlayerState = {
    streamUrl: null,
    hideExternalInfoDialog:
        localStorage.getItem('hideExternalInfoDialog') === 'true',
};

/**
 * Player feature store for managing stream playback.
 * Handles:
 * - Stream URL construction
 * - External player integration
 * - Player settings
 */
export function withPlayer() {
    return signalStoreFeature(
        withState<PlayerState>(initialPlayerState),

        withMethods((store) => {
            const urlService = inject(XtreamUrlService);
            const playerService = inject(PlayerService);

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

            /**
             * Helper to get playlist with headers from parent store
             */
            const getPlaylistFromStore = () => {
                const storeAny = store as any;
                return storeAny.currentPlaylist?.();
            };

            return {
                /**
                 * Construct and return live stream URL
                 */
                constructStreamUrl(item: any): string {
                    const credentials = getCredentialsFromStore();
                    if (!credentials) {
                        return '';
                    }

                    const streamUrl = urlService.constructLiveUrl(
                        credentials,
                        item.xtream_id
                    );

                    // Set selected item in parent store and load EPG
                    const storeAny = store as any;
                    if (storeAny.setSelectedItem) {
                        storeAny.setSelectedItem(item);
                    }
                    if (storeAny.loadEpg) {
                        storeAny.loadEpg();
                    }

                    patchState(store, { streamUrl });
                    return streamUrl;
                },

                /**
                 * Construct and return VOD stream URL
                 */
                constructVodStreamUrl(vodItem: XtreamVodDetails): string {
                    const credentials = getCredentialsFromStore();
                    if (!credentials) {
                        return '';
                    }

                    const streamUrl = urlService.constructVodUrl(
                        credentials,
                        vodItem
                    );
                    patchState(store, { streamUrl });
                    return streamUrl;
                },

                /**
                 * Construct and return series episode stream URL
                 */
                constructEpisodeStreamUrl(episode: XtreamSerieEpisode): string {
                    const credentials = getCredentialsFromStore();
                    if (!credentials) {
                        return '';
                    }

                    const streamUrl = urlService.constructEpisodeUrl(
                        credentials,
                        episode
                    );
                    patchState(store, { streamUrl });
                    return streamUrl;
                },

                /**
                 * Open external player with stream
                 */
                openPlayer(
                    streamUrl: string,
                    title: string,
                    thumbnail: string | null = null,
                    startTime?: number,
                    contentInfo?: any
                ): void {
                    const playlist = getPlaylistFromStore();
                    const storeAny = store as any;
                    const contentType =
                        storeAny.selectedContentType?.() || 'vod';

                    playerService.openPlayer(
                        streamUrl,
                        title,
                        thumbnail,
                        localStorage.getItem('hideExternalInfoDialog') ===
                            'true',
                        contentType === 'live',
                        playlist?.userAgent,
                        playlist?.referrer,
                        playlist?.origin,
                        contentInfo,
                        startTime
                    );
                },

                /**
                 * Set hide external info dialog preference
                 */
                setHideExternalInfoDialog(hide: boolean): void {
                    localStorage.setItem(
                        'hideExternalInfoDialog',
                        String(hide)
                    );
                    patchState(store, { hideExternalInfoDialog: hide });
                },

                /**
                 * Reset player state
                 */
                resetPlayer(): void {
                    patchState(store, {
                        streamUrl: null,
                        hideExternalInfoDialog:
                            localStorage.getItem('hideExternalInfoDialog') ===
                            'true',
                    });
                },
            };
        })
    );
}
