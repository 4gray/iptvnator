import type { Page } from '@playwright/test';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';

export function xtreamScenarioRequiresSeed(
    scenarioId: XtreamScenarioId
): boolean {
    return (
        scenarioId === XTREAM_SCENARIO_ID.REFRESH_LARGE ||
        scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE ||
        scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI
    );
}

export function deriveXtreamMeasuredPlaylistId(
    requests: readonly { readonly playlistId: string | null }[]
): string {
    const identities = new Set(
        requests
            .map(({ playlistId }) => playlistId)
            .filter(
                (playlistId): playlistId is string =>
                    typeof playlistId === 'string' && playlistId.length > 0
            )
    );
    const playlistId = identities.values().next().value as string | undefined;
    if (identities.size !== 1 || !playlistId) {
        throw new Error('xtream-measured-playlist-identity-invalid');
    }
    return playlistId;
}

export async function disableGenericElectronFixtureProbes(
    page: Page
): Promise<void> {
    await page.evaluate(() => {
        window.__portalDebugUnsubscribe?.();
        window.__portalDebugUnsubscribe = undefined;
        window.__portalDebugEvents = [];
        window.__dbOperationUnsubscribe?.();
        window.__dbOperationUnsubscribe = undefined;
        window.__dbOperationEvents = [];
        if (window.__rendererFrameRequestId) {
            window.cancelAnimationFrame(window.__rendererFrameRequestId);
        }
        window.__rendererFrameRequestId = undefined;
        window.__rendererFrameCount = 0;
    });
}
