import type { WritableSignal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import {
    replaceOwnedExternalSession,
    type PortalExternalPlayback,
    type PortalPlaybackPositions,
    type PortalPlayer,
} from '@iptvnator/portal/shared/util';
import type {
    ExternalPlayerName,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';

/** A start the explicit launch joins: superseded by, and superseding, every other start of its host. */
export interface PendingExternalLaunch {
    settle(): void;
    isCurrent(): boolean;
    /** Re-anchors to the host's current request id after the host's own teardown bumped it. */
    rebase(): void;
}

/** Builds a `PendingExternalLaunch` on a host that tracks its own request ids. */
export function beginTrackedExternalLaunch(host: {
    readonly pendingStart: {
        begin(owner: string): number;
        settle(startId: number): void;
    };
    playbackOwnerKey(): string;
    playbackRequestId: number;
}): PendingExternalLaunch {
    let requestId = ++host.playbackRequestId;
    const ownerKey = host.playbackOwnerKey();
    const startId = host.pendingStart.begin(ownerKey);
    return {
        settle: () => host.pendingStart.settle(startId),
        isCurrent: () =>
            requestId === host.playbackRequestId &&
            host.playbackOwnerKey() === ownerKey,
        rebase: () => {
            requestId = host.playbackRequestId;
        },
    };
}

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
    /** The running external session; this movie's own is replaced, never doubled. */
    readonly externalPlayback: Pick<
        PortalExternalPlayback,
        'activeSession' | 'closeSession'
    >;
    /** Download of the movie file; absent for hosts without downloads. */
    readonly download?: (item: VodDetailsItem) => Promise<void>;
    readonly playbackPositions: Pick<
        PortalPlaybackPositions,
        'clearPlaybackPositionOrThrow'
    >;
    readonly playlistId: () => string | undefined;
    /**
     * The movie on screen now, null while a series or nothing is selected:
     * Stalker movie and series ids collide, so the type matters as much as
     * the number. A reset or a launch finished for another one leaves it alone.
     */
    readonly selectedVodId: () => number | null;
    readonly selectedVodPosition: WritableSignal<PlaybackPositionData | null>;
    /** Retires a stored-position read in flight, which would restore the row. */
    readonly discardPendingPositionLoad?: () => void;
    readonly beforeExternalLaunch?: () => void;
    /** The explicit launch as one of the host's starts: pending while it resolves, dropped once superseded. */
    readonly beginPendingStart?: () => PendingExternalLaunch;
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
export function createStalkerVodDetailActions(
    deps: StalkerVodDetailActionsDeps
) {
    const notify = (key: string) =>
        deps.snackBar.open(deps.translate.instant(key), undefined, {
            duration: 3000,
        });
    // A second "Open in external player" for a movie whose `create_link` is
    // still resolving would resolve beside the first and start a second
    // player; other movies' launches are not held back by it.
    const externalLaunchesInFlight = new Set<string>();

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
            // The `create_link` round trip may outlive the selection: a
            // stream resolved for a movie the user left is dropped, and its
            // failure is not reported over the new one.
            const playlistId = deps.playlistId();
            const vodId = Number(event.item.data.id);
            const launchKey = `${playlistId}:${vodId}`;
            if (externalLaunchesInFlight.has(launchKey)) {
                return;
            }
            externalLaunchesInFlight.add(launchKey);
            const stillSelected = () =>
                deps.selectedVodId() === vodId &&
                deps.playlistId() === playlistId;
            const pending = deps.beginPendingStart?.();
            const superseded = () => pending?.isCurrent() === false;
            try {
                const playback = await deps.resolvePlayback(
                    event.item.cmd,
                    event.item.data.info?.name,
                    event.item.data.info?.movie_image,
                    event.positionSeconds ?? undefined
                );
                if (!stillSelected() || superseded()) {
                    return;
                }
                const replaced = await replaceOwnedExternalSession(
                    deps.externalPlayback,
                    (info) =>
                        info.contentType === 'vod' &&
                        info.playlistId === playlistId &&
                        Number(info.contentXtreamId) === vodId,
                    deps.logError
                );
                if (!replaced || !stillSelected() || superseded()) {
                    return;
                }
                deps.beforeExternalLaunch?.();
                // The host's inline teardown retired the request id too;
                // only a start made after this point supersedes the launch.
                pending?.rebase();
                const session = await deps.portalPlayer.openExternalPlayback(
                    playback,
                    event.player
                );
                // The page moved on, or a newer start took over, while the
                // launch sat inside the player IPC: the player it opened
                // must not stay beside what the viewer chose since.
                if (session && (!stillSelected() || superseded())) {
                    await deps.externalPlayback.closeSession(session);
                }
            } catch (error) {
                // A launch a newer start superseded fails on its own; the
                // newer one reports for the movie now.
                if (!stillSelected() || superseded()) {
                    return;
                }
                deps.logError('External VOD playback failed', error);
                notify('PORTALS.PLAYBACK_ERROR');
            } finally {
                externalLaunchesInFlight.delete(launchKey);
                pending?.settle();
            }
        },

        async resetProgress(item: VodDetailsItem): Promise<void> {
            const playlistId = deps.playlistId();
            const vodId = Number(item.type === 'stalker' ? item.data.id : NaN);
            if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) {
                return;
            }
            // Counted as a pending start of this movie: its Play, Start over
            // and launches are held until the write landed, or one made
            // meanwhile would resume from the very row being cleared.
            const pending = deps.beginPendingStart?.();
            try {
                await deps.playbackPositions.clearPlaybackPositionOrThrow(
                    playlistId,
                    vodId,
                    'vod'
                );
            } catch (error) {
                deps.logError('Resetting the VOD position failed', error);
                return;
            } finally {
                pending?.settle();
            }
            // The clear was async: only the movie still on screen loses its
            // shown progress, and no older read may put it back.
            if (
                deps.selectedVodId() === vodId &&
                deps.playlistId() === playlistId
            ) {
                deps.discardPendingPositionLoad?.();
                deps.selectedVodPosition.set(null);
            }
            deps.afterProgressReset?.(playlistId);
            notify('PORTALS.DETAIL.PROGRESS_RESET');
        },
    };
}
