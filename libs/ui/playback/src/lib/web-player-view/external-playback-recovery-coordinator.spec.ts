import { signal } from '@angular/core';
import type { PortalExternalPlayback } from '@iptvnator/portal/shared/util';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { ExternalPlaybackRecoveryCoordinator } from './external-playback-recovery-coordinator';

describe('ExternalPlaybackRecoveryCoordinator', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });
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
        const ready = jest.fn(() => true);

        coordinator.request('vlc', jest.fn(), ready);
        activeSession.set(session({ id: 'replacement', player: 'mpv' }));
        releaseClose?.();
        await Promise.resolve();

        expect(ready).not.toHaveBeenCalled();
        expect(coordinator.states().vlc.status).toBe('error');
        coordinator.destroy();
    });

    it('applies the confirmed old-session close before launching a replacement', async () => {
        const previous = session({ id: 'previous', player: 'mpv' });
        const activeSession = signal<ExternalPlayerSession | null>(null);
        const closeSession = jest.fn(async () => {
            activeSession.set(
                session({
                    id: 'previous',
                    player: 'mpv',
                    status: 'closed',
                    canClose: false,
                })
            );
        });
        const coordinator = new ExternalPlaybackRecoveryCoordinator({
            activeSession,
            visibleSession: activeSession,
            closeSession,
            dismissActiveSession: jest.fn(),
        });
        coordinator.syncSession('content-a');
        let trackFirst:
            | ((launch: Promise<ExternalPlayerSession | void>) => void)
            | undefined;
        coordinator.request('mpv', jest.fn(), (trackLaunch) => {
            trackFirst = trackLaunch;
            return true;
        });
        trackFirst?.(Promise.resolve(previous));
        await Promise.resolve();
        activeSession.set(previous);

        let stateAtReady: string | undefined;
        coordinator.request('vlc', jest.fn(), () => {
            stateAtReady = coordinator.states().mpv.status;
            return true;
        });
        await Promise.resolve();

        expect(stateAtReady).toBe('idle');
        coordinator.destroy();
    });

    it('closes a closable error before retrying another external target', async () => {
        const previous = session({
            id: 'uncertain-process',
            status: 'error',
            error: 'Process exit was not confirmed',
            canClose: true,
        });
        const activeSession = signal<ExternalPlayerSession | null>(previous);
        const closeSession = jest.fn(async () => {
            activeSession.set({
                ...previous,
                status: 'closed',
                canClose: false,
            });
        });
        const coordinator = new ExternalPlaybackRecoveryCoordinator({
            activeSession,
            visibleSession: activeSession,
            closeSession,
            dismissActiveSession: jest.fn(),
        });
        coordinator.syncSession('content-a');
        const ready = jest.fn(() => true);

        coordinator.request('vlc', jest.fn(), ready);
        await Promise.resolve();

        expect(closeSession).toHaveBeenCalledWith(previous);
        expect(ready).toHaveBeenCalledTimes(1);
        coordinator.destroy();
    });

    it('cancels an intent when launch ownership disappears during close', async () => {
        const previous = session({ id: 'previous', player: 'mpv' });
        const activeSession = signal<ExternalPlayerSession | null>(previous);
        let releaseClose: (() => void) | undefined;
        const coordinator = new ExternalPlaybackRecoveryCoordinator({
            activeSession,
            visibleSession: activeSession,
            closeSession: jest.fn(
                () =>
                    new Promise<void>((resolve) => {
                        releaseClose = () => {
                            activeSession.set(
                                session({
                                    ...previous,
                                    status: 'closed',
                                    canClose: false,
                                })
                            );
                            resolve();
                        };
                    })
            ),
            dismissActiveSession: jest.fn(),
        });
        coordinator.syncSession('content-a');

        coordinator.request('vlc', jest.fn(), () => false);
        releaseClose?.();
        await Promise.resolve();

        expect(coordinator.pending()).toBe(false);
        expect(coordinator.states().vlc.status).toBe('idle');
        coordinator.destroy();
    });

    it('correlates only the exact promise bound to the current attempt', async () => {
        const activeSession = signal<ExternalPlayerSession | null>(null);
        const coordinator = new ExternalPlaybackRecoveryCoordinator({
            activeSession,
            visibleSession: activeSession,
            closeSession: jest.fn(),
            dismissActiveSession: jest.fn(),
        });
        coordinator.syncSession('content-a');
        let firstTracker:
            | ((launch: Promise<ExternalPlayerSession | void>) => void)
            | undefined;
        coordinator.request('mpv', jest.fn(), (trackLaunch) => {
            firstTracker = trackLaunch;
            return true;
        });
        jest.advanceTimersByTime(10_000);
        let retryTracker:
            | ((launch: Promise<ExternalPlayerSession | void>) => void)
            | undefined;
        coordinator.request('mpv', jest.fn(), (trackLaunch) => {
            retryTracker = trackLaunch;
            return true;
        });

        firstTracker?.(
            Promise.resolve(session({ id: 'late-first', player: 'mpv' }))
        );
        retryTracker?.(
            Promise.resolve(session({ id: 'exact-retry', player: 'mpv' }))
        );
        await Promise.resolve();

        expect(coordinator.states().mpv.sessionId).toBe('exact-retry');
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
