import { signal } from '@angular/core';
import type { PortalExternalPlayback } from '@iptvnator/portal/shared/util';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { ExternalPlaybackRecoveryCoordinator } from './external-playback-recovery-coordinator';

describe('ExternalPlaybackRecoveryCoordinator', () => {
    it('does not launch beside a replacement live session that appears during close', async () => {
        const previous = session({ id: 'previous', player: 'mpv' });
        const activeSession = signal<ExternalPlayerSession | null>(previous);
        let releaseClose: (() => void) | undefined;
        const closeSession = jest.fn(
            () =>
                new Promise<void>((resolve) => {
                    releaseClose = resolve;
                })
        );
        const externalPlayback: PortalExternalPlayback = {
            activeSession,
            visibleSession: activeSession,
            closeSession,
            dismissActiveSession: jest.fn(),
        };
        const coordinator = new ExternalPlaybackRecoveryCoordinator(
            externalPlayback
        );
        coordinator.syncSession('content-a');
        const ready = jest.fn();

        coordinator.request('vlc', jest.fn(), ready);
        activeSession.set(session({ id: 'replacement', player: 'mpv' }));
        releaseClose?.();
        await Promise.resolve();

        expect(ready).not.toHaveBeenCalled();
        expect(coordinator.states().vlc.status).toBe('error');
        coordinator.destroy();
    });
});

function session(
    overrides: Partial<ExternalPlayerSession> = {}
): ExternalPlayerSession {
    return {
        id: 'session',
        player: 'mpv',
        status: 'opened',
        title: 'Example',
        streamUrl: 'https://example.com/video.mkv',
        startedAt: '2026-08-08T10:00:00.000Z',
        updatedAt: '2026-08-08T10:00:01.000Z',
        canClose: true,
        ...overrides,
    };
}
