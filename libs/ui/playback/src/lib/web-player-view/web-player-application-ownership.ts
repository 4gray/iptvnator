import { computed, type Signal } from '@angular/core';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { PlaybackBinding } from './playback-recovery-session';
import type {
    WebPlayerApplicationToken,
    WebPlayerSourceRevisionToken,
} from './web-player-application-state';

export interface PlaybackApplicationOwnership {
    readonly binding: PlaybackBinding | null;
    readonly embeddedMpv: boolean;
    readonly isLive: boolean;
    readonly sourceRevision: WebPlayerSourceRevisionToken;
    readonly token: WebPlayerApplicationToken;
}

export function ownsPlaybackApplication(options: {
    readonly ownership: PlaybackApplicationOwnership;
    readonly currentToken: WebPlayerApplicationToken;
    readonly currentSourceRevision: WebPlayerSourceRevisionToken;
    readonly bindingOwned: boolean;
    readonly embeddedMpvSelected: boolean;
}): boolean {
    const { ownership } = options;
    if (
        ownership.token !== options.currentToken ||
        ownership.sourceRevision !== options.currentSourceRevision
    ) {
        return false;
    }
    if (ownership.binding) {
        return !ownership.embeddedMpv && options.bindingOwned;
    }
    return ownership.embeddedMpv && options.embeddedMpvSelected;
}

/**
 * The engine applications the view renders: at most one, keyed by its
 * application token so a source or engine change remounts it.
 */
export function createRenderedApplications(deps: {
    readonly pending: Signal<boolean>;
    readonly activeBinding: Signal<PlaybackBinding | null>;
    readonly selectedPlayer: Signal<VideoPlayer>;
    readonly isLive: Signal<boolean>;
    readonly sourceRevision: Signal<WebPlayerSourceRevisionToken>;
    readonly token: Signal<WebPlayerApplicationToken>;
}): Signal<readonly PlaybackApplicationOwnership[]> {
    return computed<readonly PlaybackApplicationOwnership[]>(() => {
        if (deps.pending()) return [];
        const binding = deps.activeBinding();
        const embeddedMpv =
            deps.selectedPlayer() === VideoPlayer.EmbeddedMpv && !binding;
        if (!binding && !embeddedMpv) {
            return [];
        }

        return [
            Object.freeze({
                binding,
                embeddedMpv,
                isLive: deps.isLive(),
                sourceRevision: deps.sourceRevision(),
                token: deps.token(),
            }),
        ];
    });
}
