import { inject, Injector, type Signal } from '@angular/core';
import {
    XtreamApiService,
    XtreamFullEpgService,
    type XtreamCredentials,
} from '@iptvnator/portal/xtream/data-access';
import {
    foldSearchText,
    type EpgItem,
    type EpgProgram,
} from '@iptvnator/shared/interfaces';
import type { EpgGuideSearchHit, EpgGuideWindow } from '@iptvnator/ui/epg';
import { toSharedEpgProgram } from '../portal-channels-list/epg-preview-program';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';
import { XtreamGuideScheduleCache } from './xtream-guide-schedule-cache';

export type XtreamGuideSchedule = { items: EpgItem[]; programs: EpgProgram[] };
type ScheduleRevision = {
    playlist?: (XtreamCredentials & { id?: string }) | null;
};
const EMPTY: XtreamGuideSchedule = { items: [], programs: [] };

export function scheduleKey(item: XtreamLiveChannelItem): string {
    return `${item.xtream_id}:${item.epg_channel_id ?? ''}`;
}

export function isNewGuideSearchMatch(
    channelId: string,
    program: EpgProgram,
    term: string,
    hits: readonly EpgGuideSearchHit[]
): boolean {
    return (
        foldSearchText(`${program.title} ${program.desc ?? ''}`).includes(
            term
        ) &&
        !hits.some(
            ({ channelId: id, program: previous }) =>
                id === channelId &&
                previous.title === program.title &&
                (previous.startTimestamp ?? previous.start) ===
                    (program.startTimestamp ?? program.start) &&
                (previous.stopTimestamp ?? previous.stop) ===
                    (program.stopTimestamp ?? program.stop)
        )
    );
}

export function programmeOverlapsGuideWindow(
    program: EpgProgram,
    window: Pick<EpgGuideWindow, 'fromMs' | 'toMs'>
): boolean {
    const start = program.startTimestamp
        ? program.startTimestamp * 1000
        : Date.parse(program.start);
    const stop = program.stopTimestamp
        ? program.stopTimestamp * 1000
        : Date.parse(program.stop);
    return stop > start && start < window.toMs && stop > window.fromMs;
}

export function injectXtreamGuideSchedules(
    revision: Signal<ScheduleRevision>,
    session: Signal<AbortController | null>,
    scopedRows: Signal<ReadonlyMap<string, XtreamLiveChannelItem>>,
    publish: (
        key: string,
        revision: unknown,
        schedule: XtreamGuideSchedule
    ) => void
) {
    const injector = inject(Injector);
    let api: XtreamApiService | undefined;
    let cachedRevision: ScheduleRevision | undefined;
    const cache = new XtreamGuideScheduleCache<XtreamGuideSchedule>(
        (sessionId) => void api?.cancelSession(sessionId)
    );

    function reader(signal?: AbortSignal) {
        const current = revision();
        const owner = session()?.signal;
        if (!owner) throw new DOMException('EPG guide closed', 'AbortError');
        const fullEpg = injector.get(XtreamFullEpgService);
        api ??= injector.get(XtreamApiService);
        if (cachedRevision !== current) {
            cachedRevision = current;
            cache.clear();
        }
        const checkCurrent = () => {
            signal?.throwIfAborted();
            owner.throwIfAborted();
            if (current !== revision())
                throw new DOMException('EPG source changed', 'AbortError');
        };
        const readSchedule = async (
            item: XtreamLiveChannelItem | undefined
        ) => {
            const playlist = current.playlist;
            if (!playlist || !item) return EMPTY;
            const key = scheduleKey(item);
            const schedule = await cache.load(
                key,
                checkCurrent,
                async (options) => {
                    const items = await fullEpg.load(
                        playlist,
                        item.xtream_id,
                        item.epg_channel_id ?? null,
                        options
                    );
                    return { items, programs: items.map(toSharedEpgProgram) };
                },
                signal
            );
            checkCurrent();
            publish(key, current, schedule);
            return schedule;
        };
        return {
            readSchedule,
            read: async (item: XtreamLiveChannelItem | undefined) =>
                (await readSchedule(item)).programs,
            checkCurrent,
        };
    }

    const expiresAt = (item: XtreamLiveChannelItem | undefined) =>
        item ? cache.expiresAt(scheduleKey(item)) : 0;
    return {
        reader,
        async loadWindow(
            window: EpgGuideWindow
        ): Promise<Map<string, EpgProgram[]>> {
            const { read } = reader(window.signal);
            const rows = scopedRows();
            const results = await Promise.all(
                window.channels.map(async ({ id }) => {
                    try {
                        return [
                            id,
                            (await read(rows.get(id))).filter((program) =>
                                programmeOverlapsGuideWindow(program, window)
                            ),
                        ] as const;
                    } catch {
                        return null;
                    }
                })
            );
            return new Map(results.filter((result) => result !== null));
        },
        async loadCoverage(
            window: EpgGuideWindow,
            reportPrograms?: (
                channelId: string,
                programs: EpgProgram[] | null
            ) => void
        ): Promise<Set<string>> {
            const { read, checkCurrent } = reader(window.signal);
            const rows = scopedRows();
            const covered = new Set<string>();
            for (const { id } of window.channels) {
                const programs = await read(rows.get(id)).catch(() => {
                    checkCurrent();
                    return null;
                });
                const matches = programs?.filter((item) =>
                    programmeOverlapsGuideWindow(item, window)
                );
                if (!matches || matches.length) covered.add(id);
                reportPrograms?.(id, matches ?? null);
            }
            return covered;
        },
        clear: () => cache.clear(),
        expiresAt,
        rowExpiresAt: (id: string) => expiresAt(scopedRows().get(id)),
        async forPlayback(
            item: XtreamLiveChannelItem,
            signal?: AbortSignal
        ): Promise<EpgItem[] | null> {
            signal?.throwIfAborted();
            const owner = session();
            if (!owner) return null;
            const cached =
                cachedRevision === revision() && cache.peek(scheduleKey(item));
            if (cached) return cached.items;
            try {
                return (await reader(signal).readSchedule(item)).items;
            } catch (error) {
                signal?.throwIfAborted();
                if (owner.signal.aborted && !session()) return null;
                throw error;
            }
        },
    };
}
