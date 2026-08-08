import type { PortalExternalPlayback } from '@iptvnator/portal/shared/util';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import {
    type ExternalRecoveryIntent,
    ExternalPlaybackRecovery,
} from './external-playback-recovery';

export type ExternalRecoveryTarget = 'mpv' | 'vlc';

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
        onReady: () => void
    ): void {
        const activeSession = this.externalPlayback?.activeSession() ?? null;
        const intent = this.recovery.begin(target, activeSession?.id ?? null);
        if (!intent) {
            return;
        }

        onBegin();
        if (!isLiveExternalSession(activeSession)) {
            onReady();
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
        onReady: () => void
    ): Promise<void> {
        try {
            await this.externalPlayback?.closeSession(session);
        } catch {
            this.recovery.fail(intent);
            return;
        }
        const current = this.externalPlayback?.activeSession() ?? null;
        if (isLiveExternalSession(current)) {
            this.recovery.fail(intent);
            return;
        }
        if (this.recovery.owns(intent)) {
            onReady();
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
