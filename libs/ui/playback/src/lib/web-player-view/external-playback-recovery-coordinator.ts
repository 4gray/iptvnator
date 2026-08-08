import type { PortalExternalPlayback } from '@iptvnator/portal/shared/util';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import {
    type ExternalRecoveryIntent,
    ExternalPlaybackRecovery,
} from './external-playback-recovery';

export type ExternalRecoveryTarget = 'mpv' | 'vlc';
export type ExternalPlaybackLaunchTracker = (
    launch: Promise<ExternalPlayerSession | void>
) => void;

/**
 * Serializes managed external-player recovery without retaining playback data.
 * The callbacks are owned by the player view and run only for the current
 * credential-free intent.
 */
export class ExternalPlaybackRecoveryCoordinator {
    private readonly recovery = new ExternalPlaybackRecovery();

    readonly states = this.recovery.states;
    readonly pending = this.recovery.pending;

    constructor(
        private readonly externalPlayback: PortalExternalPlayback | null
    ) {}

    observe(session: ExternalPlayerSession | null): void {
        this.recovery.observe(session);
    }

    syncSession(sessionKey: string): void {
        this.recovery.syncSession(sessionKey);
    }

    request(
        target: ExternalRecoveryTarget,
        onBegin: () => void,
        onReady: (trackLaunch: ExternalPlaybackLaunchTracker) => boolean
    ): void {
        const activeSession = this.externalPlayback?.activeSession() ?? null;
        const intent = this.recovery.begin(target);
        if (!intent) {
            return;
        }

        onBegin();
        if (!isLiveExternalSession(activeSession)) {
            this.runReady(intent, onReady);
            return;
        }
        if (!activeSession.canClose || !this.externalPlayback) {
            this.recovery.fail(intent);
            return;
        }

        void this.closeThenRun(activeSession, intent, onReady);
    }

    destroy(): void {
        this.recovery.destroy();
    }

    private async closeThenRun(
        session: ExternalPlayerSession,
        intent: ExternalRecoveryIntent,
        onReady: (trackLaunch: ExternalPlaybackLaunchTracker) => boolean
    ): Promise<void> {
        try {
            await this.externalPlayback?.closeSession(session);
        } catch {
            this.recovery.fail(intent);
            return;
        }
        this.recovery.close(session.player, session.id);
        const current = this.externalPlayback?.activeSession() ?? null;
        if (isLiveExternalSession(current)) {
            this.recovery.fail(intent);
            return;
        }
        this.runReady(intent, onReady);
    }

    private runReady(
        intent: ExternalRecoveryIntent,
        onReady: (trackLaunch: ExternalPlaybackLaunchTracker) => boolean
    ): void {
        if (!this.recovery.owns(intent)) {
            return;
        }

        const accepted = onReady((launch) => {
            void launch.then(
                (session) => {
                    if (session) {
                        this.recovery.confirm(intent, session);
                    } else {
                        this.recovery.fail(intent);
                    }
                },
                () => this.recovery.fail(intent)
            );
        });
        if (!accepted) {
            this.recovery.cancel(intent);
        }
    }
}

function isLiveExternalSession(
    session: ExternalPlayerSession | null
): session is ExternalPlayerSession {
    return (
        session?.status === 'launching' ||
        session?.status === 'opened' ||
        session?.status === 'playing'
    );
}
