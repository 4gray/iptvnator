import { useRef } from 'preact/hooks';
import { focusKey, restoreFocus } from '@iptvnator/tv/ui';
import type { Route } from './navigation';

export interface NavigationOrigin {
    focus: string;
    scroll: number;
}
export function navigationOrigin(focus = focusKey()): NavigationOrigin {
    return { focus, scroll: document.querySelector('main')?.scrollTop ?? 0 };
}
/** Shared origin for detail/person navigation, including remote focus and scroll. */
export function useRouteHistory(route: Route, setRoute: (next: Route) => void) {
    const stack = useRef<{ route: Route; focus: string; scroll: number }[]>([]);
    const current = useRef(route);
    current.current = route;
    function visit(next: Route, focus: string, origin?: NavigationOrigin) {
        stack.current.push({
            route,
            ...(origin ?? navigationOrigin()),
        });
        setRoute(next);
        restoreFocus(focus, '', 0, () => current.current === next);
    }
    return { stack, visit };
}
