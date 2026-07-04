import { effect, untracked, WritableSignal } from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { EpgListScrollController } from './epg-list-scroll.controller';
import { EpgListRow } from './epg-list-view.utils';

export interface EpgListViewEffectsContext {
    /** Wall-clock signal driving past/now/future classification + progress. */
    readonly nowMs: WritableSignal<number>;
    readonly list: () => HTMLElement | undefined;
    readonly rows: () => readonly EpgListRow[];
    readonly programs: () => readonly EpgProgram[];
    readonly isViewToday: () => boolean;
    readonly channelName: () => string;
    readonly scroll: EpgListScrollController;
}

/**
 * The list view's reactive plumbing, kept out of the component so it stays
 * within the file-size guideline. Must be called from the component's
 * constructor (an injection context — `effect()` requires one).
 */
export function registerEpgListViewEffects(
    ctx: EpgListViewEffectsContext
): void {
    // 30s tick reclassifies past/now/future and refreshes progress. The list
    // is a controlled component (activeProgram/isLivePlayback come from the
    // host), so the tick never clobbers active archive playback.
    effect((onCleanup) => {
        const intervalId = window.setInterval(
            () => ctx.nowMs.set(Date.now()),
            30_000
        );
        onCleanup(() => clearInterval(intervalId));
    });

    // Auto-focus the on-air row when a channel's EPG (re)loads or the list
    // (re)mounts (collapse → expand) — the vertical analogue of the ribbon's
    // auto-focus. Tracks the `list` viewChild so a remount re-triggers, and
    // `rows` so day changes and 30s ticks refresh the now-strip; the
    // controller dedupes by programme-set identity so neither re-jumps the
    // viewport.
    effect(() => {
        const list = ctx.list();
        ctx.rows();
        const programs = ctx.programs();
        const today = ctx.isViewToday();
        const channel = ctx.channelName();
        untracked(() =>
            ctx.scroll.maybeAutoScroll(list, programs, today, channel)
        );
    });
}
