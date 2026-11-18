import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { epgTodayKey, followEpgTodayRollover } from './epg-today';

describe('followEpgTodayRollover', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: new Date(2026, 5, 28, 23, 59, 30).getTime(),
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function setup(viewDay: string) {
        const nowMs = signal(Date.now());
        const day = signal(viewDay);
        const commit = jest.fn((key: string) => day.set(key));
        const today = TestBed.runInInjectionContext(() => {
            const key = epgTodayKey(nowMs);
            followEpgTodayRollover(key, () => day(), commit);
            return key;
        });
        TestBed.flushEffects();
        const tick = (ms: number) => {
            jest.advanceTimersByTime(ms);
            nowMs.set(Date.now());
            TestBed.flushEffects();
        };
        return { day, commit, today, tick };
    }

    it('moves a view on today to the new day at midnight', () => {
        const { day, commit, today, tick } = setup('2026-06-28');

        tick(10_000);
        expect(commit).not.toHaveBeenCalled();

        tick(30_000);
        expect(today()).toBe('2026-06-29');
        expect(commit).toHaveBeenCalledWith('2026-06-29');
        expect(day()).toBe('2026-06-29');
    });

    it('leaves a view the viewer put on another day', () => {
        const { day, commit, tick } = setup('2026-06-27');

        tick(60_000);

        expect(commit).not.toHaveBeenCalled();
        expect(day()).toBe('2026-06-27');
    });
});
