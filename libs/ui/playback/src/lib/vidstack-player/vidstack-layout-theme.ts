/**
 * Output name of the non-injected `vidstack-theme` style bundle declared in
 * apps/web/project.json, resolved against the document base URL. Angular
 * never hashes `inject: false` bundles, even with `outputHashing: "all"`, so
 * the name is stable in every build configuration.
 */
export const VIDSTACK_LAYOUT_THEME_HREF = 'vidstack-theme.css';

const pendingThemes = new WeakMap<Document, Promise<void>>();

/**
 * Adds the Vidstack default-layout theme to the document once and resolves
 * when it is usable. The theme is ~85 kB of vendor CSS that only the
 * preference-off layout needs, so it stays out of the component styles and
 * the initial bundle. A failed load resolves too, so the layout never stays
 * hidden, but it is forgotten: the next player tries the stylesheet again.
 */
export function loadVidstackLayoutTheme(doc: Document): Promise<void> {
    const pending = pendingThemes.get(doc);
    if (pending) {
        return pending;
    }

    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = VIDSTACK_LAYOUT_THEME_HREF;
    link.dataset['vidstackTheme'] = '';
    const loaded = new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener(
            'error',
            () => {
                link.remove();
                if (pendingThemes.get(doc) === loaded) {
                    pendingThemes.delete(doc);
                }
                resolve();
            },
            { once: true }
        );
    });
    pendingThemes.set(doc, loaded);
    doc.head.append(link);
    return loaded;
}
