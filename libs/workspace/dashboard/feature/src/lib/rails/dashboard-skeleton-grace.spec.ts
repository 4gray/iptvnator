import {
    EnvironmentInjector,
    createEnvironmentInjector,
    signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    DASHBOARD_RAIL_SKELETON_GRACE_MS as GRACE,
    createRailSkeletonGates,
} from './dashboard-skeleton-grace';

function rail(loading = false, rendered = false) {
    const state = { loading: signal(loading), rendered: signal(rendered) };
    return {
        state,
        entry: {
            loading: () => state.loading(),
            rendered: () => state.rendered(),
        },
    };
}

describe('createRailSkeletonGates', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /** Top rail `upper`, then `lower` below it, like two dashboard rails. */
    function setup(graceMs?: number) {
        const upper = rail();
        const lower = rail();
        const injector = createEnvironmentInjector(
            [],
            TestBed.inject(EnvironmentInjector)
        );
        const gates = injector.runInContext(() =>
            createRailSkeletonGates(
                [
                    ['upper', upper.entry],
                    ['lower', lower.entry],
                ] as const,
                graceMs
            )
        );
        const settle = (ms = 0) => {
            TestBed.tick();
            jest.advanceTimersByTime(ms);
            TestBed.tick();
        };
        return { upper, lower, gates, injector, settle };
    }

    it('never shows a skeleton for a rail that resolves within the grace period', () => {
        const { upper, gates, settle } = setup();
        upper.state.loading.set(true);
        settle(GRACE - 1);
        upper.state.loading.set(false);
        settle(GRACE);

        expect(gates.upper()).toBe(false);
    });

    it('shows the skeleton for a rail still loading after the grace period, while nothing below has cards', () => {
        const { upper, gates, settle } = setup();
        upper.state.loading.set(true);
        settle(GRACE);

        expect(gates.upper()).toBe(true);

        upper.state.loading.set(false);
        settle();
        expect(gates.upper()).toBe(false);
    });

    it('measures the grace period from each rail’s own loading start', () => {
        const { lower, gates, settle } = setup();
        // The page has been up for a while before this rail starts loading.
        settle(GRACE * 3);
        lower.state.loading.set(true);
        settle(GRACE - 1);

        expect(gates.lower()).toBe(false);

        lower.state.loading.set(false);
        settle(GRACE);
        expect(gates.lower()).toBe(false);
    });

    it('does not insert a skeleton above a rail that already shows cards', () => {
        const { upper, lower, gates, settle } = setup();
        lower.state.rendered.set(true);
        upper.state.loading.set(true);
        settle(GRACE * 2);

        expect(gates.upper()).toBe(false);
    });

    it('keeps a shown skeleton until its own rail finishes, even when a rail below renders', () => {
        const { upper, lower, gates, settle } = setup();
        upper.state.loading.set(true);
        settle(GRACE);
        expect(gates.upper()).toBe(true);

        lower.state.rendered.set(true);
        settle();
        expect(gates.upper()).toBe(true);

        upper.state.loading.set(false);
        settle();
        expect(gates.upper()).toBe(false);
    });

    it('starts a fresh grace period when a rail loads again', () => {
        const { upper, gates, settle } = setup();
        upper.state.loading.set(true);
        settle(GRACE);
        upper.state.loading.set(false);
        settle();
        upper.state.loading.set(true);
        settle(GRACE - 1);

        expect(gates.upper()).toBe(false);
        settle(1);
        expect(gates.upper()).toBe(true);
    });

    it('clears pending timers when the dashboard is destroyed', () => {
        const { upper, gates, injector, settle } = setup();
        upper.state.loading.set(true);
        settle();
        expect(jest.getTimerCount()).toBe(1);

        injector.destroy();

        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(GRACE * 2);
        expect(gates.upper()).toBe(false);
    });

    it('shows immediately with a zero grace period, still respecting rails below', () => {
        const { upper, lower, gates, settle } = setup(0);
        upper.state.loading.set(true);
        settle();
        expect(gates.upper()).toBe(true);

        const second = setup(0);
        second.lower.state.rendered.set(true);
        second.upper.state.loading.set(true);
        second.settle();
        expect(second.gates.upper()).toBe(false);
        expect(lower.state.rendered()).toBe(false);
    });

    it('needs an injection context', () => {
        expect(() => createRailSkeletonGates([])).toThrow();
    });
});
