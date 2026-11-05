import { useLayoutEffect, useRef } from 'preact/hooks';
import { restoreFocus } from '@iptvnator/tv/ui';
import { firstRoute, type Route } from './navigation';

/** Server refresh can replace a source without going through the source picker. */
export function useSourceNavigation(
    sourceId: string,
    route: Route,
    setRoute: (route: Route) => void,
    clearHistory: () => void
) {
    const previous = useRef(sourceId);
    useLayoutEffect(() => {
        if (previous.current === sourceId) return;
        previous.current = sourceId;
        clearHistory();
        setRoute(
            route.view === 'detail' || route.view === 'person'
                ? firstRoute()
                : {
                      ...route,
                      category: '',
                      query: '',
                      page: 0,
                      item: undefined,
                  }
        );
        if (route.view === 'detail' || route.view === 'person')
            restoreFocus('nav:home');
    }, [sourceId]);
}
