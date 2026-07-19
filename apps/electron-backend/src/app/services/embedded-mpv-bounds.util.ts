import { EmbeddedMpvBounds } from '@iptvnator/shared/interfaces';

export interface NativeViewBoundsContext {
    platform: NodeJS.Platform;
    /** Page zoom factor of the main window's webContents (1 = 100%). */
    zoomFactor: number;
    /** Scale factor of the display hosting the main window (1 = 96 dpi). */
    displayScaleFactor: number;
}

/**
 * Converts renderer-measured bounds (CSS pixels from
 * getBoundingClientRect()) into the coordinate space the native-view
 * engines position their OS windows in: physical pixels for the win32
 * child HWND (SetWindowPos) and the linux child X11 window
 * (XMoveResizeWindow), points — device-independent pixels — for the macOS
 * NSView (setFrame). CSS pixels match points only at 100% page zoom and
 * match physical pixels only at 100% page zoom AND 100% display scale, so
 * every platform scales by the zoom factor and win32/linux additionally by
 * the display scale factor (#1145).
 *
 * Bounds arrive with unrounded CSS edges and are rounded exactly once here,
 * after scaling: edges first, then width/height derived from them. Rounding
 * any earlier (or per-field) lets fractional CSS layouts drift by a pixel
 * per scale factor and open 1px seams between the native video window and
 * the surrounding DOM UI.
 */
export function toNativeViewBounds(
    bounds: EmbeddedMpvBounds,
    context: NativeViewBoundsContext
): EmbeddedMpvBounds {
    const scale = resolveNativeViewScale(context);
    if (scale === 1) {
        return bounds;
    }

    const left = Math.round(bounds.x * scale);
    const top = Math.round(bounds.y * scale);
    const right = Math.round((bounds.x + bounds.width) * scale);
    const bottom = Math.round((bounds.y + bounds.height) * scale);

    return {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
}

function resolveNativeViewScale(context: NativeViewBoundsContext): number {
    const zoomFactor = sanitizeFactor(context.zoomFactor);
    if (context.platform === 'darwin') {
        return zoomFactor;
    }
    return zoomFactor * sanitizeFactor(context.displayScaleFactor);
}

function sanitizeFactor(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 1;
}
