import type { WritableSignal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import type { Logger, PortalPlayer } from '@iptvnator/portal/shared/util';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

/** The detail page as the owner of its inline player: it tracks its own request ids. */
interface StalkerCatalogVodPlaybackHost {
    playbackRequestId: number;
    readonly pendingStart: {
        begin(owner: string): number;
        settle(startId: number): void;
    };
    playbackOwnerKey(): string;
    playbackSessionKey(): string;
    readonly inlinePlayback: WritableSignal<ResolvedPortalPlayback | null>;
    closeInlinePlayer(): void;
}

interface StalkerCatalogVodPlaybackDeps {
    readonly resolvePlayback: () => Promise<ResolvedPortalPlayback>;
    readonly portalPlayer: Pick<
        PortalPlayer,
        'isEmbeddedPlayer' | 'openResolvedPlayback'
    >;
    /** Clears the inline position writer for the playback about to mount. */
    readonly resetPositionWriter: () => void;
    readonly logger: Pick<Logger, 'error'>;
    readonly translate: Pick<TranslateService, 'instant'>;
    readonly snackBar: Pick<MatSnackBar, 'open'>;
}

/**
 * Play/Resume of the movie on the routed catalog detail: resolves the
 * stream and hands it to the inline or the configured player, unless the
 * page moved on or a newer start took over while the portal answered.
 */
export async function startStalkerCatalogVodPlayback(
    host: StalkerCatalogVodPlaybackHost,
    deps: StalkerCatalogVodPlaybackDeps
): Promise<void> {
    const requestId = ++host.playbackRequestId;
    const sessionKey = host.playbackSessionKey();
    const ownerKey = host.playbackOwnerKey();
    const usesEmbeddedPlayer = deps.portalPlayer.isEmbeddedPlayer();
    if (usesEmbeddedPlayer && !sessionKey) return;

    const startId = host.pendingStart.begin(ownerKey);
    try {
        const playback = await deps.resolvePlayback();
        if (
            requestId !== host.playbackRequestId ||
            host.playbackOwnerKey() !== ownerKey
        ) {
            return;
        }

        deps.resetPositionWriter();
        if (usesEmbeddedPlayer) {
            host.inlinePlayback.set(playback);
            return;
        }

        host.closeInlinePlayer();
        void deps.portalPlayer.openResolvedPlayback(playback, true);
    } catch (error) {
        if (
            requestId !== host.playbackRequestId ||
            host.playbackOwnerKey() !== ownerKey
        ) {
            return;
        }
        deps.logger.error('Failed to start inline VOD playback', error);
        const errorMessage =
            error instanceof Error && error.message === 'nothing_to_play'
                ? deps.translate.instant('PORTALS.CONTENT_NOT_AVAILABLE')
                : deps.translate.instant('PORTALS.PLAYBACK_ERROR');
        deps.snackBar.open(errorMessage, undefined, {
            duration: 3000,
        });
    } finally {
        host.pendingStart.settle(startId);
    }
}
