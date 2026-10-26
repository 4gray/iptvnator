import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { findParentSeries } from '@iptvnator/tv/data-access';
import {
    LatestRequest,
    Media,
    recoverSeriesContext,
    seriesForEpisode,
} from '@iptvnator/tv/util';
import { focusKey, restoreFocus } from '@iptvnator/tv/ui';
import type { TvModel } from './use-tv';

export function useSeriesDetails(tv: TvModel) {
    const lane = useRef(new LatestRequest());
    const [busy, setBusy] = useState(false);
    useLayoutEffect(() => {
        setBusy(false);
        return () => lane.current.cancel();
    }, [tv.guideClient, tv.data.activeId, tv.route]);
    async function open(episode: Media) {
        if (episode.sourceId !== tv.data.activeId || episode.kind !== 'episode')
            return;
        const job = lane.current.start();
        const origin = {
            focus: tv.fullscreen ? episode.id : focusKey(),
            scroll: document.querySelector('main')?.scrollTop ?? 0,
        };
        const report = () =>
            tv.setError(
                'Could not find the series details. You can still continue this episode.',
                () => void open(episode),
                'Retry series details'
            );
        const timer = setTimeout(() => {
            if (lane.current.owns(job)) {
                lane.current.cancel();
                setBusy(false);
                report();
            }
        }, 15000);
        setBusy(true);
        try {
            const source = tv.data.sources.find(
                (s) => s.id === episode.sourceId
            );
            let parent = seriesForEpisode(episode, [
                ...tv.home,
                ...tv.data.favorites,
                ...(tv.selected ? [tv.selected] : []),
            ]);
            if (!parent && tv.guideClient && source)
                parent = await findParentSeries(
                    tv.guideClient,
                    source,
                    episode,
                    job.signal
                );
            if (!lane.current.owns(job)) return;
            if (!parent) throw new Error('Parent unavailable');
            const selected = parent;
            if (tv.fullscreen) tv.stop();
            await tv.update((data) =>
                job.signal.aborted
                    ? data
                    : recoverSeriesContext(data, [selected])
            );
            if (!lane.current.owns(job)) return;
            tv.setError('');
            if (tv.route.view === 'detail' && tv.route.item?.id === parent.id)
                restoreFocus(episode.id, 'detail-play');
            else tv.open(parent, origin);
        } catch {
            if (lane.current.owns(job)) report();
        } finally {
            clearTimeout(timer);
            if (lane.current.owns(job)) setBusy(false);
        }
    }
    return { open, busy };
}
