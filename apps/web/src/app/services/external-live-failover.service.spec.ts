import { signal, type ProviderToken } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import type {
    ElectronBridgePlayerError,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { ExternalLiveFailoverService } from './external-live-failover.service';
import { ExternalPlaybackService } from './external-playback.service';
import { PlayerService } from './player.service';

describe('ExternalLiveFailoverService', () => {
    let failover: {
        isHopTarget: jest.Mock;
        reportLoading: jest.Mock;
        reportRetrying: jest.Mock;
        reportPlaying: jest.Mock;
        reportFailed: jest.Mock;
    };
    let enabled: ReturnType<typeof signal<boolean>>;
    let activeSession: ReturnType<typeof signal<ExternalPlayerSession | null>>;
    let lastExternalPlayback: ReturnType<
        typeof signal<ResolvedPortalPlayback | null>
    >;
    let openExternalPlayback: jest.Mock;
    let playerError: (data: ElectronBridgePlayerError) => void;
    /**
     * Resolved dynamically: a static import of this lazy-loaded library is
     * forbidden from `apps/web`.
     */
    let failoverToken: ProviderToken<unknown>;

    const playback: ResolvedPortalPlayback = {
        streamUrl: 'http://a/1.ts',
        title: 'ERT 1',
        isLive: true,
        headers: { 'User-Agent': 'ua' },
    };

    function session(
        id: string,
        status: ExternalPlayerSession['status'],
        extra: Partial<ExternalPlayerSession> = {}
    ): ExternalPlayerSession {
        return {
            id,
            player: 'mpv',
            status,
            title: 'ERT 1',
            streamUrl: playback.streamUrl,
            startedAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            canClose: true,
            ...extra,
        };
    }

    /** The failover graph is imported on demand; let that settle. */
    async function settle(): Promise<void> {
        for (let tick = 0; tick < 25; tick++) {
            await Promise.resolve();
        }
    }

    function launch(id: string): void {
        const value = session(id, 'launching');
        // PlayerService records the playback before its IPC call.
        lastExternalPlayback.set(playback);
        activeSession.set(value);
        TestBed.tick();
    }

    function update(next: ExternalPlayerSession): void {
        activeSession.set(next);
        TestBed.tick();
    }

    beforeAll(async () => {
        const module = await import('@iptvnator/playback/data-access');
        failoverToken = module.LiveChannelFailoverService;
    });

    beforeEach(() => {
        jest.useFakeTimers();
        failover = {
            isHopTarget: jest.fn(() => false),
            reportLoading: jest.fn(),
            reportRetrying: jest.fn(),
            reportPlaying: jest.fn(),
            reportFailed: jest.fn(),
        };
        enabled = signal(true);
        activeSession = signal<ExternalPlayerSession | null>(null);
        lastExternalPlayback = signal(null);
        openExternalPlayback = jest.fn().mockResolvedValue(undefined);
        (
            window as unknown as {
                electron: { onPlayerError: unknown };
            }
        ).electron = {
            onPlayerError: (
                callback: (data: ElectronBridgePlayerError) => void
            ) => {
                playerError = callback;
            },
        };
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: failoverToken,
                    useValue: failover,
                },
                {
                    provide: SettingsStore,
                    useValue: { liveChannelFailover: enabled },
                },
                {
                    provide: ExternalPlaybackService,
                    useValue: {
                        activeSession: activeSession.asReadonly(),
                    },
                },
                {
                    provide: PlayerService,
                    useValue: {
                        lastExternalPlayback: lastExternalPlayback.asReadonly(),
                        openExternalPlayback,
                    },
                },
            ],
        });
        TestBed.runInInjectionContext(() => new ExternalLiveFailoverService());
        TestBed.tick();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('retries a failing external stream three times before failing over', async () => {
        launch('launch-1');

        for (let attempt = 1; attempt <= 3; attempt++) {
            update(
                session(`launch-${attempt}`, 'error', {
                    errorCode: 'stream-open-failed',
                })
            );
            await settle();
            expect(openExternalPlayback).toHaveBeenCalledTimes(attempt);
            expect(openExternalPlayback).toHaveBeenCalledWith(playback, 'mpv');
            expect(failover.reportRetrying).toHaveBeenLastCalledWith(attempt);

            // The retry's own session replaces the one that failed.
            launch(`launch-${attempt + 1}`);
        }
        expect(failover.reportFailed).not.toHaveBeenCalled();

        update(
            session('launch-4', 'error', {
                errorCode: 'stream-open-failed',
            })
        );
        await settle();

        expect(openExternalPlayback).toHaveBeenCalledTimes(3);
        expect(failover.reportFailed).toHaveBeenCalledWith('ERT 1');
    });

    it('keeps the retry budget when its own relaunch reports again', async () => {
        launch('launch-1');
        update(
            session('launch-1', 'error', { errorCode: 'connection-failed' })
        );
        await settle();

        // PlayerService replaced the tracked launch with the retry.
        launch('launch-2');
        update(
            session('launch-2', 'error', { errorCode: 'connection-failed' })
        );
        await settle();

        expect(failover.reportRetrying).toHaveBeenLastCalledWith(2);
    });

    it('restores the budget once the external player plays the stream', async () => {
        launch('launch-1');
        update(
            session('launch-1', 'error', { errorCode: 'connection-failed' })
        );
        await settle();
        update(session('launch-1', 'playing'));

        expect(failover.reportPlaying).toHaveBeenCalledWith('ERT 1');
        jest.advanceTimersByTime(60_000);
        expect(openExternalPlayback).toHaveBeenCalledTimes(1);

        update(session('launch-1', 'error', { errorCode: 'timed-out' }));
        await settle();
        expect(failover.reportRetrying).toHaveBeenLastCalledWith(1);
    });

    it('fails over on a player-error report for the active session', async () => {
        launch('launch-1');
        update(session('launch-1', 'opened'));

        playerError({ player: 'MPV', code: 'stream-not-found', error: 'x' });
        await settle();

        expect(openExternalPlayback).toHaveBeenCalledWith(playback, 'mpv');
    });

    it('ignores close races and other players', async () => {
        launch('launch-1');
        update(session('launch-1', 'error', { errorCode: 'previous-closing' }));
        playerError({ player: 'VLC', code: 'stream-not-found', error: 'x' });
        await settle();

        expect(openExternalPlayback).not.toHaveBeenCalled();
        expect(failover.reportFailed).not.toHaveBeenCalled();
    });

    it('gives a failover candidate a single attempt', async () => {
        failover.isHopTarget.mockReturnValue(true);
        launch('launch-1');

        update(
            session('launch-1', 'error', { errorCode: 'connection-failed' })
        );
        await settle();

        expect(openExternalPlayback).not.toHaveBeenCalled();
        expect(failover.reportFailed).toHaveBeenCalledWith('ERT 1');
    });

    it('does not reopen a player the user closed while failover loads', async () => {
        launch('launch-1');
        update(
            session('launch-1', 'error', { errorCode: 'connection-failed' })
        );
        // The user closes the player before the lazy failover import settles.
        update(session('launch-1', 'closed'));
        await settle();

        expect(openExternalPlayback).not.toHaveBeenCalled();
    });

    it('does not reset the retry budget when the player only opens', async () => {
        launch('launch-1');
        update(
            session('launch-1', 'error', { errorCode: 'connection-failed' })
        );
        await settle();

        launch('launch-2');
        update(session('launch-2', 'opened'));
        update(
            session('launch-2', 'error', { errorCode: 'stream-open-failed' })
        );
        await settle();

        expect(failover.reportRetrying).toHaveBeenLastCalledWith(2);
    });

    it('stays out of movie and episode launches', async () => {
        lastExternalPlayback.set({ ...playback, isLive: false });
        activeSession.set(session('launch-1', 'launching'));
        TestBed.tick();

        update(
            session('launch-1', 'error', { errorCode: 'stream-open-failed' })
        );
        await settle();

        expect(openExternalPlayback).not.toHaveBeenCalled();
        expect(failover.reportFailed).not.toHaveBeenCalled();
    });

    it('stays out of launches it did not make, and of a disabled setting', async () => {
        update(
            session('external', 'error', {
                errorCode: 'connection-failed',
            })
        );
        await settle();
        expect(openExternalPlayback).not.toHaveBeenCalled();

        enabled.set(false);
        launch('launch-1');
        update(
            session('launch-1', 'error', { errorCode: 'connection-failed' })
        );
        await settle();

        expect(openExternalPlayback).not.toHaveBeenCalled();
        expect(failover.reportFailed).not.toHaveBeenCalled();
    });
});
