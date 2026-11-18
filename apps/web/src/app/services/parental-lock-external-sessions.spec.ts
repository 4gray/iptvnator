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
        startedAt: new Date(15_000).toISOString(),
        updatedAt: new Date(15_000).toISOString(),
        canClose: true,
        ...overrides,
    };
}

describe('ParentalLockExternalSessions', () => {
    let clock: number;
    let active: ReturnType<typeof signal<boolean>>;
    let hasLocks: jest.Mock;
    let lockRevision: ReturnType<typeof signal<number>>;
    let withholdsEverything: ReturnType<typeof signal<boolean>>;
    let activeSession: ReturnType<typeof signal<ExternalPlayerSession | null>>;
    let dismissActiveSession: jest.Mock;
    let restoreDismissedSession: jest.Mock;
    let closeExternalPlayerSession: jest.Mock;
    let router: { url: string };
    let emitSession: Listener<ExternalPlayerSession>;
    let emitPosition: Listener<PlaybackPositionData>;
    let emitEmbedded: Listener<EmbeddedMpvSession>;
    let listed: ExternalPlayerSession[];
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
        lockRevision = signal(0);
        withholdsEverything = signal(false);
        activeSession = signal<ExternalPlayerSession | null>(null);
        dismissActiveSession = jest.fn();
        restoreDismissedSession = jest.fn();
        closeExternalPlayerSession = jest.fn(
            async (id: string): Promise<ExternalPlayerSession | null> =>
                session({ id, status: 'closed', canClose: false })
        );
        router = { url: '/workspace/playlists/m3u-1/all' };
        listed = [];
        (window as { electron?: unknown }).electron = {
            closeExternalPlayerSession,
            listExternalPlayerSessions: async () => listed,
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
                {
                    provide: ParentalLockLockStore,
                    useValue: { hasLocks, revision: lockRevision },
                },
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
        service.start({
            pageStartedAt: clock,
            lockedAt: clock,
            launchSources: new Map(),
        });
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
            emitSession(session({ startedAt: new Date(clock).toISOString() }));
            relock();

            expect(closeExternalPlayerSession).not.toHaveBeenCalled();
        });

        it('closes a launch that raced the relock', () => {
            relock();
            // Started before the relock, first reported after it.
            emitSession(
                session({ startedAt: new Date(clock - 1).toISOString() })
            );

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

        describe('sessions still running from before the page loaded', () => {
            const earlier = () =>
                session({ startedAt: new Date(5_000).toISOString() });

            /** A reloaded page: a fresh service, started while locked. */
            const reloadedPage = () => {
                active.set(true);
                const page = TestBed.runInInjectionContext(
                    () => new ParentalLockExternalSessions()
                );
                page.now = () => clock;
                page.start({
                    pageStartedAt: clock,
                    lockedAt: clock,
                    launchSources: new Map(),
                });
                return page;
            };

            it('closes one the main process lists, judged as any source', async () => {
                listed = [earlier()];
                reloadedPage();
                await flush();

                expect(hasLocks).toHaveBeenCalledWith(null);
                expect(closeExternalPlayerSession).toHaveBeenCalledWith(
                    'session-1',
                    true
                );
            });

            it('closes one first reported by an update after the reload', () => {
                reloadedPage();
                emitSession(earlier());

                expect(hasLocks).toHaveBeenCalledWith(null);
                expect(closeExternalPlayerSession).toHaveBeenCalled();
            });

            it('keeps one when no source has a locked category', async () => {
                hasLocks.mockReturnValue(false);
                listed = [earlier()];
                reloadedPage();
                await flush();

                expect(closeExternalPlayerSession).not.toHaveBeenCalled();
            });
        });

        describe('sessions opened while the tracker was loading', () => {
            // It loads after the first screen; the listing reports what
            // opened before, judged by the eager half's clock readings.
            const loadedPage = (
                lockedAt: number,
                launchSources = new Map<string, string | null>([
                    ['session-1', 'm3u-1'],
                ])
            ) => {
                active.set(true);
                const page = TestBed.runInInjectionContext(
                    () => new ParentalLockExternalSessions()
                );
                page.now = () => clock;
                page.start({ pageStartedAt: 10_000, lockedAt, launchSources });
                return page;
            };
            const openedAt = (ms: number) =>
                session({ startedAt: new Date(ms).toISOString() });

            it('closes one opened unlocked when a relock came before the load', async () => {
                clock = 15_000;
                listed = [openedAt(12_000)];
                loadedPage(14_000);
                await flush();

                expect(hasLocks).toHaveBeenCalledWith('m3u-1');
                expect(closeExternalPlayerSession).toHaveBeenCalledWith(
                    'session-1',
                    true
                );
            });

            it('judges one by the route it was first reported on', async () => {
                clock = 15_000;
                router.url = '/workspace/xtreams/xtream-2/live';
                listed = [openedAt(12_000)];
                loadedPage(14_000);
                await flush();

                expect(hasLocks).toHaveBeenCalledWith('m3u-1');
                expect(hasLocks).not.toHaveBeenCalledWith('xtream-2');
            });

            it('judges one it never saw reported as any source', async () => {
                clock = 15_000;
                listed = [openedAt(12_000)];
                loadedPage(14_000, new Map());
                await flush();

                expect(hasLocks).toHaveBeenCalledWith(null);
            });

            it('keeps one opened while locked', async () => {
                clock = 15_000;
                listed = [openedAt(12_000)];
                loadedPage(10_000);
                await flush();

                expect(closeExternalPlayerSession).not.toHaveBeenCalled();
            });
        });

        it('closes a locked-time session once the lock set changed', () => {
            active.set(true);
            emitSession(session());
            active.set(false);
            service.onLockChange();
            // The parent locks another category while unlocked.
            lockRevision.set(1);
            service.onLockChange();

            relock();

            expect(closeExternalPlayerSession).toHaveBeenCalledWith(
                'session-1',
                true
            );
        });

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
