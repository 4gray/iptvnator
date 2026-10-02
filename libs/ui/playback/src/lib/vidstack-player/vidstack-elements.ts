let playerElements: Promise<unknown> | null = null;
let layoutElements: Promise<unknown> | null = null;

/**
 * Registers the Vidstack custom elements on first use: `media-player` and
 * `media-provider` always, plus the default video layout and the UI elements
 * it renders when the layout is shown. Loading on demand keeps the Vidstack
 * runtime out of every module graph that merely references the player. A
 * failed chunk load is retried by the next player.
 */
export function loadVidstackElements(defaultLayout: boolean): Promise<void> {
    playerElements ??= import('vidstack/player').catch((error: unknown) => {
        playerElements = null;
        throw error;
    });
    if (!defaultLayout) {
        return playerElements.then(() => undefined);
    }
    layoutElements ??= Promise.all([
        import('vidstack/player/layouts/default'),
        import('vidstack/player/ui'),
    ]).catch((error: unknown) => {
        layoutElements = null;
        throw error;
    });
    return Promise.all([playerElements, layoutElements]).then(() => undefined);
}
