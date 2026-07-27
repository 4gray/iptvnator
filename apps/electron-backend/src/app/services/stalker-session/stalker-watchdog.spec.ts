import {
    STALKER_WATCHDOG_INTERVALS,
    StalkerWatchdog,
    resolveStalkerWatchdogIntervalMs,
} from './stalker-watchdog';
import type {
    StalkerWatchdogActivation,
    StalkerWatchdogClock,
    StalkerWatchdogClockCallback,
    StalkerWatchdogTarget,
} from './stalker-watchdog';

interface ScheduledTask {
    readonly callback: StalkerWatchdogClockCallback;
    readonly delayMs: number;
    cancelled: boolean;
}

class ManualWatchdogClock implements StalkerWatchdogClock {
    readonly scheduledDelays: number[] = [];
    readonly #tasks: ScheduledTask[] = [];

    get pendingCount(): number {
        return this.#tasks.filter((task) => !task.cancelled).length;
    }

    schedule(
        callback: StalkerWatchdogClockCallback,
        delayMs: number
    ): () => void {
        const task: ScheduledTask = {
            callback,
            cancelled: false,
            delayMs,
        };
        this.#tasks.push(task);
        this.scheduledDelays.push(delayMs);
        return () => {
            task.cancelled = true;
        };
    }

    async runNext(): Promise<boolean> {
        const index = this.#tasks.findIndex((task) => !task.cancelled);
        if (index < 0) {
            return false;
        }
        const [task] = this.#tasks.splice(index, 1);
        task.cancelled = true;
        await task.callback();
        return true;
    }
}

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

async function flushMicrotasks(): Promise<void> {
    for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
    }
}

function activation(
    overrides: Partial<StalkerWatchdogActivation> = {}
): StalkerWatchdogActivation {
    return {
        leaseRef: 'lease-a',
        principal: 'principal-a',
        profile: { timeslot: 30 },
        sessionKey: 'session-a',
        ...overrides,
    };
}

function createHarness(
    options: {
        readonly isWireActive?: (
            target: Readonly<StalkerWatchdogTarget>
        ) => boolean | Promise<boolean>;
        readonly jitter?: () => number;
        readonly joinRefresh?: (
            target: Readonly<StalkerWatchdogTarget>
        ) => Promise<void> | undefined;
        readonly ping?: (
            target: Readonly<StalkerWatchdogTarget>
        ) => Promise<void>;
    } = {}
) {
    const clock = new ManualWatchdogClock();
    const isWireActive = jest.fn(
        options.isWireActive ??
            ((_target: Readonly<StalkerWatchdogTarget>) => true)
    );
    const jitter = jest.fn(options.jitter ?? (() => 0));
    const joinRefresh = jest.fn(
        options.joinRefresh ??
            ((_target: Readonly<StalkerWatchdogTarget>) => undefined)
    );
    const ping = jest.fn(
        options.ping ??
            (async (_target: Readonly<StalkerWatchdogTarget>) => undefined)
    );
    const watchdog = new StalkerWatchdog({
        clock,
        isWireActive,
        jitter,
        joinRefresh,
        ping,
    });
    return {
        clock,
        isWireActive,
        jitter,
        joinRefresh,
        ping,
        watchdog,
    };
}

describe('resolveStalkerWatchdogIntervalMs', () => {
    it('prefers a valid profile timeslot and accepts decimal strings', () => {
        expect(
            resolveStalkerWatchdogIntervalMs({
                timeslot: '42.5',
                watchdog_timeout: '80',
            })
        ).toBe(42_500);
    });

    it('falls back to watchdog_timeout when timeslot is invalid', () => {
        expect(
            resolveStalkerWatchdogIntervalMs({
                timeslot: 'not-a-number',
                watchdog_timeout: '40',
            })
        ).toBe(40_000);
    });

    it.each([
        undefined,
        {},
        { timeslot: 0 },
        { timeslot: -2 },
        { timeslot: Number.NaN },
        { timeslot: Number.POSITIVE_INFINITY },
        { timeslot: '20 seconds' },
    ])('uses the conservative default for invalid profile %p', (profile) => {
        expect(resolveStalkerWatchdogIntervalMs(profile)).toBe(
            STALKER_WATCHDOG_INTERVALS.defaultMs
        );
    });

    it('clamps finite profile values to safe minimum and maximum delays', () => {
        expect(resolveStalkerWatchdogIntervalMs({ timeslot: 0.5 })).toBe(
            STALKER_WATCHDOG_INTERVALS.minimumMs
        );
        expect(
            resolveStalkerWatchdogIntervalMs({
                timeslot: Number.MAX_VALUE,
            })
        ).toBe(STALKER_WATCHDOG_INTERVALS.maximumMs);
    });

    it('applies bounded deterministic jitter without escaping the clamps', () => {
        expect(resolveStalkerWatchdogIntervalMs({ timeslot: 100 }, -1)).toBe(
            90_000
        );
        expect(resolveStalkerWatchdogIntervalMs({ timeslot: 100 }, 1)).toBe(
            110_000
        );
        expect(resolveStalkerWatchdogIntervalMs({ timeslot: 100 }, 99)).toBe(
            110_000
        );
        expect(
            resolveStalkerWatchdogIntervalMs({ timeslot: 100 }, Number.NaN)
        ).toBe(100_000);
        expect(resolveStalkerWatchdogIntervalMs({ timeslot: 1 }, -1)).toBe(
            STALKER_WATCHDOG_INTERVALS.minimumMs
        );
        expect(resolveStalkerWatchdogIntervalMs({ timeslot: 1_000 }, 1)).toBe(
            STALKER_WATCHDOG_INTERVALS.maximumMs
        );
    });
});

describe('StalkerWatchdog', () => {
    it('starts a profile-derived timer and retains one watchdog for multiple leases', () => {
        const { clock, watchdog } = createHarness();

        watchdog.activate(activation());
        watchdog.activate(
            activation({
                leaseRef: 'lease-b',
                profile: { timeslot: 90 },
            })
        );
        watchdog.activate(activation());

        expect(clock.pendingCount).toBe(1);
        expect(clock.scheduledDelays).toEqual([30_000]);

        watchdog.deactivate(activation());
        expect(clock.pendingCount).toBe(1);

        watchdog.deactivate(activation({ leaseRef: 'lease-b' }));
        expect(clock.pendingCount).toBe(0);
    });

    it('uses the injected jitter source independently for each scheduled tick', async () => {
        const jitterValues = [-1, 1];
        const { clock, jitter, watchdog } = createHarness({
            jitter: () => jitterValues.shift() ?? 0,
        });

        watchdog.activate(activation({ profile: { timeslot: 100 } }));
        expect(clock.scheduledDelays).toEqual([90_000]);

        await clock.runNext();

        expect(clock.scheduledDelays).toEqual([90_000, 110_000]);
        expect(jitter).toHaveBeenCalledTimes(2);
    });

    it('pings only the wire-active principal and keeps inactive sessions scheduled', async () => {
        let wireActivePrincipal = 'principal-b';
        const { clock, ping, watchdog } = createHarness({
            isWireActive: (target) => target.principal === wireActivePrincipal,
        });
        watchdog.activate(activation());
        watchdog.activate(
            activation({
                leaseRef: 'lease-b',
                principal: 'principal-b',
            })
        );

        await clock.runNext();
        await clock.runNext();

        expect(ping).toHaveBeenCalledTimes(1);
        expect(ping).toHaveBeenCalledWith({
            principal: 'principal-b',
            sessionKey: 'session-a',
        });
        expect(clock.pendingCount).toBe(2);

        wireActivePrincipal = 'principal-a';
        await clock.runNext();
        expect(ping).toHaveBeenLastCalledWith({
            principal: 'principal-a',
            sessionKey: 'session-a',
        });
    });

    it('joins an in-flight refresh, rechecks wire ownership, and skips a stale ping', async () => {
        const refresh = deferred();
        const ownership = [true, false];
        const { clock, isWireActive, joinRefresh, ping, watchdog } =
            createHarness({
                isWireActive: () => ownership.shift() ?? false,
                joinRefresh: () => refresh.promise,
            });
        watchdog.activate(activation());

        const tick = clock.runNext();
        await flushMicrotasks();

        expect(joinRefresh).toHaveBeenCalledWith({
            principal: 'principal-a',
            sessionKey: 'session-a',
        });
        expect(ping).not.toHaveBeenCalled();

        refresh.resolve();
        await tick;

        expect(isWireActive).toHaveBeenCalledTimes(2);
        expect(ping).not.toHaveBeenCalled();
        expect(clock.pendingCount).toBe(1);
    });

    it('waits for an in-flight refresh before pinging the still-active principal', async () => {
        const refresh = deferred();
        const { clock, ping, watchdog } = createHarness({
            joinRefresh: () => refresh.promise,
        });
        watchdog.activate(activation());

        const tick = clock.runNext();
        await flushMicrotasks();
        expect(ping).not.toHaveBeenCalled();

        refresh.resolve();
        await tick;

        expect(ping).toHaveBeenCalledTimes(1);
        expect(clock.pendingCount).toBe(1);
    });

    it('serializes pings and schedules the next tick only after completion', async () => {
        const firstPing = deferred();
        const ping = jest
            .fn<Promise<void>, [Readonly<StalkerWatchdogTarget>]>()
            .mockReturnValueOnce(firstPing.promise)
            .mockResolvedValue(undefined);
        const { clock, watchdog } = createHarness({ ping });
        watchdog.activate(activation());

        const firstTick = clock.runNext();
        await flushMicrotasks();

        expect(ping).toHaveBeenCalledTimes(1);
        expect(clock.pendingCount).toBe(0);
        await expect(clock.runNext()).resolves.toBe(false);

        firstPing.resolve();
        await firstTick;
        expect(clock.pendingCount).toBe(1);

        await clock.runNext();
        expect(ping).toHaveBeenCalledTimes(2);
    });

    it('does not ping or reschedule after the last lease stops during refresh', async () => {
        const refresh = deferred();
        const { clock, ping, watchdog } = createHarness({
            joinRefresh: () => refresh.promise,
        });
        const lease = activation();
        watchdog.activate(lease);

        const tick = clock.runNext();
        await flushMicrotasks();
        watchdog.deactivate(lease);
        refresh.resolve();
        await tick;

        expect(ping).not.toHaveBeenCalled();
        expect(clock.pendingCount).toBe(0);
    });

    it('does not ping when cleanup happens during the final wire-ownership check', async () => {
        const finalOwnership = deferred<boolean>();
        let ownershipChecks = 0;
        const { clock, ping, watchdog } = createHarness({
            isWireActive: () => {
                ownershipChecks += 1;
                return ownershipChecks === 1 ? true : finalOwnership.promise;
            },
        });
        const lease = activation();
        watchdog.activate(lease);

        const tick = clock.runNext();
        await flushMicrotasks();
        expect(ownershipChecks).toBe(2);

        watchdog.deactivate(lease);
        finalOwnership.resolve(true);
        await tick;

        expect(ping).not.toHaveBeenCalled();
        expect(clock.pendingCount).toBe(0);
    });

    it('cleans every principal for one session and can clean all sessions', async () => {
        const { clock, ping, watchdog } = createHarness();
        watchdog.activate(activation());
        watchdog.activate(
            activation({
                leaseRef: 'lease-b',
                principal: 'principal-b',
            })
        );
        watchdog.activate(
            activation({
                leaseRef: 'lease-c',
                principal: 'principal-c',
                sessionKey: 'session-b',
            })
        );

        expect(clock.pendingCount).toBe(3);

        watchdog.cleanupSession('session-a');
        expect(clock.pendingCount).toBe(1);

        await clock.runNext();
        expect(ping).toHaveBeenCalledWith({
            principal: 'principal-c',
            sessionKey: 'session-b',
        });

        watchdog.cleanupAll();
        expect(clock.pendingCount).toBe(0);
    });

    it('continues scheduling after a ping failure without overlapping work', async () => {
        const { clock, ping, watchdog } = createHarness({
            ping: jest
                .fn<Promise<void>, [Readonly<StalkerWatchdogTarget>]>()
                .mockRejectedValueOnce(new Error('classified-watchdog-failure'))
                .mockResolvedValue(undefined),
        });
        watchdog.activate(activation());

        await clock.runNext();

        expect(ping).toHaveBeenCalledTimes(1);
        expect(clock.pendingCount).toBe(1);
        await clock.runNext();
        expect(ping).toHaveBeenCalledTimes(2);
    });
});
