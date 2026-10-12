import {
    createLogger,
    type PortalPlaybackPositions,
} from '@iptvnator/portal/shared/util';
import type {
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerSeriesPlaybackToggleRequest,
} from '@iptvnator/ui/components';
import type { SerialDetailsPlaybackPositionState } from './serial-details-playback-position-state';
import type {
    SerialDetailsSeasonWatchService,
    SerialDetailsWatchScope,
} from './serial-details-season-watch.service';

const logger = createLogger('SerialDetailsPlayback');

/** What the watched toggles of the series page persist through and report to. */
export interface SerialDetailsWatchToggleDeps {
    readonly playbackPositions: Pick<
        PortalPlaybackPositions,
        'savePlaybackPosition' | 'clearPlaybackPosition'
    >;
    readonly seasonWatch: Pick<SerialDetailsSeasonWatchService, 'handle'>;
    readonly state: SerialDetailsPlaybackPositionState;
    /** Playlist on screen, empty while none is current. */
    readonly playlistId: () => string;
    /** Series on screen, 0 while none is selected. */
    readonly seriesXtreamId: () => number;
    /** Reloads the catalog store's positions of a playlist. */
    readonly reloadStorePositions: (playlistId: string) => Promise<unknown>;
}

/**
 * Episode, season and series watched toggles of the series page: persists
 * the change, mirrors it into the page's position state, and pushes it back
 * to the catalog store.
 */
export class SerialDetailsWatchToggles {
    constructor(private readonly deps: SerialDetailsWatchToggleDeps) {}

    async toggleEpisode(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.deps.playlistId();
        if (!playlistId) {
            return;
        }

        if (request.nextPosition) {
            await this.deps.playbackPositions.savePlaybackPosition(
                playlistId,
                request.nextPosition
            );
            this.deps.state.update(request.nextPosition);
        } else {
            await this.deps.playbackPositions.clearPlaybackPosition(
                playlistId,
                request.contentXtreamId,
                'episode'
            );
            this.deps.state.remove(request.contentXtreamId);
        }
        await this.refreshStorePositions(playlistId);
    }

    async toggleBatch(
        request: SeasonContainerSeriesPlaybackToggleRequest,
        scope: SerialDetailsWatchScope
    ): Promise<void> {
        const playlistId = this.deps.playlistId();
        const seriesXtreamId = this.deps.seriesXtreamId();
        const persisted = await this.deps.seasonWatch.handle(
            request,
            playlistId,
            this.deps.state,
            () =>
                this.deps.playlistId() === playlistId &&
                this.deps.seriesXtreamId() === seriesXtreamId,
            scope
        );
        if (persisted) {
            await this.refreshStorePositions(playlistId);
        }
    }

    /**
     * The catalog reads series progress from XtreamStore, whose positions
     * load once per playlist (XtreamCatalogFacadeService.initialize), so a
     * toggle must push the change back or badges go stale on return. Skipped
     * after a playlist switch — the store then holds the other playlist.
     */
    private async refreshStorePositions(playlistId: string): Promise<void> {
        if (this.deps.playlistId() !== playlistId) {
            return;
        }
        try {
            await this.deps.reloadStorePositions(playlistId);
        } catch (error) {
            // The toggle itself succeeded; a failed refresh keeps the store
            // populated-but-stale, which beats wiping it with a bad read.
            logger.warn('Store position refresh failed', error);
        }
    }
}
