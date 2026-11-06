import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { findParentSeries } from '@iptvnator/tv/data-access';
import {
    LatestRequest,
    Media,
    nextEpisode,
    recoverSeriesContext,
    seriesForEpisode,
} from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';

/** Recent exact parents only. This lane never scans another source on Home. */
export function useVodSequence(tv: TvModel) {
    const lane = useRef(new LatestRequest());
    const latest = useRef(tv);
    latest.current = tv;
    const cache = useRef<{
        client: typeof tv.guideClient;
        lists: Map<string, Media[]>;
    }>({ client: undefined, lists: new Map() });
    const [revision, refresh] = useState(0);
    const [retry, setRetry] = useState(0);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [activating, setActivating] = useState(false);
    const activation = useRef<AbortController>();
    const current =
        tv.fullscreen && tv.playing?.kind === 'episode'
            ? tv.playing
            : undefined;
    const home = tv.route.view === 'home' && !tv.fullscreen;
    const recent = tv.data.history
        .map((progress, ordinal) => ({ progress, ordinal }))
        .sort(
            (a, b) =>
                b.progress.updated - a.progress.updated || a.ordinal - b.ordinal
        )
        .map((entry) => entry.progress);
    const candidates = current
        ? [current]
        : home
          ? recent
                .map((p) => p.item)
                .filter(
                    (e) =>
                        e.kind === 'episode' &&
                        e.sourceId === tv.data.activeId &&
                        !!e.parentId
                )
          : [];
    const keys = Array.from(new Set(candidates.map((e) => e.parentId))).slice(
        0,
        3
    );
    const key = JSON.stringify(keys);
    useLayoutEffect(() => {
        const client = tv.guideClient;
        const source = tv.data.sources.find((s) => s.id === tv.data.activeId);
        if (cache.current.client !== client)
            cache.current = { client, lists: new Map() };
        const job = lane.current.start();
        setFailed(false);
        setBusy(false);
        if (!client || !source || (!current && !home)) return;
        const timer = setTimeout(() => {
            if (!lane.current.owns(job)) return;
            lane.current.cancel();
            setBusy(false);
            if (current) setFailed(true);
        }, 15000);
        if (
            current &&
            tv.episodes.some(
                (e) =>
                    e.id === current.id &&
                    e.sourceId === current.sourceId &&
                    e.parentId === current.parentId
            )
        ) {
            cache.current.lists.set(current.parentId!, tv.episodes);
            if (cache.current.lists.size > 12)
                cache.current.lists.delete(
                    cache.current.lists.keys().next().value!
                );
        }
        const missing = keys.filter(
            (id): id is string => !!id && !cache.current.lists.has(id)
        );
        setBusy(!!missing.length);
        // Sequential loading bounds provider pressure; duplicate parents share one request.
        void (async () => {
            for (const id of missing) {
                if (!lane.current.owns(job)) break;
                const episode = candidates.find((e) => e.parentId === id)!;
                try {
                    let parent = seriesForEpisode(episode, [
                        ...tv.home,
                        ...tv.data.favorites,
                        tv.selected!,
                    ]);
                    if (!parent && episode.seriesTitle)
                        parent = await findParentSeries(
                            client,
                            source,
                            episode,
                            job.signal
                        );
                    if (!parent) throw Error('Exact parent unavailable');
                    const detail = await client.details(parent, job.signal);
                    const episodes = await client.episodes(detail, job.signal);
                    if (!lane.current.owns(job)) break;
                    // Require the exact current identity before accepting a successor.
                    if (
                        !episodes.some(
                            (e) =>
                                e.id === episode.id &&
                                e.sourceId === source.id &&
                                e.parentId === id
                        )
                    )
                        throw Error('Episode unavailable');
                    cache.current.lists.set(id, episodes);
                    if (cache.current.lists.size > 12)
                        cache.current.lists.delete(
                            cache.current.lists.keys().next().value!
                        );
                    refresh((n) => n + 1);
                    await tv
                        .update((data) =>
                            job.signal.aborted
                                ? data
                                : recoverSeriesContext(data, [detail])
                        )
                        .catch(() => undefined);
                } catch {
                    if (lane.current.owns(job) && current) setFailed(true);
                }
            }
        })().finally(() => {
            clearTimeout(timer);
            if (lane.current.owns(job)) setBusy(false);
        });
        return () => {
            clearTimeout(timer);
            lane.current.cancel();
        };
    }, [
        tv.guideClient,
        tv.data.activeId,
        tv.route,
        current?.id,
        home,
        key,
        retry,
    ]);
    useLayoutEffect(() => {
        setActivating(false);
        return () => {
            activation.current?.abort();
            activation.current = undefined;
        };
    }, [
        tv.guideClient,
        tv.data.activeId,
        tv.route,
        tv.fullscreen,
        tv.playing?.id,
    ]);
    const lists =
        cache.current.client === tv.guideClient
            ? cache.current.lists
            : new Map<string, Media[]>();
    const supplied =
        current && tv.episodes.some((e) => e.id === current.id)
            ? tv.episodes
            : (lists.get(current?.parentId ?? '') ?? []);
    const next = current && nextEpisode(current, supplied);
    return {
        lists,
        revision,
        next,
        busy,
        failed,
        activating,
        retry: () => setRetry((n) => n + 1),
        playNext: async () => {
            if (!current || !next || activation.current) return;
            const controller = new AbortController();
            activation.current = controller;
            setActivating(true);
            // Preserve the original page/episode focus through a run of explicit Next actions.
            await latest.current.play(
                next,
                '',
                latest.current.playbackOrigin,
                controller.signal
            );
            if (activation.current === controller) {
                activation.current = undefined;
                setActivating(false);
            }
        },
    };
}
export type VodSequence = ReturnType<typeof useVodSequence>;
