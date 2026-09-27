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

    const expiringIn = (ms: number): SourceExpiryFacts => ({
        expiresAtSeconds: (nowMs + ms) / 1000,
        reportedExpired: false,
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(nowMs);
        facts = signal<ReadonlyMap<string, SourceExpiryFacts>>(new Map());
        clock = TestBed.runInInjectionContext(() =>
            createSourceExpiryClock(facts)
        );
        TestBed.tick();
    });

    afterEach(() => {
        TestBed.resetTestingModule();
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
});
