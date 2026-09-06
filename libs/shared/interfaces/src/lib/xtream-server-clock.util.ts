/**
 * Wall-clock primitives behind `xtream-server-timezone.util.ts`: the two
 * stored timezone forms (an ICU-resolvable name, or a fixed `UTC±HH:MM`
 * snapshot), and the conversions between an instant and the wall clock a
 * zone shows for it. Nothing here knows about Xtream — that policy lives in
 * the timezone util.
 */

/** Stored form for a panel whose timezone name is unusable: `UTC`, `UTC+03:00`, `UTC-03:30`. */
const FIXED_OFFSET_TIMEZONE_PATTERN = /^UTC(?:([+-])(\d{2}):(\d{2}))?$/;
const SERVER_LOCAL_DATE_TIME_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
export const MINUTE_MS = 60_000;

const timeZoneSupportCache = new Map<string, boolean>();

export interface WallClockParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

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
    return `UTC${sign}${padTwo(Math.floor(absolute / 60))}:${padTwo(absolute % 60)}`;
}

/**
 * The wall clock a zone shows for an instant. Accepts both stored forms;
 * with no usable zone the viewer's local clock is the only remaining guess.
 */
export function wallClockPartsAt(
    instantMs: number,
    timeZone: string | null | undefined
): WallClockParts {
    if (timeZone) {
        const fixedOffset = parseFixedOffsetTimeZone(timeZone);
        if (fixedOffset !== null) {
            return utcParts(new Date(instantMs + fixedOffset * MINUTE_MS));
        }
        if (isSupportedTimeZoneName(timeZone)) {
            return zoneParts(instantMs, timeZone);
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

/** The named zone's UTC offset, in minutes, at a given instant. */
export function zoneOffsetMinutesAt(
    instantMs: number,
    timeZone: string
): number {
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

/**
 * `YYYY-MM-DD HH:mm[:ss]` read as if it were UTC; `null` when malformed.
 * `Date.UTC` rolls out-of-range fields over (`2026-13-01 25:00` becomes a
 * real instant in 2027), so only a string that reads back unchanged counts.
 */
export function parseNaiveUtcMs(
    value: string | null | undefined
): number | null {
    const match = SERVER_LOCAL_DATE_TIME_PATTERN.exec(
        String(value ?? '').trim()
    );
    if (!match) {
        return null;
    }
    const [, year, month, day, hour, minute, second = '0'] = match;
    const fields = [
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
    ];
    const ms = Date.UTC(
        fields[0],
        fields[1],
        fields[2],
        fields[3],
        fields[4],
        fields[5]
    );
    if (!Number.isFinite(ms)) {
        return null;
    }
    const readBack = utcParts(new Date(ms));
    const unchanged = [
        readBack.year,
        readBack.month - 1,
        readBack.day,
        readBack.hour,
        readBack.minute,
        readBack.second,
    ].every((field, index) => field === fields[index]);
    return unchanged ? ms : null;
}

export function padTwo(value: number): string {
    return String(value).padStart(2, '0');
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
