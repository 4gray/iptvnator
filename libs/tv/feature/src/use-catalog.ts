import { useEffect, useRef, useState } from 'preact/hooks';
import {
    Catalog,
    CatalogSort,
    ProviderClient,
    LatestRequest,
} from '@iptvnator/tv/util';
import { Route } from './navigation';
const empty = (): Catalog => ({ items: [], total: 0, page: 0, categories: [] });
/** One active query survives detail navigation; a new query cancels its append lane. */
export function useCatalog(
    route: Route,
    provider: { current?: ProviderClient },
    ready: number,
    source: string,
    finishFocus: () => void,
    sort: CatalogSort,
    reportConnection: (message: string) => void = () => undefined
) {
    const active = ['movies', 'series', 'search', 'live'].includes(route.view);
    const key = JSON.stringify([
        source,
        route.kind,
        route.category,
        route.query,
        sort,
        ready,
    ]);
    const [state, setState] = useState({
        key: '',
        catalog: empty(),
        busy: false,
        error: '',
        more: false,
    });
    const lane = useRef(new LatestRequest());
    const snapshot = useRef(state);
    snapshot.current = state;
    const request = useRef(false);
    const latest = useRef({
        key,
        route,
        provider,
        ready,
        active,
        finishFocus,
        sort,
        reportConnection,
    });
    latest.current = {
        key,
        route,
        provider,
        ready,
        active,
        finishFocus,
        sort,
        reportConnection,
    };
    async function load(append: boolean) {
        const current = latest.current;
        if (
            !current.active ||
            !current.ready ||
            !current.provider.current ||
            request.current
        )
            return;
        const previous = snapshot.current;
        const page =
            append && previous.key === current.key
                ? previous.catalog.page + 1
                : 0;
        const job = lane.current.start();
        request.current = true;
        setState((s) => ({ ...s, busy: true, error: '' }));
        try {
            const result = await current.provider.current.catalog(
                current.route.kind,
                current.route.category,
                page,
                current.route.query,
                job.signal,
                current.sort
            );
            if (!lane.current.owns(job) || current.key !== latest.current.key)
                return;
            const items = page ? [...previous.catalog.items] : [];
            const seen = new Set(items.map((x) => x.id));
            result.items.forEach((item) => {
                if (!seen.has(item.id)) {
                    seen.add(item.id);
                    items.push(item);
                }
            });
            const progressed =
                page === 0 || items.length > previous.catalog.items.length;
            const next = {
                key: current.key,
                catalog: { ...result, items },
                busy: false,
                error: '',
                more:
                    progressed &&
                    result.items.length > 0 &&
                    (page + 1) * (result.pageSize || 60) < result.total,
            };
            snapshot.current = next;
            setState(next);
            current.reportConnection('');
            if (!page) current.finishFocus();
        } catch {
            if (lane.current.owns(job)) {
                if (!append)
                    current.reportConnection(
                        'Could not load titles. Check the connection and retry.'
                    );
                setState((s) => ({
                    ...s,
                    busy: false,
                    error: 'Could not load titles. Check the connection and retry.',
                }));
            }
        } finally {
            if (lane.current.owns(job)) request.current = false;
        }
    }
    useEffect(() => {
        lane.current.cancel();
        request.current = false;
        if (!active || !ready) return;
        if (
            snapshot.current.key === key &&
            snapshot.current.catalog.items.length
        ) {
            setState((s) => ({ ...s, busy: false }));
            finishFocus();
            return;
        }
        const initial = {
            key,
            catalog: empty(),
            busy: true,
            error: '',
            more: false,
        };
        snapshot.current = initial;
        setState(initial);
        const timer = setTimeout(() => void load(false), route.query ? 180 : 0);
        return () => {
            clearTimeout(timer);
            lane.current.cancel();
            request.current = false;
        };
    }, [key, active]);
    return {
        catalog: state.key === key ? state.catalog : empty(),
        catalogBusy: active && state.busy,
        catalogError: state.key === key ? state.error : '',
        hasMore: state.key === key && state.more,
        loadMore: () => void load(snapshot.current.catalog.items.length > 0),
        catalogKey: key,
    };
}
