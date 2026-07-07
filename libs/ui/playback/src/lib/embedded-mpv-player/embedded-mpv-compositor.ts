import { EmbeddedMpvBounds } from '@iptvnator/shared/interfaces';

/**
 * Measure the host's viewport rect as native-surface bounds.
 *
 * The immersive overlay is always full-bleed: the native MPV surface composites
 * BELOW the WebContents, so the inline controls float over the video and dialogs
 * render above it (dimming via their own backdrop). There is no docking — the
 * surface simply follows the host viewport — so this single measurement is the
 * whole bounds provider (the session controller uses it as its default).
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
