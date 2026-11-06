import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveChannelFailoverService } from '@iptvnator/playback/data-access';
import type {
    EmbeddedMpvSession,
    EmbeddedMpvSessionStatus,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { EmbeddedMpvLiveFailover } from './embedded-mpv-live-failover';

describe('EmbeddedMpvLiveFailover', () => {
    let failover: {
        enabled: ReturnType<typeof signal<boolean>>;
        isHopTarget: jest.Mock;
        reportLoading: jest.Mock;
        reportRetrying: jest.Mock;
        reportPlaying: jest.Mock;
        reportFailed: jest.Mock;
    };
    let session: ReturnType<typeof signal<EmbeddedMpvSession | null>>;
    let playback: ReturnType<typeof signal<ResolvedPortalPlayback>>;
    let isLive: ReturnType<typeof signal<boolean>>;
    let retry: jest.Mock;
    let watcher: EmbeddedMpvLiveFailover;

    function setStatus(
        status: EmbeddedMpvSessionStatus,
        extra: Partial<EmbeddedMpvSession> = {}
    ): void {
        session.set({ id: 's', status, ...extra } as EmbeddedMpvSession);
        TestBed.tick();
    }

    beforeEach(() => {
        jest.useFakeTimers();
        failover = {
            enabled: signal(true),
            isHopTarget: jest.fn(() => false),
            reportLoading: jest.fn(),
            reportRetrying: jest.fn(),
            reportPlaying: jest.fn(),
            reportFailed: jest.fn(),
        };
        session = signal(null);
        playback = signal({ streamUrl: 'http://a/1.ts', title: 'ERT 1' });
        isLive = signal(true);
        retry = jest.fn(() => session.set(null));
        TestBed.configureTestingModule({
            providers: [
                { provide: LiveChannelFailoverService, useValue: failover },
            ],
        });
        watcher = TestBed.runInInjectionContext(
            () =>
                new EmbeddedMpvLiveFailover({
                    playback,
                    session,
                    isLive,
                    isSupported: signal(true),
                    retry,
                })
        );
        TestBed.tick();
    });

    afterEach(() => jest.useRealTimers());

    it('retries a failing stream three times before handing over to failover', () => {
        expect(failover.reportLoading).toHaveBeenCalledWith('ERT 1');

        for (let attempt = 1; attempt <= 3; attempt++) {
            setStatus('error');
            expect(retry).toHaveBeenCalledTimes(attempt);
            expect(failover.reportRetrying).toHaveBeenLastCalledWith(attempt);
        }
        expect(failover.reportFailed).not.toHaveBeenCalled();

        setStatus('error');

        expect(retry).toHaveBeenCalledTimes(3);
        expect(failover.reportFailed).toHaveBeenCalledWith('ERT 1');
    });

    it('gives each attempt ten seconds to start playing', () => {
        setStatus('loading');
        jest.advanceTimersByTime(9_999);
        expect(retry).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);

        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('restores the full retry budget once the stream plays', () => {
        setStatus('error');
        setStatus('error');
        setStatus('playing');
        expect(failover.reportPlaying).toHaveBeenCalledWith('ERT 1');
        jest.advanceTimersByTime(60_000);

        setStatus('error');

        expect(failover.reportRetrying).toHaveBeenLastCalledWith(1);
    });

    it('treats the main-process reconnect as a dropped stream', () => {
        setStatus('playing');

        setStatus('error', {
            reconnect: { attempt: 1, maxAttempts: 6, nextAttemptAt: '' },
        });

        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('gives a failover candidate a single attempt', () => {
        failover.isHopTarget.mockReturnValue(true);

        setStatus('error');

        expect(retry).not.toHaveBeenCalled();
        expect(failover.reportFailed).toHaveBeenCalledWith('ERT 1');
    });

    it("gives the user's own Retry a fresh budget after failover gave up", () => {
        for (let i = 0; i < 4; i++) {
            setStatus('error');
        }
        expect(failover.reportFailed).toHaveBeenCalledTimes(1);

        watcher.restart();
        setStatus('error');

        expect(failover.reportLoading).toHaveBeenCalledTimes(2);
        expect(failover.reportRetrying).toHaveBeenLastCalledWith(1);
        expect(retry).toHaveBeenCalledTimes(4);
    });

    it('stays out of VOD playback and of a disabled setting', () => {
        isLive.set(false);
        TestBed.tick();
        setStatus('error');
        jest.advanceTimersByTime(60_000);

        isLive.set(true);
        failover.enabled.set(false);
        TestBed.tick();
        setStatus('error');

        expect(retry).not.toHaveBeenCalled();
        expect(failover.reportFailed).not.toHaveBeenCalled();
    });
});
