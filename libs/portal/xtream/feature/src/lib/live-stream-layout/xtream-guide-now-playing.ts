import { computed, effect, signal, type Signal } from '@angular/core';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

const DOCK_RETRY_MS = 30_000;

/** Keeps the dock current even when its channel is outside the rendered scope. */
export function createXtreamGuideNowPlaying(
    playingKey: Signal<string | null>,
    revision: Signal<unknown>,
    target: () => XtreamLiveChannelItem | undefined,
    read: (
        item: XtreamLiveChannelItem,
        signal: AbortSignal
    ) => Promise<unknown>,
    expiresAt: (item: XtreamLiveChannelItem) => number
) {
    const schedule = signal<{
        key: string;
        revision: unknown;
        programs: EpgProgram[];
    } | null>(null);
    const programs = computed(() => {
        const current = schedule();
        return current?.key === playingKey() && current.revision === revision()
            ? current.programs
            : null;
    });

    effect((onCleanup) => {
        const item = target();
        if (!item) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const refresh = async () => {
            try {
                await read(item, controller.signal);
            } catch {
                // A provider failure is retried on the dock's own clock.
            }
            if (!controller.signal.aborted)
                timer = setTimeout(
                    refresh,
                    Math.max(DOCK_RETRY_MS, expiresAt(item) - Date.now())
                );
        };
        onCleanup(() => {
            controller.abort();
            clearTimeout(timer);
        });
        void refresh();
    });

    return {
        programs,
        publish(key: string, sourceRevision: unknown, items: EpgProgram[]) {
            if (key === playingKey())
                schedule.set({
                    key,
                    revision: sourceRevision,
                    programs: items,
                });
        },
        clear: () => schedule.set(null),
    };
}
