import type {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
} from '@iptvnator/shared/interfaces';
import type { TranslateService } from '@ngx-translate/core';
import type { PlayerControlsState } from '../player-controls/player-controls.model';

export function mapEmbeddedMpvControlsStatus(
    support: EmbeddedMpvSupport | null,
    session: EmbeddedMpvSession | null,
    isLive: boolean,
    translate: TranslateService
): Pick<PlayerControlsState, 'status' | 'statusMessage'> {
    if (!support) {
        return {
            status: 'loading',
            statusMessage: translate.instant(
                'EMBEDDED_MPV.PLAYER.CHECKING_SUPPORT'
            ),
        };
    }

    if (!support.supported) {
        return {
            status: 'idle',
            statusMessage:
                support.reason ||
                translate.instant('EMBEDDED_MPV.PLAYER.NOT_AVAILABLE'),
        };
    }

    if (session?.reconnect) {
        // A dropped stream the main process is reloading: a spinner with
        // the attempt count reads better than the underlying mpv error.
        return {
            status: 'loading',
            statusMessage: translate.instant(
                'EMBEDDED_MPV.PLAYER.RECONNECTING',
                {
                    attempt: session.reconnect.attempt,
                    maxAttempts: session.reconnect.maxAttempts,
                }
            ),
        };
    }

    if (!session || session.status === 'loading') {
        return {
            status: 'loading',
            statusMessage: translate.instant(
                'EMBEDDED_MPV.PLAYER.LOADING_STREAM'
            ),
        };
    }

    switch (session.status) {
        case 'playing':
        case 'paused':
        case 'idle':
            return { status: session.status, statusMessage: '' };
        case 'ended':
        case 'closed':
            if (session.status === 'ended' && isLive) {
                // A broadcast never ends on its own: surface it like an
                // error so the shared controls offer a way back.
                return {
                    status: 'error',
                    statusMessage: translate.instant(
                        'EMBEDDED_MPV.PLAYER.STREAM_ENDED'
                    ),
                };
            }
            return { status: 'ended', statusMessage: '' };
        case 'error':
            return {
                status: 'error',
                statusMessage:
                    session.error ||
                    translate.instant('EMBEDDED_MPV.PLAYER.PLAYBACK_FAILED'),
            };
    }
}
