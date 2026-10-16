import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Often enough for durations shown in whole hours and days. */
export const SOURCE_CLOCK_TICK_MS = 60_000;

/**
 * One shared minute clock for source rows, so "Not responding · 3 days"
 * moves on while a list stays open, without a timer per row.
 */
@Injectable({ providedIn: 'root' })
export class SourceClock {
    private readonly state = signal(Date.now());
    readonly now = this.state.asReadonly();

    constructor() {
        const timer = setInterval(
            () => this.state.set(Date.now()),
            SOURCE_CLOCK_TICK_MS
        );
        inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
}
