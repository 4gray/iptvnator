import {
    computed,
    effect,
    linkedSignal,
    signal,
    type Signal,
} from '@angular/core';
import type { EpgItem } from '@iptvnator/shared/interfaces';
import type { EpgGuideWindow } from '@iptvnator/ui/epg';
import {
    sameXtreamLiveOwner,
    type XtreamLiveOwner,
} from './xtream-external-live-sessions.service';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';
import {
    programmeOverlapsGuideWindow,
    type XtreamGuideSchedule,
} from './xtream-guide-schedules';

const DOCK_RETRY_MS = 30_000;

export function retainXtreamPlayingSchedule(
    read: () => {
        owner?: XtreamLiveOwner;
        key?: string;
        revision: unknown;
        panel?: EpgItem[];
        guide?: EpgItem[];
    }
) {
    return linkedSignal({
        source: read,
        computation: (
            { owner, key, revision, panel, guide },
            previous
        ): EpgItem[] => {
            const retained =
                key &&
                key === previous?.source.key &&
                revision === previous.source.revision &&
                sameXtreamLiveOwner(owner, previous.source.owner)
                    ? previous
                    : undefined;
            return (
                // A guide snapshot can outlive the guide; only a new one wins.
                (guide !== retained?.source.guide ? guide : undefined) ??
                (panel !== retained?.source.panel ? panel : undefined) ??
                retained?.value ??
                []
            );
        },
    });
}

/** Keeps the dock current even when its channel is outside the rendered scope. */
export function createXtreamGuideNowPlaying(
    playingKey: Signal<string | null>,
    revision: Signal<unknown>,
    session: Signal<AbortController | null>,
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
        session: AbortController | null;
        value: XtreamGuideSchedule;
    } | null>(null);
    const currentSchedule = computed(() => {
        const current = schedule();
        return current &&
            current.key === playingKey() &&
            current.revision === revision()
            ? current
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
        programs: computed(() => currentSchedule()?.value.programs ?? null),
        items: computed(() => currentSchedule()?.value.items ?? null),
        activeItems: computed(() => {
            const current = currentSchedule();
            const owner = session();
            return owner && current?.session === owner
                ? current.value.items
                : null;
        }),
        recoveredPrograms: (
            window: Pick<EpgGuideWindow, 'fromMs' | 'toMs'>
        ) => {
            const current = currentSchedule();
            const item = target();
            return current && item && expiresAt(item) > Date.now()
                ? current.value.programs.filter((program) =>
                      programmeOverlapsGuideWindow(program, window)
                  )
                : null;
        },
        publish(
            key: string,
            sourceRevision: unknown,
            value: XtreamGuideSchedule
        ) {
            if (key === playingKey())
                schedule.set({
                    key,
                    revision: sourceRevision,
                    session: session(),
                    value,
                });
        },
    };
}
