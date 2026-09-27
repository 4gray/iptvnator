import {
    DestroyRef,
    EnvironmentInjector,
    createEnvironmentInjector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    DASHBOARD_RAIL_SKELETON_GRACE_MS,
    createRailSkeletonGrace,
} from './dashboard-skeleton-grace';

describe('createRailSkeletonGrace', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function createInScope(delayMs?: number) {
        const injector = createEnvironmentInjector(
            [],
            TestBed.inject(EnvironmentInjector)
        );
        const grace = injector.runInContext(() =>
            createRailSkeletonGrace(delayMs)
        );
        return { grace, injector };
    }

    it('keeps skeletons hidden while rails that load quickly resolve', () => {
        const { grace } = createInScope();

        jest.advanceTimersByTime(DASHBOARD_RAIL_SKELETON_GRACE_MS - 1);

        expect(grace()).toBe(false);
    });

    it('allows skeletons once a rail keeps loading past the grace period', () => {
        const { grace } = createInScope();

        jest.advanceTimersByTime(DASHBOARD_RAIL_SKELETON_GRACE_MS);

        expect(grace()).toBe(true);
    });

    it('clears its timer when the dashboard is destroyed', () => {
        const { grace, injector } = createInScope();

        injector.destroy();
        jest.advanceTimersByTime(DASHBOARD_RAIL_SKELETON_GRACE_MS * 2);

        expect(grace()).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('treats a zero delay as elapsed without scheduling a timer', () => {
        const { grace } = createInScope(0);

        expect(grace()).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('needs an injection context', () => {
        expect(() => createRailSkeletonGrace()).toThrow();
    });
});
