/**
 * Xtream server clock helpers.
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
 * silently falling back to the viewer's local clock (issue #1562).
 */

export interface XtreamServerClockInfo {
    timezone?: string | null;
    time_now?: string | null;
    timestamp_now?: number | string | null;
}

/** Stored form for a panel whose timezone name is unusable: `UTC`, `UTC+03:00`, `UTC-03:30`. */
const FIXED_OFFSET_TIMEZONE_PATTERN = /^UTC(?:([+-])(\d{2}):(\d{2}))?$/;
const SERVER_LOCAL_DATE_TIME_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
/** Real-world UTC offsets span -12:00 … +14:00. */
const MAX_UTC_OFFSET_MINUTES = 14 * 60;
/** Offsets are multiples of 15 min; snapping absorbs second-level clock skew. */
const OFFSET_GRANULARITY_MINUTES = 15;
const MINUTE_MS = 60_000;

const timeZoneSupportCache = new Map<string, boolean>();

/**
 * Whether the runtime can format dates in the named zone. `Intl` accepts
 * IANA names and a few aliases (`UTC`, `GMT`, `Etc/GMT+3`) and throws a
 * `RangeError` for anything else (`UTC+3`, an empty string, garbage).
 */
export function isSupportedTimeZoneName(name: string): boolean {
    const cached = timeZoneSupportCache.get(name);
    if (cached !== undefined) {
        return cached;
    }
    let supported = false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: name });
        supported = true;
    } catch {
        supported = false;
    }
    timeZoneSupportCache.set(name, supported);
    return supported;
}

/** Parses the stored `UTC±HH:MM` form; `null` for anything else. */
export function parseFixedOffsetTimeZone(value: string): number | null {
    const match = FIXED_OFFSET_TIMEZONE_PATTERN.exec(value);
    if (!match) {
        return null;
    }
    if (!match[1]) {
        return 0;
    }
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '-' ? -minutes : minutes;
}

export function formatFixedOffsetTimeZone(offsetMinutes: number): string {
    if (offsetMinutes === 0) {
        return 'UTC';
    }
    const sign = offsetMinutes < 0 ? '-' : '+';
    const absolute = Math.abs(offsetMinutes);
    return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

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
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}:${pad(parts.hour)}-${pad(parts.minute)}`;
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

interface WallClockParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

function wallClockPartsAt(
    instantMs: number,
    serverTimezone: string | null | undefined
): WallClockParts {
    if (serverTimezone) {
        const fixedOffset = parseFixedOffsetTimeZone(serverTimezone);
        if (fixedOffset !== null) {
            return utcParts(new Date(instantMs + fixedOffset * MINUTE_MS));
        }
        if (isSupportedTimeZoneName(serverTimezone)) {
            return zoneParts(instantMs, serverTimezone);
        }
    }
    const date = new Date(instantMs);
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
    };
}

function zoneParts(instantMs: number, timeZone: string): WallClockParts {
    // `hourCycle: 'h23'` — the `hour12: false` spelling still yields "24"
    // for midnight in some ICU/locale combinations. The option is typed
    // from es2020.intl while the web app compiles against an es2018 lib,
    // hence the assertion; every supported runtime honours it.
    const options = {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hourCycle: 'h23',
    } as Intl.DateTimeFormatOptions;
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(
        new Date(instantMs)
    );
    const read = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value ?? 0);
    return {
        year: read('year'),
        month: read('month'),
        day: read('day'),
        hour: read('hour') % 24,
        minute: read('minute'),
        second: read('second'),
    };
}

function zoneOffsetMinutesAt(instantMs: number, timeZone: string): number {
    const parts = zoneParts(instantMs, timeZone);
    const asUtcMs = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
    );
    return Math.round((asUtcMs - instantMs) / MINUTE_MS);
}

function utcParts(date: Date): WallClockParts {
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        second: date.getUTCSeconds(),
    };
}

/** `YYYY-MM-DD HH:mm[:ss]` read as if it were UTC; `null` when malformed. */
function parseNaiveUtcMs(value: string | null | undefined): number | null {
    const match = SERVER_LOCAL_DATE_TIME_PATTERN.exec(
        String(value ?? '').trim()
    );
    if (!match) {
        return null;
    }
    const [, year, month, day, hour, minute, second = '0'] = match;
    const ms = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
    );
    return Number.isFinite(ms) ? ms : null;
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}
