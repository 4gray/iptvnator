import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { findParentSeries } from '@iptvnator/tv/data-access';
import {
    LatestRequest,
    Media,
    recoverSeriesContext,
    seriesForEpisode,
} from '@iptvnator/tv/util';
import { restoreFocus } from '@iptvnator/tv/ui';
import { navigationOrigin, type NavigationOrigin } from './use-route-history';
import type { TvModel } from './use-tv';

export function useSeriesDetails(tv: TvModel) {
    const lane = useRef(new LatestRequest());
    const playerLookup = useRef<AbortController>();
    const retryOpen = useRef(open);
    retryOpen.current = open;
    const [busy, setBusy] = useState(false);
    useLayoutEffect(() => {
        setBusy(false);
        // Obsolete notices must not retain a retry from a previous route/source.
        if (tv.errorRetryLabel === 'Retry series details') tv.setError('');
        return () => {
            lane.current.cancel();
            playerLookup.current = undefined;
        };
    }, [tv.guideClient, tv.data.activeId, tv.route]);
    useLayoutEffect(() => {
        if (playerLookup.current && lane.current.owns(playerLookup.current)) {
            lane.current.cancel();
            playerLookup.current = undefined;
            setBusy(false);
        }
    }, [tv.fullscreen, tv.playing?.id]);
    useLayoutEffect(() => {
        // A new play request supersedes Details, including requests from Home.
        // Our own stop clears the request instead, preserving its navigation.
        if (!tv.playbackRequest) return;
        lane.current.cancel();
        playerLookup.current = undefined;
        setBusy(false);
    }, [tv.playbackRequest]);
    async function open(episode: Media, retryOrigin?: NavigationOrigin) {
        if (episode.sourceId !== tv.data.activeId || episode.kind !== 'episode')
            return;
        const job = lane.current.start();
        playerLookup.current = tv.fullscreen ? job : undefined;
        const origin =
            retryOrigin ??
            (tv.fullscreen
                ? {
                      ...tv.playbackOrigin,
                      focus: tv.playbackOrigin.focus || episode.id,
                  }
                : navigationOrigin());
        const report = () =>
            tv.setError(
                'Could not find the series details. You can still continue this episode.',
                () => void retryOpen.current(episode, origin),
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
            // Parent lookup is complete; our own stop must not cancel navigation.
            playerLookup.current = undefined;
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
            if (playerLookup.current === job) playerLookup.current = undefined;
            if (lane.current.owns(job)) setBusy(false);
        }
    }
    return { open, busy };
}
