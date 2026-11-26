import type { Injector } from '@angular/core';
import {
    afterFirstScreen,
    DeferredExternalSessions,
} from './parental-lock-external-sessions.deferred';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Reported = {
    id: string;
    streamUrl: string;
    startedAt?: string;
    contentInfo?: { playlistId?: string };
};

describe('DeferredExternalSessions', () => {
    let clock: number;
    let locked: boolean;
    let scheduled: (() => void) | undefined;
    let tracker: {
        start: jest.Mock;
        isBusy: jest.Mock;
        onLockChange: jest.Mock;
    };
    let load: jest.Mock;
    let injector: Injector;

    let lockSets: Record<string, string>;
    let routeUrl: string;
    let emitSession: ((session: Reported) => void) | undefined;
    let stopWatching: jest.Mock;

    const create = () =>
        new DeferredExternalSessions(
            {
                injector,
                isLocked: () => locked,
                lockSetKey: (id: string | null) =>
                    `${id ?? '*'}:${lockSets[id ?? '*'] ?? ''}`,
                routeUrl: () => routeUrl,
            },
            {
                now: () => clock,
                schedule: (run) => (scheduled = run),
                load,
                retryMs: 0,
            }
        );

    beforeEach(() => {
        clock = 10_000;
        locked = true;
        scheduled = undefined;
        tracker = {
            start: jest.fn(),
            isBusy: jest.fn(() => true),
            onLockChange: jest.fn(),
        };
        class ParentalLockExternalSessions {}
        injector = { get: jest.fn(() => tracker) } as unknown as Injector;
        load = jest.fn(async () => ({ ParentalLockExternalSessions }));
        lockSets = {};
        routeUrl = '/workspace/playlists/m3u-1/all';
        emitSession = undefined;
        stopWatching = jest.fn();
        (window as { electron?: unknown }).electron = {
            onExternalPlayerSessionUpdate: (
                callback: (session: Reported) => void
            ) => {
                emitSession = callback;
                return stopWatching;
            },
        };
    });

    afterEach(() => {
        delete (window as { electron?: unknown }).electron;
        jest.useRealTimers();
    });

    it('loads nothing where no bridge reports players outside the page', () => {
        delete (window as { electron?: unknown }).electron;
        const deferred = create();

        expect(scheduled).toBeUndefined();
        expect(deferred.isBusy()).toBe(false);
        deferred.onLockChange();
        expect(load).not.toHaveBeenCalled();
    });

    it('loads the tracker after the first screen and starts it with the page clock', async () => {
        const deferred = create();
        expect(load).not.toHaveBeenCalled();
        expect(deferred.isBusy()).toBe(false);

        clock = 12_000;
        scheduled?.();
        await flush();

        expect(tracker.start).toHaveBeenCalledWith({
            pageStartedAt: 10_000,
            lockedAt: 10_000,
            lockSet: '*:',
            launchSources: new Map(),
        });
        expect(stopWatching).toHaveBeenCalled();
        expect(deferred.isBusy()).toBe(true);
        deferred.onLockChange();
        expect(tracker.onLockChange).toHaveBeenCalledTimes(1);
    });

    it('hands over a relock that came before the load', async () => {
        locked = false;
        const deferred = create();
        clock = 14_000;
        locked = true;
        deferred.onLockChange();
        clock = 15_000;
        locked = false;
        deferred.onLockChange();

        scheduled?.();
        await flush();

        // An unlock moves nothing: only the last relock counts.
        expect(tracker.start).toHaveBeenCalledWith(
            expect.objectContaining({ pageStartedAt: 10_000, lockedAt: 14_000 })
        );
        expect(tracker.onLockChange).not.toHaveBeenCalled();
    });

    it('moves nothing on a version bump that was no relock', async () => {
        const deferred = create();
        clock = 14_000;
        deferred.onLockChange();

        scheduled?.();
        await flush();

        expect(tracker.start).toHaveBeenCalledWith(
            expect.objectContaining({ lockedAt: 10_000 })
        );
    });

    it('hands over a lock-set change made while unlocked', async () => {
        locked = false;
        const deferred = create();
        clock = 13_000;
        deferred.onLockChange();
        clock = 14_000;
        lockSets['*'] = 'm3u-1:Synthetic group';
        deferred.onLockChange();

        scheduled?.();
        await flush();

        expect(tracker.start).toHaveBeenCalledWith(
            expect.objectContaining({
                lockedAt: 14_000,
                lockSet: '*:m3u-1:Synthetic group',
            })
        );
    });

    it("hands over the route of each session's media", async () => {
        const film = 'http://stream.example/film.mkv';
        const report = (id: string, streamUrl = film) =>
            emitSession?.({
                id,
                streamUrl,
                startedAt: new Date(11_000).toISOString(),
            });
        create();
        report('session-1');
        routeUrl = '/workspace/xtreams/xtream-2/live';
        // A status report keeps the launch route; a switch takes the new one.
        report('session-1');
        report('session-2');
        routeUrl = '/workspace/dashboard';
        report('session-3');
        routeUrl = '/workspace/stalker/stalker-4/itv';
        // The PIN was entered: a switch now is media opened while unlocked.
        locked = false;
        report('session-2', 'http://stream.example/b');

        scheduled?.();
        await flush();

        const launch = (sourceId: string | null, openedLocked: boolean) => ({
            sourceId,
            openedLocked,
            lockKey: `${sourceId ?? '*'}:`,
        });
        expect(tracker.start).toHaveBeenCalledWith(
            expect.objectContaining({
                launchSources: new Map([
                    ['session-1', launch('m3u-1', true)],
                    ['session-2', launch('stalker-4', false)],
                    ['session-3', launch(null, true)],
                ]),
            })
        );
    });

    describe('how a session was opened', () => {
        const film = 'http://stream.example/film.mkv';
        const handedOver = async (id = 'session-1') => {
            scheduled?.();
            await flush();
            return tracker.start.mock.calls[0][0].launchSources.get(id);
        };

        it('counts media launched before a relock and reported after it as opened unlocked', async () => {
            locked = false;
            const deferred = create();
            clock = 13_000;
            locked = true;
            deferred.onLockChange();
            emitSession?.({
                id: 'session-1',
                streamUrl: film,
                startedAt: new Date(12_000).toISOString(),
            });

            expect(await handedOver()).toMatchObject({ openedLocked: false });
        });

        it('keeps media opened unlocked counted so after a switch while locked', async () => {
            locked = false;
            const deferred = create();
            emitSession?.({
                id: 'session-1',
                streamUrl: film,
                startedAt: new Date(10_000).toISOString(),
            });
            clock = 12_000;
            locked = true;
            deferred.onLockChange();
            emitSession?.({
                id: 'session-1',
                streamUrl: 'http://stream.example/b',
                startedAt: new Date(10_000).toISOString(),
            });

            expect(await handedOver()).toMatchObject({ openedLocked: false });
        });

        it("hands over the locks of the session's source as it saw them", async () => {
            create();
            lockSets['xtream-2'] = 'live:7';
            emitSession?.({
                id: 'session-1',
                streamUrl: film,
                startedAt: new Date(11_000).toISOString(),
                contentInfo: { playlistId: 'xtream-2' },
            });
            lockSets['xtream-2'] = 'live:7,live:8';

            expect(await handedOver()).toMatchObject({
                openedLocked: true,
                lockKey: 'xtream-2:live:7',
            });
        });
    });

    it('retries a failed load', async () => {
        load.mockRejectedValueOnce(new Error('chunk failed'));
        create();
        scheduled?.();
        await flush();
        await flush();

        expect(load).toHaveBeenCalledTimes(2);
        expect(tracker.start).toHaveBeenCalled();
    });

    it('stays idle and reports a load that keeps failing', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation();
        load.mockRejectedValue(new Error('chunk failed'));
        const deferred = create();
        scheduled?.();
        for (let i = 0; i < 4; i++) await flush();

        expect(load).toHaveBeenCalledTimes(3);

        expect(deferred.isBusy()).toBe(false);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('waits a second, then for an idle moment', () => {
        jest.useFakeTimers();
        const run = jest.fn();
        const idle = jest.fn((callback: () => void) => {
            callback();
            return 1;
        });
        (
            globalThis as unknown as { requestIdleCallback?: unknown }
        ).requestIdleCallback = idle;
        afterFirstScreen(run);
        jest.advanceTimersByTime(999);
        expect(run).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(idle).toHaveBeenCalledWith(run, { timeout: 5000 });
        expect(run).toHaveBeenCalledTimes(1);

        delete (globalThis as { requestIdleCallback?: unknown })
            .requestIdleCallback;
        afterFirstScreen(run);
        jest.advanceTimersByTime(1000);
        expect(run).toHaveBeenCalledTimes(2);
    });
});
