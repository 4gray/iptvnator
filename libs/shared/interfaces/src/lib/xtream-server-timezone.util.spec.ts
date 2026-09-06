import {
    deriveXtreamServerUtcOffsetMinutes,
    formatFixedOffsetTimeZone,
    formatXtreamCatchupStart,
    isSupportedTimeZoneName,
    parseFixedOffsetTimeZone,
    parseXtreamServerLocalDateTime,
    resolveXtreamServerTimezone,
} from './xtream-server-timezone.util';

// 2026-09-06 19:30:00 UTC — the mock EPG fixture's shape, a Saturday in BST.
const EPOCH = 1_788_723_000;

describe('xtream-server-timezone.util', () => {
    describe('isSupportedTimeZoneName', () => {
        it('accepts IANA names and the UTC alias', () => {
            expect(isSupportedTimeZoneName('Europe/London')).toBe(true);
            expect(isSupportedTimeZoneName('America/Sao_Paulo')).toBe(true);
            expect(isSupportedTimeZoneName('UTC')).toBe(true);
        });

        it('rejects the offset spellings panels sometimes send', () => {
            expect(isSupportedTimeZoneName('UTC+3')).toBe(false);
            expect(isSupportedTimeZoneName('')).toBe(false);
            expect(isSupportedTimeZoneName('Mars/Olympus')).toBe(false);
        });
    });

    describe('fixed offset form', () => {
        it('round-trips positive, negative, zero and half-hour offsets', () => {
            expect(formatFixedOffsetTimeZone(180)).toBe('UTC+03:00');
            expect(formatFixedOffsetTimeZone(-210)).toBe('UTC-03:30');
            expect(formatFixedOffsetTimeZone(0)).toBe('UTC');
            expect(parseFixedOffsetTimeZone('UTC+03:00')).toBe(180);
            expect(parseFixedOffsetTimeZone('UTC-03:30')).toBe(-210);
            expect(parseFixedOffsetTimeZone('UTC')).toBe(0);
        });

        it('does not mistake other strings for the stored form', () => {
            expect(parseFixedOffsetTimeZone('UTC+3')).toBeNull();
            expect(parseFixedOffsetTimeZone('Europe/London')).toBeNull();
            expect(parseFixedOffsetTimeZone('utc')).toBeNull();
        });
    });

    describe('deriveXtreamServerUtcOffsetMinutes', () => {
        it('reads the offset from the panel clock pair', () => {
            // 19:30 UTC shown as 22:30 → the panel runs at UTC+3.
            expect(
                deriveXtreamServerUtcOffsetMinutes('2026-09-06 22:30:00', EPOCH)
            ).toBe(180);
            expect(
                deriveXtreamServerUtcOffsetMinutes(
                    '2026-09-06 16:30:00',
                    String(EPOCH)
                )
            ).toBe(-180);
        });

        it('snaps a second of clock skew to the real offset', () => {
            expect(
                deriveXtreamServerUtcOffsetMinutes('2026-09-06 22:29:59', EPOCH)
            ).toBe(180);
        });

        it('rejects missing, malformed or impossible values', () => {
            expect(
                deriveXtreamServerUtcOffsetMinutes(undefined, EPOCH)
            ).toBeNull();
            expect(
                deriveXtreamServerUtcOffsetMinutes('2026-09-06 22:30:00', null)
            ).toBeNull();
            expect(
                deriveXtreamServerUtcOffsetMinutes('yesterday', EPOCH)
            ).toBeNull();
            expect(
                deriveXtreamServerUtcOffsetMinutes('2026-09-06 22:30:00', 0)
            ).toBeNull();
            // 20 hours ahead is not a real offset — a broken clock pair.
            expect(
                deriveXtreamServerUtcOffsetMinutes('2026-09-07 15:30:00', EPOCH)
            ).toBeNull();
        });
    });

    describe('resolveXtreamServerTimezone', () => {
        it('prefers a resolvable IANA name', () => {
            expect(
                resolveXtreamServerTimezone({
                    timezone: ' Europe/London ',
                    time_now: '2026-09-06 22:30:00',
                    timestamp_now: EPOCH,
                })
            ).toBe('Europe/London');
        });

        it('falls back to the clock-derived fixed offset for an unusable name', () => {
            expect(
                resolveXtreamServerTimezone({
                    timezone: 'UTC+3',
                    time_now: '2026-09-06 22:30:00',
                    timestamp_now: EPOCH,
                })
            ).toBe('UTC+03:00');
            expect(
                resolveXtreamServerTimezone({
                    timezone: '',
                    time_now: '2026-09-06 19:30:00',
                    timestamp_now: String(EPOCH),
                })
            ).toBe('UTC');
        });

        it('reports nothing when neither field is trustworthy', () => {
            expect(resolveXtreamServerTimezone(undefined)).toBeUndefined();
            expect(resolveXtreamServerTimezone({})).toBeUndefined();
            expect(
                resolveXtreamServerTimezone({
                    timezone: 'UTC+3',
                    time_now: 'n/a',
                    timestamp_now: EPOCH,
                })
            ).toBeUndefined();
        });
    });

    describe('formatXtreamCatchupStart', () => {
        it('formats in the IANA zone, honouring DST', () => {
            expect(formatXtreamCatchupStart(EPOCH, 'Europe/London')).toBe(
                '2026-09-06:20-30'
            );
            expect(formatXtreamCatchupStart(EPOCH, 'America/Sao_Paulo')).toBe(
                '2026-09-06:16-30'
            );
        });

        it('formats in a stored fixed offset', () => {
            expect(formatXtreamCatchupStart(EPOCH, 'UTC+03:00')).toBe(
                '2026-09-06:22-30'
            );
            expect(formatXtreamCatchupStart(EPOCH, 'UTC-03:30')).toBe(
                '2026-09-06:16-00'
            );
            expect(formatXtreamCatchupStart(EPOCH, 'UTC')).toBe(
                '2026-09-06:19-30'
            );
        });

        it('renders midnight as 00, never 24', () => {
            const midnightUtc = Date.UTC(2026, 8, 7, 0, 0, 0) / 1000;
            expect(formatXtreamCatchupStart(midnightUtc, 'UTC')).toBe(
                '2026-09-07:00-00'
            );
            expect(formatXtreamCatchupStart(midnightUtc, 'Etc/GMT')).toBe(
                '2026-09-07:00-00'
            );
        });

        it('falls back to the local clock only when no timezone is usable', () => {
            const date = new Date(EPOCH * 1000);
            const pad = (value: number) => String(value).padStart(2, '0');
            const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}:${pad(date.getHours())}-${pad(date.getMinutes())}`;
            expect(formatXtreamCatchupStart(EPOCH, undefined)).toBe(local);
            expect(formatXtreamCatchupStart(EPOCH, 'UTC+3')).toBe(local);
        });
    });

    describe('parseXtreamServerLocalDateTime', () => {
        it('converts a server-local string back to the epoch it came from', () => {
            expect(
                parseXtreamServerLocalDateTime(
                    '2026-09-06 20:30:00',
                    'Europe/London'
                )
            ).toBe(EPOCH);
            expect(
                parseXtreamServerLocalDateTime(
                    '2026-09-06 16:30:00',
                    'America/Sao_Paulo'
                )
            ).toBe(EPOCH);
            expect(
                parseXtreamServerLocalDateTime('2026-09-06 22:30', 'UTC+03:00')
            ).toBe(EPOCH);
            expect(
                parseXtreamServerLocalDateTime('2026-09-06T19:30:00', 'UTC')
            ).toBe(EPOCH);
        });

        it('resolves wall clocks right after a DST switch on the correct side', () => {
            // Europe/Berlin left DST at 2026-10-25 03:00 CEST → 02:00 CET.
            // 03:30 local is unambiguous CET (UTC+1) → 02:30 UTC.
            expect(
                parseXtreamServerLocalDateTime(
                    '2026-10-25 03:30:00',
                    'Europe/Berlin'
                )
            ).toBe(Date.UTC(2026, 9, 25, 2, 30, 0) / 1000);
            // 2026-03-29 03:30 CEST (first hour after the spring switch) →
            // 01:30 UTC.
            expect(
                parseXtreamServerLocalDateTime(
                    '2026-03-29 03:30:00',
                    'Europe/Berlin'
                )
            ).toBe(Date.UTC(2026, 2, 29, 1, 30, 0) / 1000);
        });

        it('returns null for malformed strings or an unusable timezone', () => {
            expect(
                parseXtreamServerLocalDateTime('2026-09-06', 'UTC')
            ).toBeNull();
            expect(
                parseXtreamServerLocalDateTime('2026-09-06 20:30:00', 'UTC+3')
            ).toBeNull();
            expect(
                parseXtreamServerLocalDateTime('2026-09-06 20:30:00', undefined)
            ).toBeNull();
        });
    });
});
