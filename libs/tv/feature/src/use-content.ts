import { useEffect, useRef, useState } from 'preact/hooks';
import {
    Catalog,
    Kind,
    LatestRequest,
    Media,
    Program,
    ProviderClient,
} from '@iptvnator/tv/util';
import { restoreFocus } from '@iptvnator/tv/ui';
import type { Route } from './navigation';
const emptyCatalog = (): Catalog => ({
    items: [],
    total: 0,
    page: 0,
    categories: [],
});
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
    pendingScroll: { current?: number }
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
    const [catalogState, setCatalogState] = useState({
        key: '',
        value: emptyCatalog(),
    });
    const catalog =
        catalogState.key === key ? catalogState.value : emptyCatalog();
    const setCatalog = (value: Catalog) => setCatalogState({ key, value });
    const [homeState, setHomeState] = useState<{ key: string; value: Media[] }>(
        { key: '', value: [] }
    );
    const home = homeState.key === key ? homeState.value : [];
    const setHome = (value: Media[]) => setHomeState({ key, value });
    const [episodes, setEpisodes] = useState<Media[]>([]);
    const [epg, setEpg] = useState<Program[]>([]);
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
    useEffect(() => {
        const client = provider.current;
        const lane = browse.current;
        const job = lane.start();
        setCatalog(emptyCatalog());
        setEpisodes([]);
        if (
            !ready ||
            !client ||
            ['sources', 'settings', 'favorites'].includes(route.view)
        ) {
            setBusy(false);
            finishFocus();
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
                if (lane.owns(job))
                    setHome([...lists[0], ...lists[1], ...lists[2]]);
            } else if (route.view === 'detail' && route.item) {
                const detail = await client.details(route.item, job.signal);
                if (lane.owns(job)) setSelected(detail);
                if (detail.kind === 'series') {
                    const items = await client.episodes(detail, job.signal);
                    if (lane.owns(job)) setEpisodes(items);
                }
            } else {
                const result = await client.catalog(
                    route.kind,
                    route.category,
                    route.page,
                    route.query,
                    job.signal
                );
                if (lane.owns(job)) setCatalog(result);
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
    return { catalog, home, episodes, epg, epgError, busy };
}
