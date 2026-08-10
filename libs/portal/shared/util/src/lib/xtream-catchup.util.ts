/**
 * Provider catch-up (archive/timeshift) availability for Xtream live streams.
 *
 * The gate mirrors the playback-side checks in `live-stream-layout`
 * (`archivePlaybackAvailable`) and `unified-live-tab`
 * (`timelineArchiveAvailable`): the provider must flag the channel with
 * `tv_archive === 1` AND expose a positive archive window. A bare flag with a
 * zero-day window is not playable through the catch-up URL builder, so it
 * must not be advertised as available.
 */
export interface XtreamCatchupFields {
    readonly tv_archive?: number | string | null;
    readonly tv_archive_duration?: number | string | null;
}

/**
 * Catch-up window in days, `0` when absent or unparsable. Xtream panels
 * report `tv_archive_duration` in days; some send it as a string.
 */
export function getXtreamCatchupDays(
    item: XtreamCatchupFields | null | undefined
): number {
    return Math.max(0, Number(item?.tv_archive_duration ?? 0) || 0);
}

/** Whether the provider declares playable catch-up for this channel. */
export function isXtreamCatchupAvailable(
    item: XtreamCatchupFields | null | undefined
): boolean {
    return (
        Number(item?.tv_archive ?? 0) === 1 && getXtreamCatchupDays(item) > 0
    );
}
