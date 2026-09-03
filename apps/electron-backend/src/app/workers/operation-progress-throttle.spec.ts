import { createProgressEventThrottle } from './operation-progress-throttle';

function createClock(start = 1_000) {
    let now = start;
    return {
        now: () => now,
        advance: (ms: number) => {
            now += ms;
        },
    };
}

describe('createProgressEventThrottle', () => {
    it('emits the first report of a phase immediately', () => {
        const clock = createClock();
        const throttle = createProgressEventThrottle({
            minIntervalMs: 100,
            now: clock.now,
        });

        expect(
            throttle.push({
                phase: 'deleting-content',
                current: 10,
                total: 1000,
                increment: 10,
            })
        ).toEqual([
            {
                phase: 'deleting-content',
                current: 10,
                total: 1000,
                increment: 10,
            },
        ]);
    });

    it('coalesces reports inside the interval and sums their increments', () => {
        const clock = createClock();
        const throttle = createProgressEventThrottle({
            minIntervalMs: 100,
            now: clock.now,
        });
        throttle.push({
            phase: 'deleting-content',
            current: 10,
            total: 1000,
            increment: 10,
        });

        clock.advance(20);
        expect(
            throttle.push({
                phase: 'deleting-content',
                current: 20,
                total: 1000,
                increment: 10,
            })
        ).toEqual([]);
        clock.advance(20);
        expect(
            throttle.push({
                phase: 'deleting-content',
                current: 30,
                total: 1000,
                increment: 10,
            })
        ).toEqual([]);

        clock.advance(60);
        expect(
            throttle.push({
                phase: 'deleting-content',
                current: 40,
                total: 1000,
                increment: 10,
            })
        ).toEqual([
            {
                phase: 'deleting-content',
                current: 40,
                total: 1000,
                increment: 30,
            },
        ]);
    });

    it('never holds back a report that reaches its total', () => {
        const clock = createClock();
        const throttle = createProgressEventThrottle({
            minIntervalMs: 100,
            now: clock.now,
        });
        throttle.push({ phase: 'saving-content', current: 100, total: 205 });

        clock.advance(1);
        expect(
            throttle.push({ phase: 'saving-content', current: 205, total: 205 })
        ).toEqual([{ phase: 'saving-content', current: 205, total: 205 }]);
    });

    it('flushes the pending report of a phase before starting the next one', () => {
        const clock = createClock();
        const throttle = createProgressEventThrottle({
            minIntervalMs: 100,
            now: clock.now,
        });
        throttle.push({
            phase: 'deleting-content',
            current: 10,
            total: 1000,
            increment: 10,
        });
        clock.advance(1);
        throttle.push({
            phase: 'deleting-content',
            current: 20,
            total: 1000,
            increment: 10,
        });

        clock.advance(1);
        expect(
            throttle.push({
                phase: 'deleting-categories',
                current: 1,
                total: 3,
                increment: 1,
            })
        ).toEqual([
            {
                phase: 'deleting-content',
                current: 20,
                total: 1000,
                increment: 10,
            },
            {
                phase: 'deleting-categories',
                current: 1,
                total: 3,
                increment: 1,
            },
        ]);
    });

    it('hands back the pending report on flush, once', () => {
        const clock = createClock();
        const throttle = createProgressEventThrottle({
            minIntervalMs: 100,
            now: clock.now,
        });
        throttle.push({ phase: 'saving-content', current: 1, total: 9 });
        clock.advance(1);
        throttle.push({ phase: 'saving-content', current: 2, total: 9 });

        expect(throttle.flush()).toEqual([
            { phase: 'saving-content', current: 2, total: 9 },
        ]);
        expect(throttle.flush()).toEqual([]);
    });

    it('keeps increment undefined when no coalesced report carried one', () => {
        const clock = createClock();
        const throttle = createProgressEventThrottle({
            minIntervalMs: 100,
            now: clock.now,
        });
        throttle.push({ phase: 'saving-content', current: 1, total: 9 });
        clock.advance(1);
        throttle.push({ phase: 'saving-content', current: 2, total: 9 });
        clock.advance(1);
        throttle.push({ phase: 'saving-content', current: 3, total: 9 });

        expect(throttle.flush()).toEqual([
            { phase: 'saving-content', current: 3, total: 9 },
        ]);
    });
});
