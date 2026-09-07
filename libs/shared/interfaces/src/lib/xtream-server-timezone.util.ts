/**
 * Xtream server clock policy.
 *
 * An Xtream panel interprets every wall-clock string it exchanges with a
 * client in ITS OWN timezone: the `start` / `end` strings of
 * `get_simple_data_table` are `date('Y-m-d H:i:s')` output, and the
 * `{Y-m-d:H-M}` segment of a timeshift URL goes through `strtotime()` with
 * the same PHP default timezone. That timezone is reported once, in
 * `server_info` of the account-info response, as an IANA name plus the
 * server's current wall clock (`time_now`) and epoch (`timestamp_now`).
 *
 * `resolveXtreamServerTimezone` turns that report into ONE persistable
 * string — the IANA name when the runtime's ICU knows it, otherwise a fixed
 * `UTC±HH:MM` offset derived from the two clock fields — and the two
 * conversion helpers below accept either form, so a panel whose timezone
 * name the runtime cannot resolve (`UTC+3`, a typo, an unknown alias) still
 * gets its catch-up requests and EPG strings converted correctly instead of
 * silently falling back to the viewer's local clock (issue #1562). The
 * zone-agnostic primitives live in `xtream-server-clock.util.ts`.
 */

import {
    formatFixedOffsetTimeZone,
    isSupportedTimeZoneName,
    MINUTE_MS,
    padTwo,
    parseFixedOffsetTimeZone,
    parseNaiveUtcMs,
    wallClockPartsAt,
    zoneOffsetMinutesAt,
} from './xtream-server-clock.util';

export {
    formatFixedOffsetTimeZone,
    isSupportedTimeZoneName,
    parseFixedOffsetTimeZone,
} from './xtream-server-clock.util';

export interface XtreamServerClockInfo {
    timezone?: string | null;
    time_now?: string | null;
    timestamp_now?: number | string | null;
}

/** Real-world UTC offsets span -12:00 … +14:00. */
const MAX_UTC_OFFSET_MINUTES = 14 * 60;
/** Offsets are multiples of 15 min; snapping absorbs second-level clock skew. */
const OFFSET_GRANULARITY_MINUTES = 15;

/**
 * The server's UTC offset in minutes derived from its own clock report:
 * `time_now` read as a naive UTC wall clock minus `timestamp_now`. Both
 * fields are produced by the same request, so the difference IS the offset
 * (snapped to 15 minutes to absorb a second of skew). `null` when either
 * field is missing, malformed, or the result is not a real-world offset.
 */
export function deriveXtreamServerUtcOffsetMinutes(
    timeNow: string | null | undefined,
    timestampNow: number | string | null | undefined
): number | null {
    const wallClockMs = parseNaiveUtcMs(timeNow);
    const epochSeconds = Number(timestampNow);
    if (
        wallClockMs === null ||
        !Number.isFinite(epochSeconds) ||
        epochSeconds <= 0
    ) {
        return null;
    }
    const rawMinutes = (wallClockMs / 1000 - epochSeconds) / 60;
    const snapped =
        Math.round(rawMinutes / OFFSET_GRANULARITY_MINUTES) *
        OFFSET_GRANULARITY_MINUTES;
    return Math.abs(snapped) <= MAX_UTC_OFFSET_MINUTES ? snapped : null;
}

/**
 * The single persistable timezone string for a panel: its IANA name when
 * the runtime resolves it, else a fixed offset derived from the clock
 * fields, else `undefined` (nothing trustworthy was reported).
 *
 * The fixed offset is a snapshot of the panel's clock and carries no DST
 * rules: for such a panel, programmes on the far side of a DST switch are
 * off by an hour until the next account-info check refreshes the offset.
 * That is the most a panel with an unusable name gives away — Xtream Codes
 * itself reports PHP timezone identifiers, which are IANA names, so the
 * snapshot only ever serves non-standard servers, where the alternative is
 * the viewer's clock, wrong in every season.
 */
export function resolveXtreamServerTimezone(
    serverInfo: XtreamServerClockInfo | null | undefined
): string | undefined {
    const name = serverInfo?.timezone?.trim();
    if (name && isSupportedTimeZoneName(name)) {
        return name;
    }
    const offsetMinutes = deriveXtreamServerUtcOffsetMinutes(
        serverInfo?.time_now,
        serverInfo?.timestamp_now
    );
    return offsetMinutes === null
        ? undefined
        : formatFixedOffsetTimeZone(offsetMinutes);
}

/**
 * The `Y-m-d:H-M` segment of a timeshift URL for an epoch, expressed in the
 * server's clock. Accepts both stored forms; with no usable timezone the
 * viewer's local clock is the only remaining guess.
 */
export function formatXtreamCatchupStart(
    timestampSeconds: number,
    serverTimezone: string | null | undefined
): string {
    const parts = wallClockPartsAt(timestampSeconds * 1000, serverTimezone);
    return `${parts.year}-${padTwo(parts.month)}-${padTwo(parts.day)}:${padTwo(parts.hour)}-${padTwo(parts.minute)}`;
}

/**
 * Epoch seconds for a `YYYY-MM-DD HH:mm[:ss]` string that the SERVER wrote
 * in its own timezone. `null` when the string is malformed or the timezone
 * is unusable — callers keep their previous interpretation then.
 */
export function parseXtreamServerLocalDateTime(
    value: string | null | undefined,
    serverTimezone: string | null | undefined
): number | null {
    const naiveUtcMs = parseNaiveUtcMs(value);
    if (naiveUtcMs === null || !serverTimezone) {
        return null;
    }
    const fixedOffset = parseFixedOffsetTimeZone(serverTimezone);
    if (fixedOffset !== null) {
        return Math.floor((naiveUtcMs - fixedOffset * MINUTE_MS) / 1000);
    }
    if (!isSupportedTimeZoneName(serverTimezone)) {
        return null;
    }
    // The zone's offset depends on the instant (DST), which is what we are
    // solving for: take the offset at the naive guess, then re-read it at
    // the corrected instant so a string right after a DST switch lands on
    // the correct side of it.
    const firstGuessMs =
        naiveUtcMs -
        zoneOffsetMinutesAt(naiveUtcMs, serverTimezone) * MINUTE_MS;
    const resolvedMs =
        naiveUtcMs -
        zoneOffsetMinutesAt(firstGuessMs, serverTimezone) * MINUTE_MS;
    return Math.floor(resolvedMs / 1000);
}
