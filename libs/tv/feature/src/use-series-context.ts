import { useEffect, useRef } from 'preact/hooks';
import {
    continueWatching,
    ProviderClient,
    recoverSeriesContext,
    seriesForEpisode,
} from '@iptvnator/tv/util';
import { findParentSeries } from '@iptvnator/tv/data-access';
import type { TvModel } from './use-tv';

export function useSeriesContext(tv: TvModel) {
    const attempted = useRef(new WeakMap<ProviderClient, Set<string>>());
    useEffect(() => {
        const parents = [
            ...tv.home,
            ...tv.catalog.items,
            ...tv.data.favorites,
            tv.selected,
        ];
        if (recoverSeriesContext(tv.data, parents) === tv.data) return;
        void tv
            .update((data) => recoverSeriesContext(data, parents))
            .catch(() => undefined);
    }, [
        tv.home,
        tv.catalog.items,
        tv.selected,
        tv.data.history,
        tv.data.favorites,
        tv.data.positions,
    ]);
    useEffect(() => {
        const client = tv.guideClient;
        const source = tv.data.sources.find((s) => s.id === tv.data.activeId);
        if (!client || !source || tv.route.view !== 'home') return;
        const seen = attempted.current.get(client) ?? new Set<string>();
        attempted.current.set(client, seen);
        const parents = [...tv.home, ...tv.data.favorites];
        const missing = continueWatching(tv.data)
            .map((p) => p.item)
            .filter((item) => {
                if (
                    item.kind !== 'episode' ||
                    !item.parentId ||
                    !item.seriesTitle ||
                    seriesForEpisode(item, parents) ||
                    seen.has(item.parentId)
                )
                    return false;
                seen.add(item.parentId);
                return true;
            });
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 15000);
        void Promise.all(
            missing.map(async (episode) => {
                try {
                    const parent = await findParentSeries(
                        client,
                        source,
                        episode,
                        abort.signal
                    );
                    if (parent) seen.delete(episode.parentId!);
                    if (parent && !abort.signal.aborted)
                        await tv.update((data) =>
                            abort.signal.aborted || data.activeId !== source.id
                                ? data
                                : recoverSeriesContext(data, [parent])
                        );
                } catch {
                    /* Home remains usable; Details provides an explicit retry. */
                } finally {
                    if (abort.signal.aborted) seen.delete(episode.parentId!);
                }
            })
        ).finally(() => clearTimeout(timer));
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [tv.guideClient, tv.data.activeId, tv.route.view]);
}
