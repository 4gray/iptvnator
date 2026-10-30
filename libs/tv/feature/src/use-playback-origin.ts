import { useRef } from 'preact/hooks';
import { restoreFocus } from '@iptvnator/tv/ui';
import { navigationOrigin, type NavigationOrigin } from './use-route-history';

/** Capture before asynchronous resolution; fullscreen hides the original scroll pane. */
export function usePlaybackOrigin() {
    const saved = useRef<NavigationOrigin>({ focus: '', scroll: 0 });
    return {
        get current() {
            return saved.current;
        },
        capture: navigationOrigin,
        remember: (origin: NavigationOrigin) => {
            saved.current = origin;
        },
        restore: (fallback = 'detail-play') =>
            restoreFocus(saved.current.focus, fallback, saved.current.scroll),
    };
}
