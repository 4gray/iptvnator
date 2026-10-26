import { useRef } from 'preact/hooks';
import { focusKey, restoreFocus } from '@iptvnator/tv/ui';
import type { Route } from './navigation';

export interface NavigationOrigin {
    focus: string;
    scroll: number;
}
/** Shared origin for detail/person navigation, including remote focus and scroll. */
export function useRouteHistory(route: Route, setRoute: (next: Route) => void) {
    const stack = useRef<{ route: Route; focus: string; scroll: number }[]>([]);
    function visit(next: Route, focus: string, origin?: NavigationOrigin) {
        stack.current.push({
            route,
            focus: origin?.focus ?? focusKey(),
            scroll:
                origin?.scroll ??
                document.querySelector('main')?.scrollTop ??
                0,
        });
        setRoute(next);
        restoreFocus(focus, '', 0);
    }
    return { stack, visit };
}
