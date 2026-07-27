import { signal } from '@angular/core';
import type { SeriesResumeTarget } from '@iptvnator/portal/shared/util';
import type {
    ExternalPlayerSession,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';

interface ResumeEpisodeRequest {
    playlistId: string;
    selectedItem: XtreamSerieDetailsView;
    target: SeriesResumeTarget;
}

export class SerialDetailsPlaybackPositionState {
    readonly positions = signal<Map<number, PlaybackPositionData>>(new Map());

    private loadRequestId = 0;
    private readonly loadedKey = signal<string | null>(null);
    private readonly consumedResumeKey = signal<string | null>(null);

    reset(): void {
        this.loadRequestId++;
        this.positions.set(new Map());
        this.loadedKey.set(null);
    }

    async load(
        playlistId: string,
        seriesXtreamId: number,
        loader: () => Promise<PlaybackPositionData[]>
    ): Promise<void> {
        const requestId = ++this.loadRequestId;
        this.loadedKey.set(null);
        let positions: PlaybackPositionData[] = [];
        let loadSucceeded = true;

        try {
            positions = await loader();
        } catch (error) {
            loadSucceeded = false;
            console.warn(
                '[SerialDetailsPlayback] Failed to load series playback positions',
                error
            );
        }

        if (requestId !== this.loadRequestId) {
            return;
        }

        this.positions.set(
            new Map(
                positions.map((position) => [
                    position.contentXtreamId,
                    position,
                ])
            )
        );
        // A failed load must not mark the series resume-ready: without the
        // persisted offsets a dashboard handoff would start the target
        // episode from the beginning instead of its saved position.
        if (loadSucceeded) {
            this.loadedKey.set(this.createKey(playlistId, seriesXtreamId));
        }
    }

    takeResumeEpisode(
        request: ResumeEpisodeRequest
    ): XtreamSerieEpisode | null {
        const seriesXtreamId = Number(request.selectedItem.series_id);
        if (
            request.target.seriesXtreamId !== seriesXtreamId ||
            this.loadedKey() !==
                this.createKey(request.playlistId, seriesXtreamId)
        ) {
            return null;
        }

        const resumeKey = [
            request.playlistId,
            request.target.seriesXtreamId,
            request.target.contentXtreamId,
            request.target.seasonNumber,
            request.target.episodeNumber,
        ].join(':');
        if (this.consumedResumeKey() === resumeKey) {
            return null;
        }

        const episodes: XtreamSerieEpisode[] = [];
        Object.values(request.selectedItem.episodes ?? {}).forEach(
            (seasonEpisodes) => episodes.push(...seasonEpisodes)
        );
        const episode =
            episodes.find(
                (item) => Number(item.id) === request.target.contentXtreamId
            ) ??
            episodes.find(
                (item) =>
                    Number(item.season) === request.target.seasonNumber &&
                    Number(item.episode_num) === request.target.episodeNumber
            ) ??
            null;

        if (episode) {
            this.consumedResumeKey.set(resumeKey);
        }
        return episode;
    }

    update(position: PlaybackPositionData): void {
        const updated = new Map(this.positions());
        updated.set(position.contentXtreamId, position);
        this.positions.set(updated);
    }

    remove(contentXtreamId: number): void {
        const updated = new Map(this.positions());
        updated.delete(contentXtreamId);
        this.positions.set(updated);
    }

    async recordExternalLaunch(
        playback: ResolvedPortalPlayback,
        launch: Promise<ExternalPlayerSession | void>,
        save: (
            playlistId: string,
            position: PlaybackPositionData
        ) => Promise<void>
    ): Promise<void> {
        const session = await launch;
        if (!session) {
            return;
        }

        const contentInfo = playback.contentInfo;
        if (!contentInfo || contentInfo.contentType !== 'episode') {
            return;
        }

        const existing = this.positions().get(contentInfo.contentXtreamId);
        const requestedPosition =
            playback.startTime ?? existing?.positionSeconds ?? 0;
        const positionSeconds = Number.isFinite(requestedPosition)
            ? Math.max(0, Math.floor(requestedPosition))
            : 0;
        const position: PlaybackPositionData = {
            ...contentInfo,
            playlistId: contentInfo.playlistId,
            positionSeconds,
            durationSeconds: existing?.durationSeconds,
            updatedAt: new Date().toISOString(),
        };

        await save(contentInfo.playlistId, position);
        this.update(position);
    }

    private createKey(playlistId: string, seriesXtreamId: number): string {
        return `${playlistId}:${seriesXtreamId}`;
    }
}
