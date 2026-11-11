import { inject, Injector, type Signal } from '@angular/core';
import {
    XtreamApiService,
    XtreamFullEpgService,
    type XtreamCredentials,
} from '@iptvnator/portal/xtream/data-access';
import type { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
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

export function injectXtreamGuideSchedules(
    revision: Signal<ScheduleRevision>,
    session: Signal<AbortController | null>,
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

    return {
        reader,
        clear: () => cache.clear(),
        expiresAt: (item: XtreamLiveChannelItem) =>
            cache.expiresAt(scheduleKey(item)),
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
