import type { Injector } from '@angular/core';
import {
    afterFirstScreen,
    DeferredExternalSessions,
} from './parental-lock-external-sessions.deferred';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

    let revision: number;
    let routeUrl: string;
    let emitSession: ((session: { id: string }) => void) | undefined;
    let stopWatching: jest.Mock;

    const create = () =>
        new DeferredExternalSessions(
            {
                injector,
                isLocked: () => locked,
                lockRevision: () => revision,
                routeUrl: () => routeUrl,
            },
            { now: () => clock, schedule: (run) => (scheduled = run), load }
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
        revision = 0;
        routeUrl = '/workspace/playlists/m3u-1/all';
        emitSession = undefined;
        stopWatching = jest.fn();
        (window as { electron?: unknown }).electron = {
            onExternalPlayerSessionUpdate: (
                callback: (session: { id: string }) => void
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
            launchSources: new Map(),
        });
        expect(stopWatching).toHaveBeenCalled();
        expect(deferred.isBusy()).toBe(true);
        deferred.onLockChange();
        expect(tracker.onLockChange).toHaveBeenCalledTimes(1);
    });

    it('hands over a relock that came before the load', async () => {
        const deferred = create();
        clock = 14_000;
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

    it('hands over a lock-set change made while unlocked', async () => {
        locked = false;
        const deferred = create();
        clock = 13_000;
        deferred.onLockChange();
        clock = 14_000;
        revision = 1;
        deferred.onLockChange();

        scheduled?.();
        await flush();

        expect(tracker.start).toHaveBeenCalledWith(
            expect.objectContaining({ lockedAt: 14_000 })
        );
    });

    it('hands over the route each session was first reported on', async () => {
        create();
        emitSession?.({ id: 'session-1' });
        routeUrl = '/workspace/xtreams/xtream-2/live';
        emitSession?.({ id: 'session-1' });
        emitSession?.({ id: 'session-2' });
        routeUrl = '/workspace/dashboard';
        emitSession?.({ id: 'session-3' });

        scheduled?.();
        await flush();

        expect(tracker.start).toHaveBeenCalledWith(
            expect.objectContaining({
                launchSources: new Map([
                    ['session-1', 'm3u-1'],
                    ['session-2', 'xtream-2'],
                    ['session-3', null],
                ]),
            })
        );
    });

    it('stays idle and reports a failed load', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation();
        load.mockRejectedValue(new Error('chunk failed'));
        const deferred = create();
        scheduled?.();
        await flush();

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
