/** The coordinates a Stalker search page was requested under. */
export interface StalkerSearchRequestKey {
    readonly search: string;
    readonly contentType: string;
    readonly page: number;
    readonly playlistId: string | null;
    /** `ParentalLockService.version` at request time. */
    readonly parentalLockVersion: number;
}

/**
 * Whether a search response may still be applied. Portal requests are not
 * aborted, so a page issued under an older state can finish after a newer
 * one; the parental lock version is part of the key because an older
 * response was filtered with the OLDER withheld set — applying it after a
 * relock would repopulate the grid with locked-category rows.
 */
export function isStalkerSearchRequestCurrent(
    requested: StalkerSearchRequestKey,
    current: StalkerSearchRequestKey
): boolean {
    return (
        requested.search === current.search &&
        requested.contentType === current.contentType &&
        requested.page === current.page &&
        requested.playlistId === current.playlistId &&
        requested.parentalLockVersion === current.parentalLockVersion
    );
}
