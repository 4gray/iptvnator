import {
    PARENTAL_LOCK_BUSY_RECHECK_MS,
    ParentalLockIdleTimer,
} from './parental-lock-idle-timer';

interface FakeScheduler {
    now: number;
    timers: Map<number, { at: number; callback: () => void }>;
    advance(ms: number): void;
}

function createScheduler(): FakeScheduler {
    let nextHandle = 1;
    const scheduler: FakeScheduler = {
        now: 0,
        timers: new Map(),
        advance(ms: number) {
            const target = scheduler.now + ms;
            while (true) {
                const due = [...scheduler.timers.entries()]
                    .filter(([, timer]) => timer.at <= target)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) {
                    break;
                }
                scheduler.timers.delete(due[0]);
                scheduler.now = due[1].at;
                due[1].callback();
            }
            scheduler.now = target;
        },
    };
    return Object.assign(scheduler, {
        setTimeout: (callback: () => void, delay: number) => {
            const handle = nextHandle++;
            scheduler.timers.set(handle, { at: scheduler.now + delay, callback });
            return handle;
        },
        clearTimeout: (handle: number) => {
            scheduler.timers.delete(handle);
        },
    });
}

function createTarget() {
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    return {
        listeners,
        addEventListener: jest.fn((type: string, listener) => {
            listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
        }),
        removeEventListener: jest.fn((type: string, listener) => {
            listeners.get(type)?.delete(listener);
        }),
        fire(type: string) {
            for (const listener of listeners.get(type) ?? []) {
                (listener as EventListener)(new Event(type));
            }
        },
    };
}

function createTimer(options: { busy?: () => boolean } = {}) {
    const scheduler = createScheduler() as FakeScheduler & {
        setTimeout: (callback: () => void, delay: number) => number;
        clearTimeout: (handle: number) => void;
    };
    const target = createTarget();
    const onExpire = jest.fn();
    const timer = new ParentalLockIdleTimer({
        onExpire,
        isBusy: options.busy,
        now: () => scheduler.now,
        setTimeout: scheduler.setTimeout,
        clearTimeout: scheduler.clearTimeout,
        target: target as unknown as Document,
    });
    return { timer, scheduler, target, onExpire };
}

describe('ParentalLockIdleTimer', () => {
    it('expires after the configured minutes without interaction', () => {
        const { timer, scheduler, onExpire } = createTimer();

        timer.arm(15);
        scheduler.advance(14 * 60_000);
        expect(onExpire).not.toHaveBeenCalled();
        scheduler.advance(60_000);
        expect(onExpire).toHaveBeenCalledTimes(1);
        expect(timer.armed).toBe(false);
    });

    it('restarts the countdown on user interaction', () => {
        const { timer, scheduler, target, onExpire } = createTimer();

        timer.arm(5);
        scheduler.advance(4 * 60_000);
        target.fire('keydown');
        scheduler.advance(4 * 60_000);
        expect(onExpire).not.toHaveBeenCalled();
        scheduler.advance(60_000);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('defers expiry while playback is busy and fires once it stops', () => {
        let busy = true;
        const { timer, scheduler, onExpire } = createTimer({ busy: () => busy });

        timer.arm(5);
        scheduler.advance(5 * 60_000);
        expect(onExpire).not.toHaveBeenCalled();
        scheduler.advance(PARENTAL_LOCK_BUSY_RECHECK_MS);
        expect(onExpire).not.toHaveBeenCalled();
        busy = false;
        scheduler.advance(PARENTAL_LOCK_BUSY_RECHECK_MS);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('never fires with 0 minutes and stops listening once disarmed', () => {
        const { timer, scheduler, target, onExpire } = createTimer();

        timer.arm(0);
        expect(timer.armed).toBe(false);
        expect(target.addEventListener).not.toHaveBeenCalled();

        timer.arm(1);
        expect(target.addEventListener).toHaveBeenCalled();
        timer.disarm();
        scheduler.advance(10 * 60_000);
        expect(onExpire).not.toHaveBeenCalled();
        expect(target.removeEventListener).toHaveBeenCalled();
    });
});
