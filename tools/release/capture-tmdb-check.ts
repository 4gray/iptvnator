/**
 * G5: proof that TMDB enrichment stays off for the capture profile, so no
 * licensed poster or still can reach a published screenshot.
 */

import type { Page } from '@playwright/test';

/**
 * G5: settings live in the renderer's IndexedDB (ngx-pwa StorageMap). A
 * fresh profile has no entry, which means the TMDB defaults (disabled,
 * empty key) apply. Read-only assertion — if a future change flips the
 * default or seeds a key, the run stops before a licensed poster can render.
 */
export async function assertTmdbDisabled(page: Page): Promise<void> {
    const tmdb = await page.evaluate(
        () =>
            new Promise<{ enabled?: boolean; apiKey?: string } | null>(
                (resolve) => {
                    const request = indexedDB.open('ngStorage');

                    request.onerror = () => resolve(null);
                    request.onsuccess = () => {
                        const db = request.result;

                        if (!db.objectStoreNames.contains('localStorage')) {
                            resolve(null);
                            return;
                        }

                        const get = db
                            .transaction('localStorage')
                            .objectStore('localStorage')
                            .get('settings');

                        get.onerror = () => resolve(null);
                        get.onsuccess = () =>
                            resolve(
                                (get.result as { tmdb?: { enabled?: boolean; apiKey?: string } })
                                    ?.tmdb ?? null
                            );
                    };
                }
            )
    );

    assertSync(
        !tmdb?.enabled && !tmdb?.apiKey,
        `G5 failed: TMDB enrichment is active in the capture profile (${JSON.stringify(tmdb)})`
    );
}

function assertSync(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}
