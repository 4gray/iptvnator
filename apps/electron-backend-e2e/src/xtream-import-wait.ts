import type { Page } from '@playwright/test';

/** Content types an Xtream import persists, in the app's status keys. */
export const XTREAM_IMPORT_TYPES = ['live', 'movie', 'series'] as const;

export type XtreamImportType = (typeof XTREAM_IMPORT_TYPES)[number];
export type XtreamImportStatuses = Record<XtreamImportType, string | null>;

const XTREAM_ROUTE_PLAYLIST_ID = /\/workspace\/xtreams\/([^/?#]+)/;
const POLL_MS = 100;
const DEFAULT_TIMEOUT_MS = 60_000;

/** The portal id of an `/workspace/xtreams/<id>/…` URL, or null. */
export function xtreamPlaylistIdFromUrl(url: string): string | null {
    const match = XTREAM_ROUTE_PLAYLIST_ID.exec(url);
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The per-type import status the app persists in `app_state`
 * (`xtream-import-status:<playlistId>:<type>`). It is what the next launch
 * reads to decide whether a type still has to be imported.
 */
export async function readXtreamImportStatuses(
    page: Page,
    playlistId: string
): Promise<XtreamImportStatuses> {
    return page.evaluate(
        async ({ id, types }) => {
            const entries = await Promise.all(
                types.map(async (type) => [
                    type,
                    await window.electron.dbGetAppState(
                        `xtream-import-status:${id}:${type}`
                    ),
                ])
            );
            return Object.fromEntries(entries);
        },
        { id: playlistId, types: [...XTREAM_IMPORT_TYPES] }
    ) as Promise<XtreamImportStatuses>;
}

/** Whether every content type of the portal has finished importing. */
export function isXtreamImportComplete(
    statuses: XtreamImportStatuses
): boolean {
    return XTREAM_IMPORT_TYPES.every((type) => statuses[type] === 'completed');
}

/**
 * Waits until the import has recorded every content type as completed.
 *
 * The loading overlay alone cannot prove that: it appears only once the
 * portal has answered the account check and the import session starts. When
 * that answer takes longer than the caller waits for the overlay (a mock
 * generating a large catalog on its first request does), a check for "no
 * overlay" passes before anything was imported, and closing the app then
 * interrupts the import. A `cancelled` or `failed` status does not end the
 * wait: the app writes no status when a retry starts, so it may be left over
 * from an earlier attempt that is being retried now.
 */
export async function waitForXtreamImportCompleted(
    page: Page,
    playlistId: string,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let statuses = await readXtreamImportStatuses(page, playlistId);
    while (!isXtreamImportComplete(statuses)) {
        if (Date.now() >= deadline) {
            throw new Error(
                `xtream-import-not-completed: ${JSON.stringify(statuses)}`
            );
        }
        await page.waitForTimeout(POLL_MS);
        statuses = await readXtreamImportStatuses(page, playlistId);
    }
}
