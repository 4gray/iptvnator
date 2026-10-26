import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
    Kind,
    CatalogSortPreferences,
    LatestRequest,
    Media,
    Program,
    ProviderClient,
} from '@iptvnator/tv/util';
import { restoreFocus } from '@iptvnator/tv/ui';
import type { Route } from './navigation';
import { useCatalog } from './use-catalog';
export function useContent(
    route: Route,
    provider: { current?: ProviderClient },
    ready: number,
    selected: Media | undefined,
    setSelected: (m: Media) => void,
    epgEnabled: boolean,
    setError: (s: string) => void,
    pendingFocus: { current: string },
    sourceId: string,
    pendingScroll: { current?: number },
    sorts: CatalogSortPreferences
) {
    const key = JSON.stringify([
        sourceId,
        route.view,
        route.kind,
        route.category,
        route.page,
        route.query,
        route.item?.id,
        ready,
    ]);
    const [homeState, setHomeState] = useState<{ key: string; value: Media[] }>(
        { key: '', value: [] }
    );
    const home = homeState.key === key ? homeState.value : [];
    const setHome = (value: Media[]) => setHomeState({ key, value });
    const [episodes, setEpisodes] = useState<Media[]>([]);
    const [guideState, setGuideState] = useState<{
        id?: string;
        programs: Program[];
    }>({ programs: [] });
    const epg = guideState.id === selected?.id ? guideState.programs : [];
    const setEpg = (programs: Program[]) =>
        setGuideState({ id: selected?.id, programs });
    const [epgError, setEpgError] = useState('');
    const [busy, setBusy] = useState(false);
    const browse = useRef(new LatestRequest());
    const guide = useRef(new LatestRequest());
    const finishFocus = () => {
        if (!pendingFocus.current) return;
        restoreFocus(
            pendingFocus.current,
            'first-content',
            pendingScroll.current
        );
        pendingFocus.current = '';
        pendingScroll.current = undefined;
    };
    const report = () =>
        setError(
            'The request failed. Check your source and backend, then retry.'
        );
    useLayoutEffect(() => {
        const client = provider.current;
        const lane = browse.current;
        const job = lane.start();
        setEpisodes([]);
        if (
            !ready ||
            !client ||
            !['home', 'detail'].includes(route.view) ||
            (route.view === 'detail' && route.item?.sourceId !== sourceId)
        ) {
            setBusy(false);
            if (route.view === 'favorites') finishFocus();
            return;
        }
        setBusy(true);
        const load = async () => {
            if (route.view === 'home') {
                let failed = 0;
                const lists = await Promise.all(
                    (['movie', 'series', 'live'] as Kind[]).map((kind) =>
                        client
                            .catalog(kind, '', 0, '', job.signal)
                            .then((c) => c.items.slice(0, 12))
                            .catch(() => {
                                failed++;
                                return [];
                            })
                    )
                );
                if (failed === 3) throw new Error('Catalog unavailable');
                if (lane.owns(job)) {
                    const items = [...lists[0], ...lists[1], ...lists[2]];
                    setHome(items);
                    // Catalog rows often have only posters. Fill the featured
                    // title's actual provider backdrop without holding the page.
                    const hero = items.find((item) => item.kind === 'movie');
                    if (hero)
                        void client
                            .details(hero, job.signal)
                            .then((detail) => {
                                if (lane.owns(job))
                                    setHome(
                                        items.map((item) =>
                                            item.id === detail.id
                                                ? detail
                                                : item
                                        )
                                    );
                            })
                            .catch(() => undefined);
                }
            } else if (route.view === 'detail' && route.item) {
                const detail = await client.details(route.item, job.signal);
                if (lane.owns(job)) setSelected(detail);
                if (detail.kind === 'series') {
                    const items = await client.episodes(detail, job.signal);
                    if (lane.owns(job)) setEpisodes(items);
                }
            }
        };
        const timer = setTimeout(
            () => {
                void load()
                    .then(() => {
                        if (lane.owns(job)) setError('');
                    })
                    .catch(() => {
                        if (lane.owns(job)) report();
                    })
                    .finally(() => {
                        if (lane.owns(job)) {
                            setBusy(false);
                            finishFocus();
                        }
                    });
            },
            route.query ? 180 : 0
        );
        return () => {
            clearTimeout(timer);
            lane.cancel();
        };
    }, [
        route.view,
        route.kind,
        route.category,
        route.page,
        route.query,
        route.item?.id,
        ready,
        sourceId,
    ]);
    useEffect(() => {
        const lane = guide.current;
        const job = lane.start();
        setEpg([]);
        setEpgError('');
        if (!epgEnabled || selected?.kind !== 'live' || !provider.current)
            return;
        const client = provider.current;
        const timer = setTimeout(() => {
            void client
                .epg(selected, job.signal)
                .then((programs) => {
                    if (lane.owns(job)) setEpg(programs);
                })
                .catch(() => {
                    if (lane.owns(job))
                        setEpgError(
                            'Programme information is unavailable. Playback remains available.'
                        );
                });
        }, 180);
        return () => {
            clearTimeout(timer);
            lane.cancel();
        };
    }, [selected?.id, epgEnabled, ready]);
    const catalog = useCatalog(
        route,
        provider,
        ready,
        sourceId,
        finishFocus,
        route.kind === 'movie' || route.kind === 'series'
            ? sorts[route.kind]
            : 'provider',
        setError
    );
    return {
        ...catalog,
        finishFocus,
        cancelBrowse: () => browse.current.cancel(),
        home,
        episodes,
        epg,
        epgError,
        busy: busy || catalog.catalogBusy,
    };
}
