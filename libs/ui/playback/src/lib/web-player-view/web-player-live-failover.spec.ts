import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveChannelFailoverService } from '@iptvnator/playback/data-access';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { WebPlayerLiveFailover } from './web-player-live-failover';

describe('WebPlayerLiveFailover', () => {
    let failover: {
        enabled: ReturnType<typeof signal<boolean>>;
        isHopTarget: jest.Mock;
        reportLoading: jest.Mock;
        reportRetrying: jest.Mock;
        reportPlaying: jest.Mock;
        reportFailed: jest.Mock;
    };
    let playback: ReturnType<typeof signal<ResolvedPortalPlayback | null>>;
    let sessionKey: ReturnType<typeof signal<string>>;
    let isLive: ReturnType<typeof signal<boolean>>;
    let active: ReturnType<typeof signal<boolean>>;
    let retry: jest.Mock;
    let watcher: WebPlayerLiveFailover;

    const issue = {
        code: 'network-error',
        source: 'hls',
        sourceUrl: 'http://a/1.m3u8',
        container: 'hls',
        audioCodecs: [],
        videoCodecs: [],
    } as unknown as PlaybackDiagnostic;

    function flush(): void {
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
        playback = signal<ResolvedPortalPlayback | null>({
            streamUrl: 'http://a/1.m3u8',
            title: 'ERT 1',
        });
        sessionKey = signal('session-1');
        isLive = signal(true);
        active = signal(true);
        retry = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: LiveChannelFailoverService, useValue: failover },
            ],
        });
        watcher = TestBed.runInInjectionContext(
            () =>
                new WebPlayerLiveFailover({
                    failover: failover as unknown as LiveChannelFailoverService,
                    playback,
                    sessionKey,
                    isLive,
                    active,
                    retry,
                })
        );
        flush();
    });

    afterEach(() => jest.useRealTimers());

    it('retries a failing stream three times before handing over to failover', () => {
        expect(failover.reportLoading).toHaveBeenCalledWith('ERT 1');

        for (let attempt = 1; attempt <= 3; attempt++) {
            expect(watcher.onIssue(issue)).toBe(true);
            expect(retry).toHaveBeenCalledTimes(attempt);
            expect(failover.reportRetrying).toHaveBeenLastCalledWith(attempt);
        }
        expect(failover.reportFailed).not.toHaveBeenCalled();

        expect(watcher.onIssue(issue)).toBe(true);

        expect(retry).toHaveBeenCalledTimes(3);
        expect(failover.reportFailed).toHaveBeenCalledWith('ERT 1');
    });

    it('gives each attempt ten seconds to report that it is playing', () => {
        jest.advanceTimersByTime(9_999);
        expect(retry).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);

        expect(retry).toHaveBeenCalledTimes(1);
        expect(failover.reportRetrying).toHaveBeenCalledWith(1);
    });

    it('restores the full retry budget once the engine reports playing', () => {
        watcher.onIssue(issue);
        watcher.onStarted();
        expect(failover.reportPlaying).toHaveBeenCalledWith('ERT 1');
        jest.advanceTimersByTime(60_000);

        expect(watcher.onIssue(issue)).toBe(true);

        expect(failover.reportRetrying).toHaveBeenLastCalledWith(1);
    });

    it('gives a failover candidate a single attempt', () => {
        failover.isHopTarget.mockReturnValue(true);

        expect(watcher.onIssue(issue)).toBe(true);

        expect(retry).not.toHaveBeenCalled();
        expect(failover.reportFailed).toHaveBeenCalledWith('ERT 1');
    });

    it('starts a fresh budget for a different stream in the same session', () => {
        watcher.onIssue(issue);
        watcher.onIssue(issue);
        expect(failover.reportRetrying).toHaveBeenLastCalledWith(2);

        playback.set({ streamUrl: 'http://a/2.m3u8', title: 'ERT 2' });
        flush();
        watcher.onIssue(issue);

        expect(failover.reportLoading).toHaveBeenLastCalledWith('ERT 2');
        expect(failover.reportRetrying).toHaveBeenLastCalledWith(1);
    });

    it('stays out of VOD, of the embedded player, and of a disabled setting', () => {
        isLive.set(false);
        flush();
        expect(watcher.onIssue(issue)).toBe(false);

        isLive.set(true);
        active.set(false);
        flush();
        expect(watcher.onIssue(issue)).toBe(false);

        active.set(true);
        failover.enabled.set(false);
        flush();
        expect(watcher.onIssue(issue)).toBe(false);

        jest.advanceTimersByTime(60_000);

        expect(retry).not.toHaveBeenCalled();
        expect(failover.reportFailed).not.toHaveBeenCalled();
    });
});
