import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { PlaybackPositionService } from '@iptvnator/services';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
} from '@iptvnator/ui/components';

/** How often a playing episode's progress reaches storage. */
const PROGRESS_SAVE_INTERVAL_MS = 15_000;

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
 *
 * It goes through `PlaybackPositionService` rather than the runtime bridge
 * underneath it. Every caller here starts its promise with `void` — from an
 * effect, a media time update or a click handler — so a rejecting IPC call
 * would surface as an unhandled rejection rather than as the established
 * safe empty/no-op behaviour. The bridge only resolves early when storage
 * is ABSENT; a present database that fails still rejects.
 */
@Injectable()
export class M3uSeriesPositionsService implements OnDestroy {
    private readonly bridge = inject(PlaybackPositionService);

    /**
     * When the playing episode's progress was last written.
     *
     * A media element fires `timeupdate` about four times a second. Writing
     * each one would queue thousands of SQLite round-trips across one
     * episode and patch the signal just as often; the portals' series pages
     * coalesce to the same 15 s window.
     */
    private lastSaveAt = 0;

    private lastSavedEpisodeId = 0;

    /**
     * The newest tick the throttle held back. Without it, closing the
     * player, switching episodes or leaving the page throws away up to 15 s
     * of progress, and the next visit resumes from an older point.
     */
    private pending: {
        readonly playlistId: string;
        readonly position: PlaybackPositionData;
    } | null = null;

    // A plain Map rather than a ReadonlyMap: that is the shape the shared
    // season grid's input declares, and every write here replaces the map
    // wholesale, so it is immutable in practice regardless.
    private readonly positions = signal<Map<number, PlaybackPositionData>>(
        new Map()
    );

    /** Keyed by episode id, which is what the shared season grid looks up. */
    readonly byEpisodeId = this.positions.asReadonly();

    /**
     * Which request owns the state. Navigating between series issues a
     * second read while the first is still in the database worker, and
     * without this the slower one wins — showing the previous show's
     * watched and resume state on the page now open.
     */
    private loadToken = 0;

    /** The playlist/series the published map describes. */
    private owner = '';

    async load(playlistId: string, seriesId: number): Promise<void> {
        const token = ++this.loadToken;
        // The held-back tick belongs to the series being left, and its row
        // is still the right one to write.
        void this.flushProgress();
        this.owner = `${playlistId}\u0000${seriesId}`;
        this.releaseProgressThrottle();

        if (!playlistId || !seriesId) {
            this.positions.set(new Map());
            return;
        }

        const rows = await this.bridge.getSeriesPlaybackPositions(
            playlistId,
            seriesId
        );
        if (token !== this.loadToken) {
            return;
        }

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
     *
     * Persistence is throttled to one write per episode per 15 s, but the
     * in-memory patch is not: the grid should follow the player smoothly
     * while the database sees a handful of rows per episode. Switching
     * episodes writes immediately, so the one just left keeps its offset.
     */
    async recordProgress(
        playlistId: string,
        position: PlaybackPositionData
    ): Promise<void> {
        if (!playlistId || !this.owns(playlistId, position.seriesXtreamId)) {
            // A tick from the player the viewer has already navigated away
            // from would otherwise patch the new series' map.
            return;
        }

        this.patch(position);

        const now = Date.now();
        if (
            position.contentXtreamId === this.lastSavedEpisodeId &&
            now - this.lastSaveAt <= PROGRESS_SAVE_INTERVAL_MS
        ) {
            this.pending = { playlistId, position };
            return;
        }

        if (
            this.pending?.position.contentXtreamId === position.contentXtreamId
        ) {
            // This write supersedes the held-back tick of the same episode.
            this.pending = null;
        } else {
            // A different episode: the one being left keeps its last offset.
            await this.flushProgress();
        }
        this.lastSaveAt = now;
        this.lastSavedEpisodeId = position.contentXtreamId;
        await this.bridge.savePlaybackPosition(playlistId, position);
    }

    /** Writes the tick the throttle held back, if there is one. */
    async flushProgress(): Promise<void> {
        const pending = this.pending;
        this.pending = null;
        if (pending) {
            await this.bridge.savePlaybackPosition(
                pending.playlistId,
                pending.position
            );
        }
    }

    /**
     * Saves what the throttle held back and forgets its window.
     *
     * Called when the player closes or another episode is chosen, so the
     * episode just left keeps its latest offset and the next one's first
     * tick is written straight away rather than waiting out the window.
     */
    releaseProgressThrottle(): void {
        void this.flushProgress();
        this.lastSaveAt = 0;
        this.lastSavedEpisodeId = 0;
    }

    /** Leaving the page mid-episode must not drop its last seconds. */
    ngOnDestroy(): void {
        void this.flushProgress();
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
        if (!playlistId || !this.owns(playlistId, seriesId)) {
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

    private owns(playlistId: string, seriesId: number | undefined): boolean {
        return this.owner === `${playlistId}\u0000${seriesId ?? 0}`;
    }

    private patch(position: PlaybackPositionData): void {
        const next = new Map(this.positions());
        next.set(position.contentXtreamId, position);
        this.positions.set(next);
    }
}
