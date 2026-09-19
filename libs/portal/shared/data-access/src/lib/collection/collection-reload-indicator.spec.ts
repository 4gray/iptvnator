import { DestroyRef } from '@angular/core';
import {
    COLLECTION_RELOAD_INDICATOR_DELAY_MS,
    createCollectionReloadIndicator,
} from './collection-reload-indicator';

describe('createCollectionReloadIndicator', () => {
    let destroyCallbacks: (() => void)[];
    let destroyRef: DestroyRef;

    beforeEach(() => {
        jest.useFakeTimers();
        destroyCallbacks = [];
        destroyRef = {
            onDestroy: (callback: () => void) => {
                destroyCallbacks.push(callback);
                return () => undefined;
            },
        } as unknown as DestroyRef;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('is active at once but visible only after the grace period', () => {
        const indicator = createCollectionReloadIndicator(destroyRef);

        indicator.begin();

        expect(indicator.active()).toBe(true);
        expect(indicator.visible()).toBe(false);

        jest.advanceTimersByTime(COLLECTION_RELOAD_INDICATOR_DELAY_MS - 1);
        expect(indicator.visible()).toBe(false);

        jest.advanceTimersByTime(1);
        expect(indicator.visible()).toBe(true);
    });

    it('never becomes visible when the reload settles inside the grace period', () => {
        const indicator = createCollectionReloadIndicator(destroyRef);

        indicator.begin();
        indicator.settle();
        jest.advanceTimersByTime(COLLECTION_RELOAD_INDICATOR_DELAY_MS * 2);

        expect(indicator.active()).toBe(false);
        expect(indicator.visible()).toBe(false);
    });

    it('keeps the earliest deadline when a reload is superseded before it shows', () => {
        const indicator = createCollectionReloadIndicator(destroyRef);

        indicator.begin();
        jest.advanceTimersByTime(COLLECTION_RELOAD_INDICATOR_DELAY_MS - 20);
        indicator.begin();
        jest.advanceTimersByTime(20);

        expect(indicator.visible()).toBe(true);
    });

    it('stays visible across a superseding begin and clears on settle', () => {
        const indicator = createCollectionReloadIndicator(destroyRef);

        indicator.begin();
        jest.advanceTimersByTime(COLLECTION_RELOAD_INDICATOR_DELAY_MS);
        indicator.begin();

        expect(indicator.visible()).toBe(true);

        indicator.settle();

        expect(indicator.active()).toBe(false);
        expect(indicator.visible()).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('cancels the pending timer when the host is destroyed', () => {
        const indicator = createCollectionReloadIndicator(destroyRef);

        indicator.begin();
        destroyCallbacks.forEach((callback) => callback());
        jest.advanceTimersByTime(COLLECTION_RELOAD_INDICATOR_DELAY_MS);

        expect(indicator.visible()).toBe(false);
    });
});
