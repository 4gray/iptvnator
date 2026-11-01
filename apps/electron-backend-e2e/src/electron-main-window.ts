interface ElectronWindow {
    url(): string;
}

interface ElectronWindowSource<Window extends ElectronWindow> {
    firstWindow(): Promise<Window>;
    windows(): Window[];
    waitForEvent(
        event: 'window',
        options: { predicate: (window: Window) => boolean }
    ): Promise<Window>;
}

/** Await a renderer window without adding a fixed delay to every launch. */
export async function findMainWindow<Window extends ElectronWindow>(
    app: ElectronWindowSource<Window>
): Promise<Window> {
    await app.firstWindow();
    const isRenderer = (window: Window) =>
        !window.url().startsWith('devtools://');
    const existing = app.windows().find(isRenderer);
    if (existing) return existing;

    // No await between the snapshot and subscription: a new window cannot
    // arrive in a gap while an asynchronous title query is in flight.
    return app.waitForEvent('window', { predicate: isRenderer });
}
