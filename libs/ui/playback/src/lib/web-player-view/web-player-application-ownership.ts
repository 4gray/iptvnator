import { computed, type Signal } from '@angular/core';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { WebPlayerApplicationHandoffCoordinator } from './web-player-application-handoff';
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

export function createWebPlayerApplicationOwnership(options: {
    readonly sourceRevision: Signal<WebPlayerSourceRevisionToken>;
    readonly token: Signal<WebPlayerApplicationToken>;
    readonly binding: Signal<PlaybackBinding | null>;
    readonly selectedPlayer: Signal<VideoPlayer>;
    readonly isLive: Signal<boolean>;
    readonly renderable: () => boolean;
    readonly suspended: Signal<boolean>;
    readonly handoff: Pick<WebPlayerApplicationHandoffCoordinator, 'owns'>;
}) {
    const embeddedMpvSelected = () =>
        options.selectedPlayer() === VideoPlayer.EmbeddedMpv;
    return {
        rendered: computed<readonly PlaybackApplicationOwnership[]>(() => {
            if (!options.renderable() || options.suspended()) return [];
            const binding = options.binding();
            const embeddedMpv = !binding && embeddedMpvSelected();
            if (!binding && !embeddedMpv) return [];
            return [
                Object.freeze({
                    binding,
                    embeddedMpv,
                    isLive: options.isLive(),
                    sourceRevision: options.sourceRevision(),
                    token: options.token(),
                }),
            ];
        }),
        owns: (ownership: PlaybackApplicationOwnership) =>
            !options.suspended() &&
            ownsPlaybackApplication({
                ownership,
                currentToken: options.token(),
                currentSourceRevision: options.sourceRevision(),
                bindingOwned:
                    ownership.binding !== null &&
                    options.handoff.owns(ownership.binding, ownership.token),
                embeddedMpvSelected: embeddedMpvSelected(),
            }),
    };
}
