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
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

export interface StalkerVodWatchedToggleConfig {
    playbackPositions: PortalPlaybackPositions;
    position: Signal<PlaybackPositionData | null>;
    applyPosition: (position: PlaybackPositionData | null) => void;
    playingNow: Signal<boolean>;
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
): VodWatchedToggle {
    return createVodWatchedToggle({
        playbackPositions: config.playbackPositions,
        position: config.position,
        applyPosition: config.applyPosition,
        playingNow: config.playingNow,
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
}
