/**
 * G5: default captures keep enrichment off. The explicit cinematic preset
 * accepts only its fixed invalid fixture key and pre-seeded synthetic cache.
 */

import type { Page } from '@playwright/test';
import { SYNTHETIC_METADATA_KEY } from './capture-cinematic-cache';

export function validCaptureMetadataSettings(
    tmdb: { enabled?: boolean; apiKey?: string } | null,
    cinematic = false
): boolean {
    return cinematic
        ? tmdb?.enabled === true && tmdb.apiKey === SYNTHETIC_METADATA_KEY
        : !tmdb?.enabled && !tmdb?.apiKey;
}

/**
 * G5: settings live in the renderer's IndexedDB (ngx-pwa StorageMap). A
 * fresh profile has no entry, which means the TMDB defaults (disabled,
 * empty key) apply. The cinematic preset subsequently seeds its local cache
 * and fixed invalid key; every shot must still pass the selected policy.
 */
export async function assertCaptureMetadata(page: Page, cinematic = false): Promise<void> {
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
        validCaptureMetadataSettings(tmdb, cinematic),
        'G5 failed: unexpected metadata settings in the capture profile'
    );
}

function assertSync(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}
