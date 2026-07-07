import { EmbeddedMpvBounds } from '@iptvnator/shared/interfaces';

/**
 * Measure the host's viewport rect as native-surface bounds.
 *
 * The native MPV surface composites over the WebContents and simply follows
 * the host viewport, so this single measurement is the default bounds
 * provider of the session controller. Hosts can override the provider (via
 * `setBoundsProvider`) when they need to inset or hide the surface.
 */
export function measureBounds(host: HTMLElement): EmbeddedMpvBounds {
    const rect = host.getBoundingClientRect();
    return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
    };
}
