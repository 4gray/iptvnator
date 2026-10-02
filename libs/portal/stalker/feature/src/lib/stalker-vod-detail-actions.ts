import type { WritableSignal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import type {
    PortalPlaybackPositions,
    PortalPlayer,
} from '@iptvnator/portal/shared/util';
import type {
    ExternalPlayerName,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';

export interface StalkerVodExternalPlayEvent {
    readonly item: VodDetailsItem;
    readonly player: ExternalPlayerName;
    readonly positionSeconds: number | null;
}

interface StalkerVodDetailActionsDeps {
    readonly resolvePlayback: (
        cmd: string | undefined,
        title: string | undefined,
        thumbnail: string | undefined,
        startTime: number | undefined
    ) => Promise<ResolvedPortalPlayback>;
    readonly portalPlayer: Pick<PortalPlayer, 'openExternalPlayback'>;
    /** Download of the movie file; absent for hosts without downloads. */
    readonly download?: (item: VodDetailsItem) => Promise<void>;
    readonly playbackPositions: Pick<
        PortalPlaybackPositions,
        'clearPlaybackPositionOrThrow'
    >;
    readonly playlistId: () => string | undefined;
    readonly selectedVodPosition: WritableSignal<PlaybackPositionData | null>;
    readonly beforeExternalLaunch?: () => void;
    readonly afterProgressReset?: (playlistId: string) => void;
    readonly snackBar: Pick<MatSnackBar, 'open'>;
    readonly translate: Pick<TranslateService, 'instant'>;
    readonly logError: (message: string, error: unknown) => void;
}

/**
 * The "…" menu actions of a Stalker movie that need the store: "Open in
 * external player" resolves the stream (a `create_link` round trip) and
 * hands it to MPV/VLC; "Reset progress" clears the saved position.
 */
export function createStalkerVodDetailActions(deps: StalkerVodDetailActionsDeps) {
    const notify = (key: string) =>
        deps.snackBar.open(deps.translate.instant(key), undefined, {
            duration: 3000,
        });

    return {
        /** The inline player copied the stream URL. */
        notifyCopied(): void {
            notify('PORTALS.STREAM_URL_COPIED');
        },

        /** The inline player asked for MPV/VLC after a failure. */
        handleExternalFallback(request: PlaybackFallbackRequest): void {
            request.trackLaunch(
                deps.portalPlayer.openExternalPlayback(
                    request.playback,
                    request.player
                )
            );
        },

        download(item: VodDetailsItem): Promise<void> {
            return deps.download?.(item) ?? Promise.resolve();
        },

        async openExternal(event: StalkerVodExternalPlayEvent): Promise<void> {
            if (event.item.type !== 'stalker') {
                return;
            }
            try {
                const playback = await deps.resolvePlayback(
                    event.item.cmd,
                    event.item.data.info?.name,
                    event.item.data.info?.movie_image,
                    event.positionSeconds ?? undefined
                );
                deps.beforeExternalLaunch?.();
                await deps.portalPlayer.openExternalPlayback(
                    playback,
                    event.player
                );
            } catch (error) {
                deps.logError('External VOD playback failed', error);
                notify('PORTALS.PLAYBACK_ERROR');
            }
        },

        async resetProgress(item: VodDetailsItem): Promise<void> {
            const playlistId = deps.playlistId();
            const vodId = Number(item.type === 'stalker' ? item.data.id : NaN);
            if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) {
                return;
            }
            try {
                await deps.playbackPositions.clearPlaybackPositionOrThrow(
                    playlistId,
                    vodId,
                    'vod'
                );
            } catch (error) {
                deps.logError('Resetting the VOD position failed', error);
                return;
            }
            deps.selectedVodPosition.set(null);
            deps.afterProgressReset?.(playlistId);
            notify('PORTALS.DETAIL.PROGRESS_RESET');
        },
    };
}
