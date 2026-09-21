import { Injectable, inject, signal } from '@angular/core';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
} from '@iptvnator/ui/components';

/**
 * Watch progress for the episodes of one M3U series.
 *
 * Nothing about the storage is M3U-specific: the aggregator mints numeric
 * episode ids precisely so the existing `playback_positions` rows, IPC and
 * shared UI all work unchanged. This service is only the per-page state
 * around them, kept out of the route component so that component stays
 * within the file-size limit.
 *
 * In the PWA the bridge reports no storage and every call is a no-op that
 * resolves empty, so the season grid simply renders without watched marks.
 */
@Injectable()
export class M3uSeriesPositionsService {
    private readonly bridge = inject(PlaybackPositionRuntimeBridgeService);

    // A plain Map rather than a ReadonlyMap: that is the shape the shared
    // season grid's input declares, and every write here replaces the map
    // wholesale, so it is immutable in practice regardless.
    private readonly positions = signal<Map<number, PlaybackPositionData>>(
        new Map()
    );

    /** Keyed by episode id, which is what the shared season grid looks up. */
    readonly byEpisodeId = this.positions.asReadonly();

    async load(playlistId: string, seriesId: number): Promise<void> {
        if (!playlistId || !seriesId) {
            this.positions.set(new Map());
            return;
        }

        const rows = await this.bridge.getSeriesPlaybackPositions(
            playlistId,
            seriesId
        );
        this.positions.set(
            new Map(rows.map((row) => [row.contentXtreamId, row]))
        );
    }

    /**
     * Records progress while an episode plays.
     *
     * Writes through the non-throwing save: a dropped progress tick is a
     * lost second of resume accuracy, not something worth surfacing to
     * someone who is watching. Local state is updated first so the grid
     * reflects the tick even if the write is slow.
     */
    async recordProgress(
        playlistId: string,
        position: PlaybackPositionData
    ): Promise<void> {
        if (!playlistId) {
            return;
        }

        this.patch(position);
        await this.bridge.savePlaybackPosition(playlistId, position);
    }

    /**
     * Applies a watched/unwatched toggle from the season grid.
     *
     * The grid already decided what each episode's row should become — a
     * full-progress position, or nothing — so this only persists the
     * decision and reloads. Reloading rather than trusting the local patch
     * keeps the grid honest if any single write failed.
     */
    async applyToggle(
        playlistId: string,
        seriesId: number,
        request:
            | SeasonContainerPlaybackToggleRequest
            | SeasonContainerSeriesPlaybackToggleRequest
    ): Promise<void> {
        if (!playlistId) {
            return;
        }

        const requests = 'requests' in request ? request.requests : [request];

        for (const item of requests) {
            if (item.nextPosition) {
                await this.bridge.savePlaybackPosition(
                    playlistId,
                    item.nextPosition
                );
            } else {
                await this.bridge.clearPlaybackPosition(
                    playlistId,
                    item.contentXtreamId,
                    'episode'
                );
            }
        }

        await this.load(playlistId, seriesId);
    }

    private patch(position: PlaybackPositionData): void {
        const next = new Map(this.positions());
        next.set(position.contentXtreamId, position);
        this.positions.set(next);
    }
}
