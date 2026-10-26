import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
    guidePrograms,
    GuideProgram,
    Media,
    ProviderClient,
} from '@iptvnator/tv/util';

export interface GridSchedule {
    programs: GuideProgram[];
    status: 'loading' | 'ready' | 'error';
    updated: number;
}
/** A grid owns its requests, never the player's or the single-channel preview's. */
export function useGridGuide(
    client: ProviderClient | undefined,
    channels: Media[],
    enabled: boolean
) {
    const cache = useRef(new Map<string, GridSchedule>());
    const [revision, refresh] = useState(0);
    const [, render] = useState(0);
    const key = channels.map((item) => item.id).join('\n');
    const current = useRef(channels);
    current.current = channels;
    useEffect(() => {
        cache.current.clear();
    }, [client]);
    useEffect(() => {
        if (!client || !enabled || !client.capabilities.epg) return;
        const controller = new AbortController();
        const items = current.current;
        const records = cache.current;
        const load = async () => {
            // Sequential requests also bound pressure on MAG portals. A delayed
            // viewport avoids issuing requests for every held-arrow repeat.
            for (const item of items) {
                if (controller.signal.aborted) return;
                const cached = records.get(item.id);
                if (
                    cached &&
                    cached.status !== 'loading' &&
                    Date.now() - cached.updated < 300000
                )
                    continue;
                records.delete(item.id);
                records.set(item.id, {
                    programs: cached?.programs ?? [],
                    status: 'loading',
                    updated: 0,
                });
                while (records.size > 60)
                    records.delete(Array.from(records.keys())[0]);
                render((n) => n + 1);
                const request = new AbortController();
                const cancel = () => request.abort();
                controller.signal.addEventListener('abort', cancel, {
                    once: true,
                });
                const deadline = setTimeout(cancel, 10000);
                try {
                    const programs = await client.epg(item, request.signal);
                    if (controller.signal.aborted) return;
                    records.set(item.id, {
                        programs: guidePrograms(programs),
                        status: 'ready',
                        updated: Date.now(),
                    });
                } catch {
                    if (controller.signal.aborted) return;
                    records.set(item.id, {
                        programs: cached?.programs ?? [],
                        status: 'error',
                        updated: Date.now(),
                    });
                } finally {
                    clearTimeout(deadline);
                    controller.signal.removeEventListener('abort', cancel);
                }
                // Keep a bounded session cache, including empty/error responses.
                while (records.size > 60)
                    records.delete(Array.from(records.keys())[0]);
                render((n) => n + 1);
            }
        };
        const timer = setTimeout(() => void load(), 150);
        return () => {
            clearTimeout(timer);
            controller.abort();
            items.forEach((item) => {
                if (records.get(item.id)?.status === 'loading')
                    records.delete(item.id);
            });
        };
    }, [client, key, enabled, revision]);
    // Refresh only the visible rows as time passes, never all visited channels.
    useEffect(() => {
        const timer = setInterval(() => refresh((n) => n + 1), 60000);
        return () => clearInterval(timer);
    }, []);
    return {
        schedules: cache.current,
        supported: !!client?.capabilities.epg,
        retry: () => {
            current.current.forEach((item) => {
                const previous = cache.current.get(item.id);
                if (previous)
                    cache.current.set(item.id, { ...previous, updated: 0 });
            });
            refresh((n) => n + 1);
        },
    };
}

export function useGridRows(items: Media[], scroll: number, selected: number) {
    return useMemo(() => {
        const start = Math.max(
            0,
            Math.min(Math.floor(scroll / 88) - 1, items.length - 12)
        );
        const indices = Array.from(
            { length: Math.min(12, items.length) },
            (_, n) => n + start
        );
        if (items[selected] && !indices.includes(selected))
            indices.push(selected);
        return indices.sort((a, b) => a - b);
    }, [items, scroll, selected]);
}
