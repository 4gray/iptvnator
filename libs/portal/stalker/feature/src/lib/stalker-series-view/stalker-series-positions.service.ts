import { Injectable, Signal, inject, signal, untracked } from '@angular/core';
import {
    PORTAL_PLAYBACK_POSITIONS,
    createLogger,
} from '@iptvnator/portal/shared/util';
import {
    StalkerStore,
    type StalkerSelectedVodItem,
} from '@iptvnator/portal/stalker/data-access';
import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { toStalkerSeriesId } from './stalker-series-id';
import {
    clearStalkerSeriesPosition,
    reconcileStalkerSeriesPositions,
    saveStalkerSeriesPosition,
    StalkerSeriesPositionPartialSaveError,
} from './stalker-series-position-compatibility';
import { StalkerSeriesPositionQueue } from './stalker-series-position-queue';

interface StalkerSeriesPositionsBindings {
    readonly displayItem: Signal<StalkerSelectedVodItem | null>;
    readonly mappedSeasons: Signal<Record<string, XtreamSerieEpisode[]>>;
}

/**
 * Saved episode positions of the series the Stalker series view shows: the
 * rows read from the repository, their mapping onto the episodes on the page
 * (scoped rows plus compatible legacy promotions) and the writes that keep
 * both in step. Component-scoped (provide it in the component's `providers`).
 */
@Injectable()
export class StalkerSeriesPositionsService {
    private readonly stalkerStore = inject(StalkerStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly migrationPlaybackPositions = {
        savePlaybackPosition: (
            playlistId: string,
            data: PlaybackPositionData
        ) =>
            this.playbackPositions.savePlaybackPositionOrThrow(
                playlistId,
                data
            ),
        clearPlaybackPosition: (
            playlistId: string,
            contentXtreamId: number,
            contentType: 'vod' | 'episode'
        ) =>
            this.playbackPositions.clearPlaybackPositionOrThrow(
                playlistId,
                contentXtreamId,
                contentType
            ),
    };
    private readonly logger = createLogger('StalkerSeriesView');
    private readonly bindings = signal<StalkerSeriesPositionsBindings | null>(
        null
    );
    readonly episodePlaybackPositions = signal<
        Map<number, PlaybackPositionData>
    >(new Map());
    readonly rawSeriesPositions = signal<readonly PlaybackPositionData[]>([]);
    /**
     * `playlistId:seriesId` once the persisted positions for the shown
     * series have been READ (a failed read leaves it null): the dashboard
     * resume handoff must not start an episode from the beginning because
     * the offsets have not arrived yet.
     */
    readonly seriesPositionsLoadedKey = signal<string | null>(null);
    private readonly legacyPositionByTrackingId = signal<
        Map<number, PlaybackPositionData>
    >(new Map());
    private readonly queue = new StalkerSeriesPositionQueue({
        isShown: (context) =>
            this.stalkerStore.currentPlaylist()?._id === context.playlistId &&
            this.shownSeriesId() === context.seriesXtreamId,
        read: (context) =>
            this.playbackPositions.getSeriesPlaybackPositions(
                context.playlistId,
                context.seriesXtreamId
            ),
        publish: (context, positions) => {
            this.rawSeriesPositions.set(positions);
            this.seriesPositionsLoadedKey.set(
                this.seriesPositionsKey(
                    context.playlistId,
                    context.seriesXtreamId
                )
            );
        },
    });

    bind(bindings: StalkerSeriesPositionsBindings): void {
        this.bindings.set(bindings);
    }

    /**
     * Starts over for the series on screen: drops what the previous series
     * left behind and reads the persisted rows. Reads the shown item and the
     * playlist, so an `effect` calling it re-runs when either changes.
     */
    loadShownSeries(): void {
        const item = this.displayItem();
        const playlist = this.stalkerStore.currentPlaylist();
        const normalizedSeriesId = toStalkerSeriesId(item?.id ?? 0);
        if (item && playlist?._id && normalizedSeriesId > 0) {
            this.logger.debug('Loading positions for series', {
                id: item.id,
                seriesId: normalizedSeriesId,
                isSeries: item.is_series,
            });
            this.rawSeriesPositions.set([]);
            this.seriesPositionsLoadedKey.set(null);
            this.episodePlaybackPositions.set(new Map());
            this.legacyPositionByTrackingId.set(new Map());
            const context = this.queue.activate(
                playlist._id,
                normalizedSeriesId
            );
            void this.queue.load(context);
        } else {
            this.queue.deactivate();
        }
    }

    /**
     * Maps the raw series position rows onto the currently mapped episodes
     * (scoped rows plus compatible legacy promotions). Runs reactively from
     * the component's constructor effect, and synchronously from the
     * series-level watch toggle right after it hydrates lazy seasons — the
     * effect only re-runs on the next change-detection tick, and enqueuing
     * the batch against the stale maps would miss the hydrated episodes'
     * legacy rows (an unwatch would leave rows behind that a later reconcile
     * resurrects as watched).
     */
    applyReconciledSeriesPositions(): void {
        const item = this.displayItem();
        const playlistId = this.stalkerStore.currentPlaylist()?._id;
        const seriesXtreamId = toStalkerSeriesId(item?.id ?? 0);
        const rawSeriesPositions = this.rawSeriesPositions();
        const episodesBySeason = this.bindings()?.mappedSeasons() ?? {};

        if (!item || !playlistId || seriesXtreamId <= 0) {
            if (rawSeriesPositions.length > 0) {
                this.rawSeriesPositions.set([]);
            }
            if (this.episodePlaybackPositions().size > 0) {
                this.episodePlaybackPositions.set(new Map());
            }
            if (this.legacyPositionByTrackingId().size > 0) {
                this.legacyPositionByTrackingId.set(new Map());
            }
            return;
        }

        const reconciled = reconcileStalkerSeriesPositions({
            seriesXtreamId,
            episodesBySeason,
            seriesPositions: rawSeriesPositions,
        });
        if (
            rawSeriesPositions.length === 0 &&
            reconciled.positionsByTrackingId.size === 0 &&
            untracked(() => this.episodePlaybackPositions().size) > 0
        ) {
            return;
        }
        this.episodePlaybackPositions.set(reconciled.positionsByTrackingId);
        this.legacyPositionByTrackingId.set(
            reconciled.legacyPositionByTrackingId
        );
    }

    seriesPositionsKey(playlistId: string, seriesXtreamId: number): string {
        return `${playlistId}:${seriesXtreamId}`;
    }

    persistSeriesPosition(
        playlistId: string,
        position: PlaybackPositionData
    ): Promise<void> {
        const context = this.queue.mutationContext(
            playlistId,
            position.seriesXtreamId
        );
        if (!context) {
            return Promise.resolve();
        }
        const legacyPosition = this.legacyPositionByTrackingId().get(
            position.contentXtreamId
        );
        return this.queue.enqueue(context, async () => {
            let clearedLegacy: boolean;
            try {
                clearedLegacy = await saveStalkerSeriesPosition({
                    repository: this.migrationPlaybackPositions,
                    playlistId,
                    position,
                    legacyPosition,
                });
            } catch (error) {
                if (
                    error instanceof StalkerSeriesPositionPartialSaveError &&
                    this.queue.isActive(context)
                ) {
                    this.publishSavedSeriesPosition(
                        position,
                        legacyPosition,
                        false
                    );
                }
                throw error;
            }
            if (!this.queue.isActive(context)) {
                return;
            }
            this.publishSavedSeriesPosition(
                position,
                legacyPosition,
                clearedLegacy
            );
        });
    }

    clearSeriesPosition(
        playlistId: string,
        contentXtreamId: number
    ): Promise<void> {
        const context = this.queue.mutationContext(playlistId);
        if (!context) {
            return Promise.resolve();
        }
        const position = this.episodePlaybackPositions().get(
            contentXtreamId
        ) ?? {
            contentXtreamId,
            contentType: 'episode',
            positionSeconds: 0,
            playlistId,
            seriesXtreamId: context.seriesXtreamId,
        };
        const legacyPosition =
            this.legacyPositionByTrackingId().get(contentXtreamId);
        return this.queue.enqueue(context, async () => {
            const clearedLegacy = await clearStalkerSeriesPosition({
                repository: this.migrationPlaybackPositions,
                playlistId,
                position,
                legacyPosition,
            });
            if (!this.queue.isActive(context)) {
                return;
            }
            this.publishClearedSeriesPosition(
                contentXtreamId,
                legacyPosition,
                clearedLegacy
            );
        });
    }

    private displayItem(): StalkerSelectedVodItem | null {
        return this.bindings()?.displayItem() ?? null;
    }

    private shownSeriesId(): number {
        return toStalkerSeriesId(this.displayItem()?.id ?? 0);
    }

    private publishSavedSeriesPosition(
        position: PlaybackPositionData,
        legacyPosition: PlaybackPositionData | undefined,
        clearedLegacy: boolean
    ): void {
        const removedTrackingIds = new Set([position.contentXtreamId]);
        if (clearedLegacy && legacyPosition) {
            removedTrackingIds.add(legacyPosition.contentXtreamId);
            const legacyPositions = new Map(this.legacyPositionByTrackingId());
            legacyPositions.delete(position.contentXtreamId);
            this.legacyPositionByTrackingId.set(legacyPositions);
        }

        this.rawSeriesPositions.set([
            ...this.rawSeriesPositions().filter(
                (candidate) =>
                    !removedTrackingIds.has(candidate.contentXtreamId)
            ),
            position,
        ]);
        this.updateEpisodePlaybackPosition(position);
    }

    private publishClearedSeriesPosition(
        contentXtreamId: number,
        legacyPosition: PlaybackPositionData | undefined,
        clearedLegacy: boolean
    ): void {
        const removedTrackingIds = new Set([contentXtreamId]);
        if (clearedLegacy && legacyPosition) {
            removedTrackingIds.add(legacyPosition.contentXtreamId);
            const legacyPositions = new Map(this.legacyPositionByTrackingId());
            legacyPositions.delete(contentXtreamId);
            this.legacyPositionByTrackingId.set(legacyPositions);
        }

        this.rawSeriesPositions.set(
            this.rawSeriesPositions().filter(
                (candidate) =>
                    !removedTrackingIds.has(candidate.contentXtreamId)
            )
        );
        this.removeEpisodePlaybackPosition(contentXtreamId);
    }

    private updateEpisodePlaybackPosition(
        position: PlaybackPositionData
    ): void {
        const updated = new Map(this.episodePlaybackPositions());
        updated.set(position.contentXtreamId, position);
        this.episodePlaybackPositions.set(updated);
    }

    private removeEpisodePlaybackPosition(contentXtreamId: number): void {
        const updated = new Map(this.episodePlaybackPositions());
        updated.delete(contentXtreamId);
        this.episodePlaybackPositions.set(updated);
    }
}
