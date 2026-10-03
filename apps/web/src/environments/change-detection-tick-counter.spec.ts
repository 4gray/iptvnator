import { ApplicationRef, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    CHANGE_DETECTION_TICK_COUNTER_KEY,
    installChangeDetectionTickCounter,
} from './change-detection-tick-counter';

describe('installChangeDetectionTickCounter', () => {
    it('counts every _tick call and forwards to the original', () => {
        const calls: unknown[] = [];
        const prototype = {
            _tick(this: unknown) {
                calls.push(this);
            },
        };
        const target: Record<string, unknown> = {};

        const counter = installChangeDetectionTickCounter(target, prototype);
        const instance = {};
        prototype._tick.call(instance);
        prototype._tick.call(instance);

        expect(counter.count).toBe(2);
        expect(calls).toEqual([instance, instance]);
        expect(target[CHANGE_DETECTION_TICK_COUNTER_KEY]).toBe(counter);
    });

    it('installs once per target', () => {
        const prototype = { _tick: jest.fn() };
        const target: Record<string, unknown> = {};

        const first = installChangeDetectionTickCounter(target, prototype);
        const second = installChangeDetectionTickCounter(target, prototype);
        prototype._tick();

        expect(second).toBe(first);
        expect(first.count).toBe(1);
    });

    it('fails when the internal tick method is missing', () => {
        expect(() => installChangeDetectionTickCounter({}, {})).toThrow(
            'change-detection-tick-counter-hook-missing'
        );
    });

    it('counts the ticks of the installed Angular version', () => {
        @Component({ template: '{{ value() }}' })
        class CounterHostComponent {
            readonly value = signal(0);
        }
        const prototype = ApplicationRef.prototype as unknown as {
            _tick: () => void;
        };
        const original = prototype._tick;
        try {
            const counter = installChangeDetectionTickCounter({});
            const fixture = TestBed.createComponent(CounterHostComponent);
            const appRef = TestBed.inject(ApplicationRef);
            appRef.attachView(fixture.componentRef.hostView);
            const before = counter.count;

            appRef.tick();
            fixture.componentInstance.value.set(1);
            appRef.tick();

            expect(counter.count - before).toBe(2);
            expect(fixture.nativeElement.textContent).toBe('1');
        } finally {
            prototype._tick = original;
        }
    });
});
