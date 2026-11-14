import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
    ParentalLockLockStore,
    ParentalLockService,
    ParentalLockSessionOwners,
} from '@iptvnator/services';
import type {
    EmbeddedMpvSession,
    ExternalPlayerSession,
    PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import { ExternalPlaybackService } from './external-playback.service';
import {
    EXTERNAL_PROGRESS_WINDOW_MS,
    ParentalLockExternalSessions,
} from './parental-lock-external-sessions';

type Listener<T> = (value: T) => void;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function session(
    overrides: Partial<ExternalPlayerSession> = {}
): ExternalPlayerSession {
    return {
        id: 'session-1',
        player: 'mpv',
        status: 'playing',
        title: 'Synthetic Film',
        streamUrl: 'http://stream.example/film.mkv',
        startedAt: new Date(1_000).toISOString(),
        updatedAt: new Date(1_000).toISOString(),
        canClose: true,
        ...overrides,
    };
}

describe('ParentalLockExternalSessions', () => {
    let clock: number;
    let active: ReturnType<typeof signal<boolean>>;
    let hasLocks: jest.Mock;
    let withholdsEverything: ReturnType<typeof signal<boolean>>;
    let activeSession: ReturnType<typeof signal<ExternalPlayerSession | null>>;
    let dismissActiveSession: jest.Mock;
    let restoreDismissedSession: jest.Mock;
    let closeExternalPlayerSession: jest.Mock;
    let router: { url: string };
    let emitSession: Listener<ExternalPlayerSession>;
    let emitPosition: Listener<PlaybackPositionData>;
    let emitEmbedded: Listener<EmbeddedMpvSession>;
    let service: ParentalLockExternalSessions;

    /** Lock now: the enforcement calls `onLockChange` on the new version. */
    const relock = () => {
        active.set(true);
        service.onLockChange();
    };

    beforeEach(() => {
        clock = 10_000;
        active = signal(false);
        hasLocks = jest.fn(() => true);
        withholdsEverything = signal(false);
        activeSession = signal<ExternalPlayerSession | null>(null);
        dismissActiveSession = jest.fn();
        restoreDismissedSession = jest.fn();
        closeExternalPlayerSession = jest.fn(
            async (id: string): Promise<ExternalPlayerSession | null> =>
                session({ id, status: 'closed', canClose: false })
        );
        router = { url: '/workspace/playlists/m3u-1/all' };
        (window as { electron?: unknown }).electron = {
            closeExternalPlayerSession,
            onExternalPlayerSessionUpdate: (
                callback: Listener<ExternalPlayerSession>
            ) => (emitSession = callback),
            onPlaybackPositionUpdate: (
                callback: Listener<PlaybackPositionData>
            ) => (emitPosition = callback),
            onEmbeddedMpvSessionUpdate: (
                callback: Listener<EmbeddedMpvSession>
            ) => (emitEmbedded = callback),
        };
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ParentalLockService,
                    useValue: { active, withholdsEverything },
                },
                { provide: ParentalLockLockStore, useValue: { hasLocks } },
                {
                    provide: ExternalPlaybackService,
                    useValue: {
                        activeSession,
                        dismissActiveSession,
                        restoreDismissedSession,
                    },
                },
                { provide: Router, useValue: router },
            ],
        });
        service = TestBed.inject(ParentalLockExternalSessions);
        service.now = () => clock;
        service.start();
    });

    afterEach(() => {
        delete (window as { electron?: unknown }).electron;
        TestBed.resetTestingModule();
    });

    describe('relock', () => {
        it('closes a session started while unlocked and hides it from the dock', async () => {
            const started = session();
            emitSession(started);
            activeSession.set(started);

            relock();
            await flush();

            expect(hasLocks).toHaveBeenCalledWith('m3u-1');
            expect(dismissActiveSession).toHaveBeenCalled();
            expect(closeExternalPlayerSession).toHaveBeenCalledWith(
                'session-1',
                true
            );
        });

        it('judges a session by its own source over the route', () => {
            router.url = '/workspace/dashboard';
            emitSession(
                session({
                    contentInfo: {
                        playlistId: 'xtream-1',
                        contentXtreamId: 7,
                        contentType: 'vod',
                    },
                })
            );

            relock();

            expect(hasLocks).toHaveBeenCalledWith('xtream-1');
        });

        it('treats a launch from outside a source route as any source', () => {
            router.url = '/workspace/favorites';
            emitSession(session());

            relock();

            expect(hasLocks).toHaveBeenCalledWith(null);
            expect(closeExternalPlayerSession).toHaveBeenCalled();
        });

        it('keeps a session whose source has no locked category', () => {
            hasLocks.mockReturnValue(false);
            emitSession(session());

            relock();

            expect(closeExternalPlayerSession).not.toHaveBeenCalled();
            expect(dismissActiveSession).not.toHaveBeenCalled();
        });

        it('closes any such session while the lock store is unreadable', () => {
            hasLocks.mockReturnValue(false);
            withholdsEverything.set(true);
            emitSession(session());

            relock();

            expect(closeExternalPlayerSession).toHaveBeenCalled();
        });

        it('keeps a session launched while locked (from the filtered catalog)', () => {
            relock();
            clock += 1_000;
            emitSession(
                session({ startedAt: new Date(clock).toISOString() })
            );
            relock();

            expect(closeExternalPlayerSession).not.toHaveBeenCalled();
        });

        it('closes a launch that raced the relock', () => {
            relock();
            // Started before the relock, first reported after it.
            emitSession(session({ startedAt: new Date(clock - 1).toISOString() }));

            expect(closeExternalPlayerSession).toHaveBeenCalledWith(
                'session-1',
                true
            );
        });

        it('closes a locked-time session switched in place while unlocked', () => {
            relock();
            clock += 1_000;
            const startedAt = new Date(clock).toISOString();
            emitSession(session({ startedAt }));
            active.set(false);
            emitSession(
                session({
                    startedAt,
                    streamUrl: 'http://stream.example/other.mkv',
                })
            );

            relock();

            expect(closeExternalPlayerSession).toHaveBeenCalledTimes(1);
        });

        it('keeps a locked-time session that only reports status while unlocked', () => {
            relock();
            clock += 1_000;
            const startedAt = new Date(clock).toISOString();
            emitSession(session({ startedAt, status: 'opened' }));
            active.set(false);
            emitSession(session({ startedAt, status: 'playing' }));

            relock();

            expect(closeExternalPlayerSession).not.toHaveBeenCalled();
        });

        it('leaves a session its owner enforces', () => {
            TestBed.inject(ParentalLockSessionOwners).claim(
                (candidate) => candidate.id === 'session-1'
            );
            emitSession(session());

            relock();

            expect(closeExternalPlayerSession).not.toHaveBeenCalled();
        });

        it('retries a close that failed', async () => {
            jest.useFakeTimers();
            try {
                closeExternalPlayerSession.mockRejectedValueOnce(
                    new Error('synthetic close failure')
                );
                emitSession(session());

                relock();
                await Promise.resolve();
                await Promise.resolve();
                expect(closeExternalPlayerSession).toHaveBeenCalledTimes(1);

                jest.advanceTimersByTime(1_000);
                expect(closeExternalPlayerSession).toHaveBeenCalledTimes(2);
            } finally {
                jest.useRealTimers();
            }
        });

        it('closes a launch again once it can be closed', async () => {
            const launching = session({ status: 'launching' });
            closeExternalPlayerSession.mockResolvedValueOnce(launching);
            emitSession(launching);

            relock();
            await flush();
            expect(closeExternalPlayerSession).toHaveBeenCalledTimes(1);

            emitSession(session());
            await flush();
            expect(closeExternalPlayerSession).toHaveBeenCalledTimes(2);
        });

        it('only hides a session that cannot be closed', () => {
            const stuck = session({ canClose: false });
            emitSession(stuck);
            activeSession.set(stuck);

            relock();

            expect(dismissActiveSession).toHaveBeenCalled();
            expect(closeExternalPlayerSession).not.toHaveBeenCalled();
        });

        it('never closes while unlocked', () => {
            emitSession(session());

            expect(closeExternalPlayerSession).not.toHaveBeenCalled();
        });

        it('shows a hidden session again when unlocked before it could be closed', () => {
            const stuck = session({ canClose: false });
            emitSession(stuck);
            activeSession.set(stuck);
            relock();
            expect(restoreDismissedSession).not.toHaveBeenCalled();

            active.set(false);
            service.onLockChange();

            expect(restoreDismissedSession).toHaveBeenCalledWith('session-1');
        });

        it.each(['returns the session open', 'fails'] as const)(
            'shows a hidden session again when unlocked while its close %s',
            async (outcome) => {
                const started = session();
                let settle: () => void = () => undefined;
                closeExternalPlayerSession.mockImplementationOnce(
                    () =>
                        new Promise((resolve, reject) => {
                            settle = () =>
                                outcome === 'fails'
                                    ? reject(new Error('synthetic failure'))
                                    : resolve(started);
                        })
                );
                emitSession(started);
                activeSession.set(started);
                relock();

                active.set(false);
                service.onLockChange();
                expect(restoreDismissedSession).not.toHaveBeenCalled();

                settle();
                await flush();
                expect(restoreDismissedSession).toHaveBeenCalledWith(
                    'session-1'
                );
            }
        );

        it('forgets a closed session', () => {
            emitSession(session());
            emitSession(session({ status: 'closed', canClose: false }));

            relock();

            expect(closeExternalPlayerSession).not.toHaveBeenCalled();
        });
    });

    describe('busy probe for the idle relock', () => {
        const film = () =>
            session({
                contentInfo: {
                    playlistId: 'xtream-1',
                    contentXtreamId: 7,
                    contentType: 'vod',
                },
            });
        const position = (positionSeconds: number): PlaybackPositionData => ({
            sessionId: 'session-1',
            playlistId: 'xtream-1',
            contentXtreamId: 7,
            contentType: 'vod',
            positionSeconds,
        });

        it('counts an MPV/VLC film while its position moves', () => {
            emitSession(film());
            expect(service.isBusy()).toBe(false);

            emitPosition(position(100));
            expect(service.isBusy()).toBe(true);

            clock += 5_000;
            emitPosition(position(105));
            clock += EXTERNAL_PROGRESS_WINDOW_MS;
            expect(service.isBusy()).toBe(true);
        });

        it('stops counting a paused film', () => {
            emitSession(film());
            emitPosition(position(100));
            clock += 5_000;
            emitPosition(position(100));
            clock += EXTERNAL_PROGRESS_WINDOW_MS - 4_000;

            expect(service.isBusy()).toBe(false);
        });

        it('stops counting a film whose player closed', () => {
            emitSession(film());
            emitPosition(position(100));
            emitSession({ ...film(), status: 'closed', canClose: false });

            expect(service.isBusy()).toBe(false);
        });

        it('does not count live MPV/VLC, which cannot report a pause', () => {
            emitSession(session());
            emitPosition(position(100));

            expect(service.isBusy()).toBe(false);
        });

        it('counts Embedded MPV while any session plays', () => {
            const embedded = (
                id: string,
                status: EmbeddedMpvSession['status']
            ) => ({ id, status }) as EmbeddedMpvSession;

            emitEmbedded(embedded('a', 'playing'));
            emitEmbedded(embedded('b', 'playing'));
            emitEmbedded(embedded('a', 'paused'));
            expect(service.isBusy()).toBe(true);

            emitEmbedded(embedded('b', 'closed'));
            expect(service.isBusy()).toBe(false);
        });
    });
});
