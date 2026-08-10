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
