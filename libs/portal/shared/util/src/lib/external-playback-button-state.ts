import { computed, type Signal } from '@angular/core';
import type {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';

/**
 * Derives the primary Play/Stop button's state from the active external
 * (MPV/VLC) session.
 *
 * Extracted because Xtream and Stalker each carried a near-identical private
 * copy of these six computeds. A single Play button that behaves differently
 * per portal is a bug waiting to happen, so both now read from here.
 */

export type ExternalPlaybackButtonState = 'idle' | 'launching' | 'stop';

export interface ExternalPlaybackButtonStateConfig {
    /** The currently active external player session, if any. */
    session: Signal<ExternalPlayerSession | null>;
    /** Playlist the detail view is showing. */
    playlistId: Signal<string | null | undefined>;
    /** Provider-side id of the item on screen. */
    contentId: Signal<number | null | undefined>;
    /** Defaults to `'vod'`. */
    contentType?: 'vod' | 'episode';
    /**
     * A second pair of ids this page also owns, if any.
     *
     * Multi-source can launch an external player on a copy of the same film in
     * ANOTHER playlist, and the session then carries that playlist's ids.
     * Without this the page shows Play while its own switch is streaming, and
     * the user has no way to stop it from here.
     */
    alsoOwns?: Signal<PlayerContentInfo | null>;
}

export interface ExternalPlaybackButtonStateApi {
    /**
     * The session, but only when it belongs to the item on screen. A session
     * playing a different movie must not turn this page's Play into Stop.
     */
    matchedSession: Signal<ExternalPlayerSession | null>;
    primaryLabel: Signal<string | null>;
    primaryIcon: Signal<string>;
    isLaunchPending: Signal<boolean>;
    isStopAction: Signal<boolean>;
    buttonState: Signal<ExternalPlaybackButtonState>;
}

/**
 * An error can still own a real process when bounded teardown could not
 * confirm its exit. Keep that session live until Stop succeeds; only a
 * confirmed close or an unclosable failure is terminal.
 */
export function isLiveExternalPlayerSession(
    session: ExternalPlayerSession | null | undefined
): session is ExternalPlayerSession {
    return (
        !!session &&
        session.status !== 'closed' &&
        (session.status !== 'error' || session.canClose)
    );
}

export function createExternalPlaybackButtonState(
    config: ExternalPlaybackButtonStateConfig
): ExternalPlaybackButtonStateApi {
    const contentType = config.contentType ?? 'vod';

    const matchedSession = computed(() => {
        const session = config.session();
        // A closed or errored session says nothing about what is playing now.
        if (!session?.contentInfo || !isLiveExternalPlayerSession(session)) {
            return null;
        }

        const info = session.contentInfo;
        if (info.contentType !== contentType) {
            return null;
        }

        const alsoOwns = config.alsoOwns?.();
        const owned =
            (info.playlistId === config.playlistId() &&
                info.contentXtreamId === config.contentId()) ||
            (!!alsoOwns &&
                info.playlistId === alsoOwns.playlistId &&
                info.contentXtreamId === alsoOwns.contentXtreamId);

        return owned ? session : null;
    });

    const primaryLabel = computed(() => {
        const session = matchedSession();
        if (!session) {
            return null;
        }

        const player = session.player.toUpperCase();
        switch (session.status) {
            case 'launching':
                return `Opening in ${player}...`;
            case 'opened':
            case 'playing':
            case 'error':
                return `Stop ${player}`;
            default:
                return null;
        }
    });

    const primaryIcon = computed(() => {
        switch (matchedSession()?.status) {
            case 'launching':
                return 'hourglass_top';
            case 'opened':
            case 'playing':
            case 'error':
                return 'stop_circle';
            default:
                return 'play_arrow';
        }
    });

    const isLaunchPending = computed(
        () => matchedSession()?.status === 'launching'
    );

    const isStopAction = computed(() => {
        const status = matchedSession()?.status;
        return (
            status === 'opened' || status === 'playing' || status === 'error'
        );
    });

    const buttonState = computed<ExternalPlaybackButtonState>(() => {
        if (isLaunchPending()) {
            return 'launching';
        }
        return isStopAction() ? 'stop' : 'idle';
    });

    return {
        matchedSession,
        primaryLabel,
        primaryIcon,
        isLaunchPending,
        isStopAction,
        buttonState,
    };
}
