import { signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    SOURCE_EXPIRY_MAX_WAIT_MS,
    type SourceExpiryFacts,
} from '@iptvnator/workspace/dashboard/data-access';
import { createSourceExpiryClock } from './dashboard-source-expiry-clock';

const DAY_MS = 86_400_000;

describe('createSourceExpiryClock', () => {
    const nowMs = Date.UTC(2026, 7, 1, 12, 0, 0);
    let facts: ReturnType<
        typeof signal<ReadonlyMap<string, SourceExpiryFacts>>
    >;
    let clock: Signal<number>;
    let active: ReturnType<typeof signal<boolean>>;

    const expiringIn = (ms: number): SourceExpiryFacts => ({
        expiresAtSeconds: (nowMs + ms) / 1000,
        reportedExpired: false,
    });

    let hidden: boolean;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(nowMs);
        hidden = false;
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            get: () => hidden,
        });
        facts = signal<ReadonlyMap<string, SourceExpiryFacts>>(new Map());
        active = signal(true);
        clock = TestBed.runInInjectionContext(() =>
            createSourceExpiryClock(facts, active)
        );
        TestBed.tick();
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        delete (document as { hidden?: boolean }).hidden;
        jest.useRealTimers();
    });

    it('arms no timer when no badge can change', () => {
        expect(jest.getTimerCount()).toBe(0);

        facts.set(
            new Map([
                ['m3u', { expiresAtSeconds: null, reportedExpired: false }],
                ['gone', { expiresAtSeconds: null, reportedExpired: true }],
            ])
        );
        TestBed.tick();

        expect(jest.getTimerCount()).toBe(0);
    });

    it('moves at the next badge boundary instead of every minute', () => {
        // 2 days and 20 minutes left: the countdown drops to "2 days" in 20
        // minutes, and nothing needs the clock before that.
        facts.set(new Map([['xtream', expiringIn(2 * DAY_MS + 20 * 60_000)]]));
        TestBed.tick();
        const before = clock();

        jest.advanceTimersByTime(19 * 60_000);
        TestBed.tick();
        expect(clock()).toBe(before);

        jest.advanceTimersByTime(2 * 60_000);
        TestBed.tick();
        expect(clock()).toBe(before + 20 * 60_000 + 1_000);
    });

    it('re-reads the clock at least hourly while a boundary is far away', () => {
        facts.set(new Map([['xtream', expiringIn(30 * DAY_MS)]]));
        TestBed.tick();
        const before = clock();

        jest.advanceTimersByTime(SOURCE_EXPIRY_MAX_WAIT_MS);
        TestBed.tick();

        expect(clock()).toBe(before + SOURCE_EXPIRY_MAX_WAIT_MS);
    });

    it('schedules from the real time when facts arrive long after the last tick', () => {
        // No facts yet, so no timer: the clock stays at its start value.
        jest.advanceTimersByTime(50 * 60_000);
        const before = clock();

        // The boundary is 5 minutes from the real time, 55 from the clock.
        facts.set(new Map([['xtream', expiringIn(2 * DAY_MS + 55 * 60_000)]]));
        TestBed.tick();

        jest.advanceTimersByTime(6 * 60_000);
        TestBed.tick();
        expect(clock()).toBeGreaterThan(before);
    });

    it('arms no timer while hidden and catches up as the page returns', () => {
        facts.set(new Map([['xtream', expiringIn(2 * DAY_MS + 20 * 60_000)]]));
        hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        TestBed.tick();
        expect(jest.getTimerCount()).toBe(0);

        jest.advanceTimersByTime(3 * 60 * 60_000);
        hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
        TestBed.tick();

        expect(clock()).toBe(Date.now());
        expect(jest.getTimerCount()).toBe(1);
    });

    it('arms no timer while the sources rail is disabled', () => {
        active.set(false);
        facts.set(new Map([['xtream', expiringIn(2 * DAY_MS + 20 * 60_000)]]));
        TestBed.tick();
        expect(jest.getTimerCount()).toBe(0);

        active.set(true);
        TestBed.tick();
        expect(jest.getTimerCount()).toBe(1);
    });

    it('reads the clock at once when the sources rail is re-enabled', () => {
        active.set(false);
        TestBed.tick();
        // Past the expiry while the rail is off: no boundary is left to wait
        // for, so only the re-enable can refresh the cached badge.
        facts.set(new Map([['xtream', expiringIn(60_000)]]));
        TestBed.tick();
        jest.advanceTimersByTime(3 * 60_000);
        const before = clock();

        active.set(true);
        TestBed.tick();

        expect(clock()).toBe(Date.now());
        expect(clock()).toBeGreaterThan(before);
    });

    it('keeps rechecking an expired timestamp hourly in case the clock is corrected', () => {
        facts.set(new Map([['xtream', expiringIn(-60_000)]]));
        TestBed.tick();
        expect(jest.getTimerCount()).toBe(1);
        const before = clock();

        jest.advanceTimersByTime(SOURCE_EXPIRY_MAX_WAIT_MS);
        TestBed.tick();
        expect(clock()).toBe(before + SOURCE_EXPIRY_MAX_WAIT_MS);
    });
});
