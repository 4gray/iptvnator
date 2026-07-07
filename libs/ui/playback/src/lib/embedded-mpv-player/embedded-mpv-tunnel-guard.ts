/**
 * Dev-only diagnostic for the immersive embedded-MPV "tunnel".
 *
 * The native video composites BELOW the WebContents, so EVERY element stacked
 * over the hole rect must have a non-opaque background — one opaque plate
 * (e.g. a route wrapper's `background: #000` player bed) silently covers the
 * video. This guard samples `document.elementsFromPoint()` at the hole center
 * and warns about any element whose computed background-color is fully opaque,
 * so regressions surface in the dev console instead of as a "black player".
 *
 * Pure DOM helpers — {@link EmbeddedMpvImmersiveService} owns the dev-mode
 * gating and throttling.
 */

/** Viewport rect of the tunnel hole (native video rect). */
export interface TunnelGuardRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * True when a computed `background-color` is fully opaque (alpha === 1 and not
 * `transparent`). Computed values are `rgb(...)` or `rgba(...)`.
 */
export function isOpaqueBackgroundColor(color: string): boolean {
    const match = /^rgba?\((\s*[\d.]+\s*,){2}\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
        color.trim()
    );
    if (!match) {
        return false;
    }
    const alpha = match[2];
    return alpha === undefined || parseFloat(alpha) >= 1;
}

/**
 * Elements stacked at the hole's center point whose computed background-color
 * is opaque — i.e. plates that would cover the native video. Empty when the
 * tunnel is clean or `elementsFromPoint` is unavailable (jsdom).
 */
export function findOpaqueTunnelCovers(
    rect: TunnelGuardRect,
    doc: Document = document
): Element[] {
    if (typeof doc.elementsFromPoint !== 'function') {
        return [];
    }
    const win = doc.defaultView ?? window;
    const stack = doc.elementsFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2
    );
    return stack.filter((element) =>
        isOpaqueBackgroundColor(win.getComputedStyle(element).backgroundColor)
    );
}

/** `console.warn` about opaque covers over the tunnel; silent when clean. */
export function warnOnOpaqueTunnelCovers(
    rect: TunnelGuardRect,
    doc: Document = document,
    warn: (...args: unknown[]) => void = console.warn
): void {
    const covers = findOpaqueTunnelCovers(rect, doc);
    if (covers.length === 0) {
        return;
    }
    warn(
        '[embedded-mpv] Opaque element(s) cover the immersive tunnel — the ' +
            'native video is hidden behind them. Clear their background while ' +
            '`body.embedded-mpv-immersive` is active (see styles.scss):',
        covers.map(describeElement)
    );
}

function describeElement(element: Element): string {
    const id = element.id ? `#${element.id}` : '';
    const classes =
        element.className && typeof element.className === 'string'
            ? `.${element.className.trim().split(/\s+/).join('.')}`
            : '';
    return `${element.tagName.toLowerCase()}${id}${classes}`;
}
