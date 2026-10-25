import { useRef } from 'preact/hooks';
import { focusKey, restoreFocus } from '@iptvnator/tv/ui';
import type { Route } from './navigation';

/** Shared origin for detail/person navigation, including remote focus and scroll. */
export function useRouteHistory(route: Route, setRoute: (next: Route) => void) {
    const stack = useRef<{ route: Route; focus: string; scroll: number }[]>([]);
    function visit(next: Route, focus: string) {
        stack.current.push({
            route,
            focus: focusKey(),
            scroll: document.querySelector('main')?.scrollTop ?? 0,
        });
        setRoute(next);
        restoreFocus(focus, '', 0);
    }
    return { stack, visit };
}
