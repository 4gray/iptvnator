import {
    computed,
    effect,
    untracked,
    type Signal,
    type WritableSignal,
} from '@angular/core';
import { getTodayEpgDateKey } from './epg-date';

/** Today's EPG date key, re-read on every tick of the view's clock signal. */
export function epgTodayKey(nowMs: Signal<number>): Signal<string> {
    return computed(() => {
        nowMs();
        return getTodayEpgDateKey();
    });
}

/**
 * Keeps a view that shows today on today when the clock crosses midnight;
 * a view on another day stays where the viewer put it. Without this the
 * view keeps yesterday's day (and its "today" state) until it is reopened.
 * Must run in an injection context.
 */
export function followEpgTodayRollover(
    today: Signal<string>,
    viewDayKey: () => string,
    commit: (dayKey: string) => void
): void {
    let previous = untracked(today);
    effect(() => {
        const current = today();
        untracked(() => {
            if (current !== previous && viewDayKey() === previous) {
                commit(current);
            }
            previous = current;
        });
    });
}

/**
 * A view's clock: re-reads `nowMs` every `intervalMs` for as long as the
 * view lives, and keeps a view on today across midnight. Returns today's
 * key. Must run in an injection context.
 */
export function runEpgViewClock(
    nowMs: WritableSignal<number>,
    intervalMs: number,
    day: { viewDayKey: () => string; commit: (dayKey: string) => void }
): Signal<string> {
    effect((onCleanup) => {
        const intervalId = window.setInterval(
            () => nowMs.set(Date.now()),
            intervalMs
        );
        onCleanup(() => clearInterval(intervalId));
    });
    const today = epgTodayKey(nowMs);
    followEpgTodayRollover(today, day.viewDayKey, day.commit);
    return today;
}
