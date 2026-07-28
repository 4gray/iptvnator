import { computed, type Signal } from '@angular/core';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';

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

export function createExternalPlaybackButtonState(
    config: ExternalPlaybackButtonStateConfig
): ExternalPlaybackButtonStateApi {
    const contentType = config.contentType ?? 'vod';

    const matchedSession = computed(() => {
        const session = config.session();
        // A closed or errored session says nothing about what is playing now.
        if (
            !session?.contentInfo ||
            session.status === 'closed' ||
            session.status === 'error'
        ) {
            return null;
        }

        const info = session.contentInfo;
        if (
            info.playlistId !== config.playlistId() ||
            info.contentType !== contentType ||
            info.contentXtreamId !== config.contentId()
        ) {
            return null;
        }

        return session;
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
        return status === 'opened' || status === 'playing';
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
