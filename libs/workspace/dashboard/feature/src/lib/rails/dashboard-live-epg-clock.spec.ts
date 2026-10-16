import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DashboardLiveEpgClock } from './dashboard-live-epg-clock';
import { LIVE_EPG_TICK_MS } from './dashboard-live-epg.utils';

describe('DashboardLiveEpgClock', () => {
    let hidden: boolean;
    let clock: DashboardLiveEpgClock;

    const setHidden = (value: boolean) => {
        hidden = value;
        document.dispatchEvent(new Event('visibilitychange'));
        TestBed.tick();
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T10:00:00.000Z'));
        hidden = false;
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            get: () => hidden,
        });
        TestBed.configureTestingModule({ providers: [DashboardLiveEpgClock] });
        clock = TestBed.inject(DashboardLiveEpgClock);
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        delete (document as { hidden?: boolean }).hidden;
        jest.useRealTimers();
    });

    it('schedules nothing while no consumer has a live card', () => {
        const active = signal(false);
        clock.demand(active);
        TestBed.tick();

        expect(jest.getTimerCount()).toBe(0);
    });

    it('ticks on the live-EPG period while demanded and stops when the demand ends', () => {
        const active = signal(true);
        clock.demand(active);
        TestBed.tick();
        const started = clock.now();

        jest.advanceTimersByTime(LIVE_EPG_TICK_MS);
        expect(clock.now()).toBe(started + LIVE_EPG_TICK_MS);

        active.set(false);
        TestBed.tick();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('pauses while the document is hidden and catches up as it returns', () => {
        clock.demand(signal(true));
        TestBed.tick();

        setHidden(true);
        expect(jest.getTimerCount()).toBe(0);

        jest.advanceTimersByTime(5 * 60_000);
        setHidden(false);

        expect(clock.now()).toBe(Date.now());
        expect(jest.getTimerCount()).toBe(1);
    });
});
