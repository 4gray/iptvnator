import { EmbeddedMpvBounds } from '@iptvnator/shared/interfaces';
import { measureBounds } from './embedded-mpv-format.utils';

/** Pure intersection expressed in window-local drawing insets. */
export function clipBoundsToViewport(
    bounds: EmbeddedMpvBounds,
    viewport: { left: number; top: number; right: number; bottom: number }
): EmbeddedMpvBounds {
    const clamp = (value: number, max: number) =>
        Math.min(max, Math.max(0, value));
    return {
        ...bounds,
        clipInsetLeft: clamp(viewport.left - bounds.x, bounds.width),
        clipInsetTop: clamp(viewport.top - bounds.y, bounds.height),
        clipInsetRight: clamp(
            bounds.x + bounds.width - viewport.right,
            bounds.width
        ),
        clipInsetBottom: clamp(
            bounds.y + bounds.height - viewport.bottom,
            bounds.height
        ),
    };
}

/** Native child windows do not inherit CSS overflow clipping from their ancestors. */
export function measureNativeViewport(host: HTMLElement): EmbeddedMpvBounds {
    const viewport = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
    };
    for (
        let parent =
            host === document.fullscreenElement ? null : host.parentElement;
        parent;
        parent = parent.parentElement
    ) {
        const style = getComputedStyle(parent);
        const clips = (overflow: string) =>
            /^(auto|scroll|hidden|clip)$/.test(overflow);
        const rect = parent.getBoundingClientRect();
        if (clips(style.overflowX)) {
            viewport.left = Math.max(
                viewport.left,
                rect.left + parent.clientLeft
            );
            viewport.right = Math.min(
                viewport.right,
                rect.left + parent.clientLeft + parent.clientWidth
            );
        }
        if (clips(style.overflowY)) {
            viewport.top = Math.max(viewport.top, rect.top + parent.clientTop);
            viewport.bottom = Math.min(
                viewport.bottom,
                rect.top + parent.clientTop + parent.clientHeight
            );
        }
        // Fullscreen promotes this subtree outside its former scroll ancestors.
        if (parent === document.fullscreenElement) break;
    }
    return clipBoundsToViewport(measureBounds(host), viewport);
}
