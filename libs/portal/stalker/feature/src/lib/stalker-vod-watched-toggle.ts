import type { Signal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import {
    type Logger,
    type PortalPlaybackPositions,
    VOD_WATCHED_FEEDBACK_KEYS,
    type VodWatchedToggle,
    createVodWatchedToggle,
} from '@iptvnator/portal/shared/util';
import type {
    PlaybackPositionData,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';

/** The movie the host currently shows; null while nothing is open. */
export interface StalkerVodWatchedOwner {
    playlistId: string;
    vodId: number;
}

export interface StalkerVodWatchedToggle extends VodWatchedToggle {
    /** Toggles the item the child emitted, scoped to the owner on screen. */
    toggleItem(item: VodDetailsItem): Promise<boolean>;
}

export interface StalkerVodWatchedToggleConfig {
    owner: () => StalkerVodWatchedOwner | null;
    playbackPositions: PortalPlaybackPositions;
    position: Signal<PlaybackPositionData | null>;
    applyPosition: (position: PlaybackPositionData | null) => void;
    playingNow: Signal<boolean>;
    positionReady: Signal<boolean>;
    snackBar: MatSnackBar;
    translateService: TranslateService;
    logger: Logger;
    onPersisted?: (playlistId: string) => void | Promise<void>;
}

/**
 * The shared movie watched toggle with Stalker's snackbar feedback wired
 * in — one place for the routed catalog detail and the collection detail.
 */
export function createStalkerVodWatchedToggle(
    config: StalkerVodWatchedToggleConfig
): StalkerVodWatchedToggle {
    const toggle = createVodWatchedToggle({
        playbackPositions: config.playbackPositions,
        position: config.position,
        applyPosition: config.applyPosition,
        playingNow: config.playingNow,
        positionReady: config.positionReady,
        notify: (feedback) =>
            config.snackBar.open(
                config.translateService.instant(
                    VOD_WATCHED_FEEDBACK_KEYS[feedback]
                ),
                undefined,
                { duration: 5000 }
            ),
        onPersisted: config.onPersisted,
        logger: config.logger,
    });

    return {
        ...toggle,
        toggleItem(item) {
            const owner = config.owner();
            if (item.type !== 'stalker' || !owner) {
                return Promise.resolve(false);
            }
            return toggle.toggle({
                playlistId: owner.playlistId,
                contentXtreamId: Number(item.data.id),
                // Hosts are reused across movies: a late completion must
                // neither patch the next movie's row nor announce there.
                stillCurrent: () => {
                    const current = config.owner();
                    return (
                        current?.playlistId === owner.playlistId &&
                        current.vodId === owner.vodId
                    );
                },
            });
        },
    };
}
