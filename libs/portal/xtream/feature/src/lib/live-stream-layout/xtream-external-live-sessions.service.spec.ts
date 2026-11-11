import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { XtreamExternalLiveSessions } from './xtream-external-live-sessions.service';

const oldUrl = 'https://example.test/old.ts';
const newUrl = 'https://example.test/new.ts';
const original = { playlistId: 'synthetic-playlist', categoryId: 1 };
const replacement = { ...original, categoryId: 2 };

function session(
    id: string,
    streamUrl: string,
    status: ExternalPlayerSession['status']
): ExternalPlayerSession {
    return {
        id,
        streamUrl,
        status,
        player: 'mpv',
        title: 'Synthetic Channel',
        startedAt: '2026-04-04T10:00:00Z',
        updatedAt: '2026-04-04T10:00:00Z',
        canClose: status === 'opened' || status === 'error',
    };
}

describe('XtreamExternalLiveSessions', () => {
    let guard: XtreamExternalLiveSessions;
    let receive: (value: ExternalPlayerSession) => void;
    let previousElectron: Window['electron'];
    const locked = signal(false);
    const version = signal(0);
    const activeSession = signal<ExternalPlayerSession | null>(null);
    const dismissActiveSession = jest.fn();
    const restoreDismissedSession = jest.fn();
    const restoreDisplacedSession = jest.fn();
    const closeSession = jest.fn(
        async (_session: ExternalPlayerSession) => undefined
    );

    function relock() {
        locked.set(true);
        version.update((value) => value + 1);
        TestBed.flushEffects();
    }

    beforeEach(() => {
        previousElectron = window.electron;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                onExternalPlayerSessionUpdate: (callback: typeof receive) => {
                    receive = callback;
                    return () => undefined;
                },
            },
        });
        closeSession.mockClear();
        dismissActiveSession.mockClear();
        restoreDismissedSession.mockClear();
        restoreDisplacedSession.mockClear();
        activeSession.set(null);
        locked.set(false);
        version.set(0);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        closeSession,
                        activeSession,
                        dismissActiveSession,
                        restoreDismissedSession,
                        restoreDisplacedSession,
                    },
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        version,
                        active: locked,
                        isXtreamCategoryLocked: (
                            _playlist: string,
                            _type: string,
                            category: number
                        ) => locked() && category === 1,
                    },
                },
            ],
        });
        guard = TestBed.inject(XtreamExternalLiveSessions);
    });

    afterEach(() =>
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: previousElectron,
        })
    );

    it.each(['event', 'result'] as const)(
        'closes a superseded launch that becomes closable after relock (%s)',
        (delivery) => {
            const old = guard.begin(original);
            receive({
                ...session('old', oldUrl, 'launching'),
                launchId: old.launchId,
            });
            const next = guard.begin(replacement);
            const newer = {
                ...session('new', newUrl, 'opened'),
                launchId: next.launchId,
            };
            receive(newer);
            next.finish(newer);
            relock();
            expect(closeSession).not.toHaveBeenCalled();

            const older = {
                ...session('old', oldUrl, 'opened'),
                launchId: old.launchId,
            };
            if (delivery === 'event') receive(older);
            old.finish(older);
            expect(closeSession).toHaveBeenCalledTimes(1);
            expect(closeSession).toHaveBeenCalledWith(older);
        }
    );

    it('keeps superseded sessions only until their terminal event', () => {
        const old = session('old', oldUrl, 'opened');
        guard.begin(original).finish(old);
        guard.begin(replacement).finish(session('new', newUrl, 'opened'));
        relock();
        expect(closeSession).toHaveBeenCalledWith(old);

        receive(session('old', oldUrl, 'closed'));
        closeSession.mockClear();
        version.update((value) => value + 1);
        TestBed.flushEffects();
        expect(closeSession).not.toHaveBeenCalled();
    });

    it('does not restore the old category when a launch response arrives after a copy switch', () => {
        const { finish, launchId } = guard.begin(original);
        const opened = { ...session('old', oldUrl, 'opened'), launchId };
        receive(opened);
        guard.update(opened, replacement);
        finish(opened);
        relock();
        expect(guard.state('old')?.source).toBe(replacement);
        expect(closeSession).not.toHaveBeenCalled();
    });

    it('closes an older native session by ID without dismissing the current dock', async () => {
        const nativeClose = jest.fn(async (id: string) =>
            session(id, oldUrl, 'closed')
        );
        Object.defineProperty(window.electron, 'closeExternalPlayerSession', {
            value: nativeClose,
        });
        guard.begin(original).finish(session('old', oldUrl, 'opened'));
        relock();
        expect(nativeClose).toHaveBeenCalledWith('old', true);
        expect(closeSession).not.toHaveBeenCalled();
        await Promise.resolve();
        version.update((value) => value + 1);
        TestBed.flushEffects();
        expect(nativeClose).toHaveBeenCalledTimes(1);
    });

    it('retries the exact session after native teardown cannot be confirmed', async () => {
        jest.useFakeTimers();
        try {
            const nativeClose = jest
                .fn(async (id: string) => session(id, oldUrl, 'closed'))
                .mockRejectedValueOnce(new Error('Synthetic teardown failure'));
            Object.defineProperty(
                window.electron,
                'closeExternalPlayerSession',
                { value: nativeClose }
            );
            guard.begin(original).finish(session('old', oldUrl, 'opened'));
            relock();
            expect(nativeClose).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1000);
            expect(nativeClose.mock.calls).toEqual([
                ['old', true],
                ['old', true],
            ]);
            await jest.advanceTimersByTimeAsync(2000);
            expect(nativeClose).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('hides a relocked session again when restored during its pending close', () => {
        const nativeClose = jest.fn(() => new Promise(() => undefined));
        Object.defineProperty(window.electron, 'closeExternalPlayerSession', {
            value: nativeClose,
        });
        const opened = session('old', oldUrl, 'opened');
        activeSession.set(opened);
        guard.begin(original).finish(opened);
        relock();
        expect(dismissActiveSession).toHaveBeenCalledTimes(1);

        const queued = session('new', newUrl, 'launching');
        activeSession.set(queued);
        guard.begin(replacement).finish(queued);
        const restored = { ...opened, restoredFromSessionId: queued.id };
        activeSession.set(restored);
        receive(restored);

        expect(dismissActiveSession).toHaveBeenCalledTimes(2);
        expect(nativeClose.mock.calls).toEqual([[opened.id, true]]);
    });

    it('restores the exact surviving player after closing a cancelled switch', async () => {
        const close = jest.fn(async (id: string) =>
            session(id, newUrl, 'closed')
        );
        Object.defineProperty(window.electron, 'closeExternalPlayerSession', {
            value: close,
        });
        const playing = session('synthetic-survivor', oldUrl, 'opened');
        const cancelled = {
            ...session('synthetic-cancelled', newUrl, 'launching'),
            canClose: true,
        };
        guard
            .begin({ ...original, channel: { xtream_id: 101 } })
            .finish(playing);
        guard
            .begin({ ...replacement, channel: { xtream_id: 102 } })
            .finish(cancelled);
        activeSession.set(cancelled);
        expect(
            guard.cancelPendingSwitches(original.playlistId, 101, playing.id)
        ).toBe(true);
        await Promise.resolve();
        expect(close).toHaveBeenCalledWith(cancelled.id, true);
        expect(restoreDisplacedSession).toHaveBeenCalledWith(
            playing,
            cancelled.id
        );
    });

    it.each([
        'closed',
        'error',
        'closable error',
        'newer launch',
        'already playing',
    ] as const)(
        'only restores a survivor after a terminal replacement that still owns the dock (%s)',
        (outcome) => {
            const playing = session('synthetic-survivor', oldUrl, 'opened');
            const replacing = session(
                'synthetic-switch',
                newUrl,
                outcome === 'already playing' ? 'opened' : 'launching'
            );
            guard
                .begin({ ...original, channel: { xtream_id: 101 } })
                .finish(playing);
            guard
                .begin({ ...replacement, channel: { xtream_id: 102 } })
                .finish(replacing);
            activeSession.set(
                outcome === 'newer launch'
                    ? session('synthetic-newer', newUrl, 'launching')
                    : replacing
            );
            receive({
                ...replacing,
                status:
                    outcome === 'error' || outcome === 'closable error'
                        ? 'error'
                        : 'closed',
                canClose: outcome === 'closable error',
            });
            if (
                outcome === 'closed' ||
                outcome === 'error' ||
                outcome === 'already playing'
            )
                expect(restoreDisplacedSession).toHaveBeenCalledWith(
                    playing,
                    replacing.id
                );
            else expect(restoreDisplacedSession).not.toHaveBeenCalled();
        }
    );

    it('restores Stop after unlocking an active session whose parental close failed', async () => {
        jest.useFakeTimers();
        try {
            const nativeClose = jest
                .fn()
                .mockRejectedValue(new Error('Synthetic teardown failure'));
            Object.defineProperty(
                window.electron,
                'closeExternalPlayerSession',
                { value: nativeClose }
            );
            const opened = session('old', oldUrl, 'opened');
            activeSession.set(opened);
            guard.begin(original).finish(opened);
            relock();
            expect(dismissActiveSession).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(0);
            expect(restoreDismissedSession).not.toHaveBeenCalled();

            locked.set(false);
            version.update((value) => value + 1);
            TestBed.flushEffects();
            expect(restoreDismissedSession).toHaveBeenCalledWith(opened.id);
            await jest.advanceTimersByTimeAsync(1_000);
            expect(nativeClose).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('does not retire a pending launch when a foreign session at the same URL stops', () => {
        const pending = guard.begin(original);
        receive({
            ...session('synthetic-foreign', oldUrl, 'opened'),
            playbackIdle: true,
        });
        receive(session('synthetic-foreign', oldUrl, 'closed'));
        expect(pending.ended()).toBe(false);
        const opened = {
            ...session('synthetic-owned', oldUrl, 'opened'),
            launchId: pending.launchId,
        };
        pending.finish(opened);
        relock();
        expect(closeSession).toHaveBeenCalledWith(opened);
    });

    it('closes the failed idle replacement before restoring the surviving Stop control', async () => {
        const nativeClose = jest.fn(async (id: string) =>
            session(id, newUrl, 'closed')
        );
        Object.defineProperty(window.electron, 'closeExternalPlayerSession', {
            value: nativeClose,
        });
        const playing = session('synthetic-survivor', oldUrl, 'opened');
        const idle = {
            ...session('synthetic-idle', newUrl, 'opened'),
            mediaLoaded: false,
            playbackIdle: true,
        };
        guard
            .begin({ ...original, channel: { xtream_id: 101 } })
            .finish(playing);
        activeSession.set(idle);
        guard
            .begin({ ...replacement, channel: { xtream_id: 102 } })
            .finish(idle);
        expect(nativeClose).toHaveBeenCalledWith(idle.id, true);
        expect(restoreDisplacedSession).not.toHaveBeenCalled();
        expect(dismissActiveSession).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(restoreDisplacedSession).toHaveBeenCalledWith(playing, idle.id);
    });
});
