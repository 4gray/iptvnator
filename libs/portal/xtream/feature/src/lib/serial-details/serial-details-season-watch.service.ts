import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { SeasonContainerSeasonPlaybackToggleRequest } from '@iptvnator/ui/components';
import { SerialDetailsPlaybackPositionState } from './serial-details-playback-position-state';

/**
 * Season-level bulk watched toggle for the serial details view: one batch
 * persistence call, host state update, and user feedback.
 */
@Injectable()
export class SerialDetailsSeasonWatchService {
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    readonly batchRunning = signal(false);

    async handle(
        request: SeasonContainerSeasonPlaybackToggleRequest,
        playlistId: string,
        state: Pick<
            SerialDetailsPlaybackPositionState,
            'updateMany' | 'removeMany'
        >,
        // The component is reused across detail navigations and resets the
        // position state for the next series while a batch may still be in
        // flight; a stale completion must not write the old series' rows
        // into it (episode ids can collide across playlists). The DB write
        // itself is safe — it carries its own playlistId.
        stillCurrent: () => boolean
    ): Promise<void> {
        if (!playlistId || request.requests.length === 0 || this.batchRunning()) {
            return;
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
                if (stillCurrent()) {
                    state.updateMany(positions);
                }
                this.notify('XTREAM.SEASON_MARKED_WATCHED', {
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
                if (stillCurrent()) {
                    state.removeMany(
                        request.requests.map((item) => item.contentXtreamId)
                    );
                }
                this.notify('XTREAM.SEASON_MARKED_UNWATCHED');
            }
        } catch (error) {
            // Nothing was confirmed persisted — keep the rendered state and
            // report instead of showing episodes as (un)watched.
            console.error(
                '[SerialDetailsSeasonWatch] Season watched toggle failed',
                error
            );
            this.notify('XTREAM.SEASON_WATCH_UPDATE_FAILED');
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
