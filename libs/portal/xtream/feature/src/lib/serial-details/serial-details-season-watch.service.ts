import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { SeasonContainerSeriesPlaybackToggleRequest } from '@iptvnator/ui/components';
import { SerialDetailsPlaybackPositionState } from './serial-details-playback-position-state';

// The marked-watched key is scope-generic on purpose ("{{count}} episodes
// marked as watched"); only unmark and failure name their scope.
const WATCH_TOGGLE_FEEDBACK = {
    season: {
        marked: 'XTREAM.SEASON_MARKED_WATCHED',
        unmarked: 'XTREAM.SEASON_MARKED_UNWATCHED',
        failed: 'XTREAM.SEASON_WATCH_UPDATE_FAILED',
    },
    series: {
        marked: 'XTREAM.SEASON_MARKED_WATCHED',
        unmarked: 'XTREAM.SERIES_MARKED_UNWATCHED',
        failed: 'XTREAM.SERIES_WATCH_UPDATE_FAILED',
    },
} as const;

export type SerialDetailsWatchScope = keyof typeof WATCH_TOGGLE_FEEDBACK;

/**
 * Season- and series-level bulk watched toggle for the serial details view:
 * one batch persistence call, host state update, and user feedback.
 */
@Injectable()
export class SerialDetailsSeasonWatchService {
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    readonly batchRunning = signal(false);

    async handle(
        request: SeasonContainerSeriesPlaybackToggleRequest,
        playlistId: string,
        state: Pick<
            SerialDetailsPlaybackPositionState,
            'updateMany' | 'removeMany'
        >,
        // The component is reused across detail navigations and resets the
        // position state for the next series while a batch may still be in
        // flight; a stale completion must not write the old series' rows
        // into it (episode ids can collide across playlists) nor present
        // its contextless snackbar as feedback about the newly opened page.
        // The DB write itself is safe — it carries its own playlistId.
        stillCurrent: () => boolean,
        scope: SerialDetailsWatchScope = 'season'
    ): Promise<boolean> {
        const feedback = WATCH_TOGGLE_FEEDBACK[scope];
        if (!playlistId || request.requests.length === 0 || this.batchRunning()) {
            return false;
        }

        this.batchRunning.set(true);
        try {
            if (request.markWatched) {
                const positions = request.requests
                    .map((item) => item.nextPosition)
                    .filter(
                        (position): position is PlaybackPositionData =>
                            position !== null
                    );
                await this.playbackPositions.savePlaybackPositionsBatch(
                    playlistId,
                    positions
                );
                if (!stillCurrent()) {
                    return true;
                }
                state.updateMany(positions);
                this.notify(feedback.marked, {
                    count: positions.length,
                });
            } else {
                await this.playbackPositions.clearPlaybackPositionsBatch(
                    playlistId,
                    request.requests.map((item) => ({
                        contentXtreamId: item.contentXtreamId,
                        contentType: 'episode' as const,
                    }))
                );
                if (!stillCurrent()) {
                    return true;
                }
                state.removeMany(
                    request.requests.map((item) => item.contentXtreamId)
                );
                this.notify(feedback.unmarked);
            }
            return true;
        } catch (error) {
            // Nothing was confirmed persisted — keep the rendered state and
            // report instead of showing episodes as (un)watched.
            console.error(
                '[SerialDetailsSeasonWatch] Watched toggle failed',
                { scope },
                error
            );
            if (stillCurrent()) {
                this.notify(feedback.failed);
            }
            return false;
        } finally {
            this.batchRunning.set(false);
        }
    }

    private notify(key: string, params?: object): void {
        this.snackBar.open(this.translate.instant(key, params), undefined, {
            duration: 5000,
        });
    }
}
