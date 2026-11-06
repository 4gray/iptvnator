import type { ElectronApplication } from '@playwright/test';

/**
 * The mock's generated catalogs point channel, category, poster and cover
 * artwork at picsum.photos. Journeys that render that artwork (J3, J4)
 * cancel those requests in the main process, so no request of the journey
 * leaves the machine and an image never loads, or fails, at a different
 * moment on a runner with a different network. Contract:
 * docs/architecture/performance-journeys.md.
 */
const EXTERNAL_ARTWORK_STATE_KEY = '__iptvnatorJourneyExternalArtwork';
const EXTERNAL_ARTWORK_URLS = ['*://picsum.photos/*', '*://*.picsum.photos/*'];

export async function blockJourneyExternalArtwork(
    electronApp: ElectronApplication
): Promise<void> {
    await electronApp.evaluate(
        ({ session }, input) => {
            const target = globalThis as unknown as Record<string, unknown>;
            if (target[input.key] !== undefined) {
                throw new Error('journey-artwork-block-installed');
            }
            const state = { cancelled: 0 };
            target[input.key] = state;
            // The app registers no onBeforeRequest listener of its own
            // (only onBeforeSendHeaders), so this replaces nothing.
            session.defaultSession.webRequest.onBeforeRequest(
                { urls: input.urls },
                (_details, callback) => {
                    state.cancelled += 1;
                    callback({ cancel: true });
                }
            );
        },
        { key: EXTERNAL_ARTWORK_STATE_KEY, urls: EXTERNAL_ARTWORK_URLS }
    );
}

export async function readJourneyExternalArtworkCancelled(
    electronApp: ElectronApplication
): Promise<number> {
    return electronApp.evaluate(
        (_electron, key) =>
            (
                (globalThis as unknown as Record<string, unknown>)[key] as {
                    cancelled: number;
                }
            ).cancelled,
        EXTERNAL_ARTWORK_STATE_KEY
    );
}
