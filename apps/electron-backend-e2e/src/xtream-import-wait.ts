import type { Page } from '@playwright/test';

/** Content types an Xtream import persists, in the app's status keys. */
export const XTREAM_IMPORT_TYPES = ['live', 'movie', 'series'] as const;

export type XtreamImportType = (typeof XTREAM_IMPORT_TYPES)[number];

/** What the database holds for one content type of a portal. */
export interface XtreamImportTypeState {
    /** `xtream-import-status:<playlistId>:<type>` in `app_state`. */
    readonly status: string | null;
    readonly hasCategories: boolean;
    readonly hasContent: boolean;
}

export type XtreamImportState = Record<XtreamImportType, XtreamImportTypeState>;

const XTREAM_ROUTE_PLAYLIST_ID = /\/workspace\/xtreams\/([^/?#]+)/;
/** Category types use the plural `movies`; content and status use `movie`. */
const CATEGORY_TYPE: Record<XtreamImportType, string> = {
    live: 'live',
    movie: 'movies',
    series: 'series',
};
const POLL_MS = 100;
const DEFAULT_TIMEOUT_MS = 60_000;

/** The portal id of an `/workspace/xtreams/<id>/…` URL, or null. */
export function xtreamPlaylistIdFromUrl(url: string): string | null {
    const match = XTREAM_ROUTE_PLAYLIST_ID.exec(url);
    return match ? decodeURIComponent(match[1]) : null;
}

/** Status, category and content presence of every type, read through the bridge. */
export async function readXtreamImportState(
    page: Page,
    playlistId: string
): Promise<XtreamImportState> {
    return page.evaluate(
        async ({ id, types, categoryType }) => {
            const entries = await Promise.all(
                types.map(async (type) => [
                    type,
                    {
                        status: await window.electron.dbGetAppState(
                            `xtream-import-status:${id}:${type}`
                        ),
                        hasCategories: await window.electron.dbHasCategories(
                            id,
                            categoryType[type]
                        ),
                        hasContent: await window.electron.dbHasContent(
                            id,
                            type
                        ),
                    },
                ])
            );
            return Object.fromEntries(entries);
        },
        {
            id: playlistId,
            types: [...XTREAM_IMPORT_TYPES],
            categoryType: CATEGORY_TYPE,
        }
    ) as Promise<XtreamImportState>;
}

/**
 * Whether the portal's catalog is complete, judged the way the app judges it
 * on its next start: it reuses a type only when the status reads `completed`
 * and rows exist. A type without categories is empty on the portal (a
 * live-only panel), so its status alone counts; but a portal without any
 * category has not been imported yet, or a refresh has just deleted it. The
 * status alone is not enough either: a refresh deletes the catalog and
 * re-imports it without resetting the status.
 */
export function isXtreamImportComplete(state: XtreamImportState): boolean {
    const types = XTREAM_IMPORT_TYPES.map((type) => state[type]);
    return (
        types.some(({ hasCategories }) => hasCategories) &&
        types.every(
            ({ status, hasCategories, hasContent }) =>
                status === 'completed' && (hasContent || !hasCategories)
        )
    );
}

/**
 * Waits until the portal's catalog is complete (`isXtreamImportComplete`).
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
    let state = await readXtreamImportState(page, playlistId);
    while (!isXtreamImportComplete(state)) {
        if (Date.now() >= deadline) {
            throw new Error(
                `xtream-import-not-completed: ${JSON.stringify(state)}`
            );
        }
        await page.waitForTimeout(POLL_MS);
        state = await readXtreamImportState(page, playlistId);
    }
}
