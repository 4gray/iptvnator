import { ApplicationRef } from '@angular/core';

/**
 * Change-detection tick counter for the performance journeys. Only the
 * `electron-performance` build of `apps/web` contains this module: it is
 * imported by `environment.performance.ts`, which `fileReplacements` swaps
 * in for `environment.ts` in that configuration alone. The production and
 * PWA builds never reference it, so their output is unchanged.
 *
 * Angular's own hook, `ɵsetProfiler`, is reachable only through the dev-mode
 * `window.ng` global, which the optimized build does not publish. Every
 * tick, whether scheduled by zone.js (`onMicrotaskEmpty`), the zoneless
 * scheduler or an explicit `ApplicationRef.tick()`, goes through the
 * internal `ApplicationRef._tick`, which is also where Angular emits the
 * profiler's `ChangeDetectionStart`. Counting its calls therefore matches
 * the profiler's count and stays comparable across the zoneless migration.
 * Contract: docs/architecture/performance-journeys.md.
 */
export const CHANGE_DETECTION_TICK_COUNTER_KEY = '__iptvnatorCdTicks';

export interface ChangeDetectionTickCounter {
    /** `ApplicationRef._tick` calls since the counter was installed. */
    readonly count: number;
    readonly schemaVersion: 1;
}

type TickPrototype = { _tick?: (this: ApplicationRef) => void };

export function installChangeDetectionTickCounter(
    target: Record<string, unknown> = globalThis as unknown as Record<
        string,
        unknown
    >,
    prototype: TickPrototype = ApplicationRef.prototype as unknown as TickPrototype
): ChangeDetectionTickCounter {
    const existing = target[CHANGE_DETECTION_TICK_COUNTER_KEY];
    if (existing !== undefined) {
        return existing as ChangeDetectionTickCounter;
    }
    const original = prototype._tick;
    // A renamed internal must fail the performance build loudly, never
    // report zero ticks.
    if (typeof original !== 'function') {
        throw new Error('change-detection-tick-counter-hook-missing');
    }
    const counter = { count: 0, schemaVersion: 1 as const };
    prototype._tick = function countedTick(this: ApplicationRef): void {
        counter.count += 1;
        original.call(this);
    };
    Object.defineProperty(target, CHANGE_DETECTION_TICK_COUNTER_KEY, {
        configurable: false,
        enumerable: false,
        value: counter,
        writable: false,
    });
    return counter;
}
