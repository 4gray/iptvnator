import {
    formatSourceDate,
    formatSourceDuration,
    SourceFormatContext,
    sourceMetaParts,
    sourceStatusTag,
    sourceTypeLabel,
} from './source-format';

const NOW = new Date(2026, 9, 12, 12, 0).getTime();
const DAY = 86_400_000;

/** Echoes the key and its parameters, so specs read what was asked for. */
const translate = (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key;

const context = (locale = 'en'): SourceFormatContext => ({
    translate,
    locale,
    now: NOW,
});

describe('formatSourceDate', () => {
    it('shows day and month in the current year', () => {
        const date = new Date(2026, 8, 6).toISOString();
        expect(formatSourceDate(date, 'en', NOW)).toBe('Sep 6');
        expect(formatSourceDate(date, 'ru', NOW)).toMatch(/^6 сент/);
    });

    it('adds the year for another year', () => {
        const date = new Date(2025, 8, 6).toISOString();
        expect(formatSourceDate(date, 'en', NOW)).toBe('Sep 6, 2025');
    });

    it('adds the time on request', () => {
        const date = new Date(2026, 8, 6, 21, 34).getTime();
        expect(formatSourceDate(date, 'en-GB', NOW, true)).toBe(
            '6 Sept, 21:34'
        );
    });

    it('reads epoch milliseconds stored as a string', () => {
        const value = String(new Date(2026, 0, 2).getTime());
        expect(formatSourceDate(value, 'en', NOW)).toBe('Jan 2');
    });

    it('returns null for an empty or invalid value', () => {
        expect(formatSourceDate(undefined, 'en', NOW)).toBeNull();
        expect(formatSourceDate('', 'en', NOW)).toBeNull();
        expect(formatSourceDate('not a date', 'en', NOW)).toBeNull();
    });

    it('falls back to English for an unknown locale', () => {
        const date = new Date(2026, 8, 6).toISOString();
        expect(formatSourceDate(date, 'not_a-locale!', NOW)).toBe('Sep 6');
    });
});

describe('formatSourceDuration', () => {
    it('counts whole days, then hours, in the UI language', () => {
        expect(formatSourceDuration(NOW - 3 * DAY - 5, 'en', NOW)).toBe(
            '3 days'
        );
        expect(formatSourceDuration(NOW - 3 * DAY, 'ru', NOW)).toBe('3 дня');
        expect(formatSourceDuration(NOW - 5 * 3_600_000, 'en', NOW)).toBe(
            '5 hours'
        );
    });

    it('says nothing under an hour', () => {
        expect(formatSourceDuration(NOW - 60_000, 'en', NOW)).toBeNull();
    });
});

describe('sourceMetaParts', () => {
    const m3u = {
        title: 'Free TV',
        url: 'https://cdn.tv/a/b/list.m3u?token=secret1',
        count: 16805,
        importDate: new Date(2026, 8, 30).toISOString(),
        updateDate: new Date(2026, 9, 8, 3, 0).getTime(),
    };

    it('lists type, channels, added, updated and URL in that order', () => {
        const parts = sourceMetaParts(m3u, context());
        expect(parts.map((part) => part.kind)).toEqual([
            'type',
            'channels',
            'added',
            'updated',
            'url',
        ]);
        expect(parts[0].text).toBe('M3U');
        expect(parts[1].text).toBe(
            'HOME.PLAYLISTS.CHANNELS_COUNT {"count":"16,805"}'
        );
        expect(parts[4].text).toBe('https://cdn.tv/…/list.m3u');
    });

    it('counts a single channel in the singular', () => {
        expect(sourceMetaParts({ ...m3u, count: 1 }, context())[1].text).toBe(
            'WORKSPACE.SOURCES.ROW.CHANNELS_ONE {"count":"1"}'
        );
    });

    it('leaves out empty parts and zero channels', () => {
        const parts = sourceMetaParts(
            { title: 'x', count: 0, importDate: '' },
            context()
        );
        expect(parts).toEqual([
            { kind: 'type', text: 'WORKSPACE.SOURCES.ROW.TYPE_M3U_FILE' },
        ]);
    });

    it('shows no channel count for Xtream and Stalker', () => {
        const parts = sourceMetaParts(
            {
                title: 'x',
                serverUrl: 'http://x.tv',
                username: 'joe',
                password: 'p4ss',
                count: 0,
                importDate: '',
            },
            context()
        );
        expect(parts.map((part) => part.kind)).toEqual(['type', 'url']);
        expect(parts[0].text).toBe('Xtream');
    });

    it('keeps type, channels and updated in the compact row', () => {
        expect(
            sourceMetaParts(m3u, context(), true).map((part) => part.kind)
        ).toEqual(['type', 'channels', 'updated']);
    });
});

describe('sourceTypeLabel', () => {
    it('names every provider', () => {
        expect(sourceTypeLabel({ url: 'http://x' }, translate)).toBe('M3U');
        expect(sourceTypeLabel({}, translate)).toBe(
            'WORKSPACE.SOURCES.ROW.TYPE_M3U_FILE'
        );
        expect(sourceTypeLabel({ serverUrl: 'http://x' }, translate)).toBe(
            'Xtream'
        );
        expect(sourceTypeLabel({ macAddress: 'm' }, translate)).toBe('Stalker');
    });
});

describe('sourceStatusTag', () => {
    it('says how long a source has not responded', () => {
        expect(
            sourceStatusTag(
                { reachability: 'bad', failingSince: NOW - 3 * DAY },
                context()
            )
        ).toEqual({
            tone: 'danger',
            label: 'WORKSPACE.SOURCES.ROW.UNREACHABLE_FOR {"duration":"3 days"}',
        });
    });

    it('drops the duration in the compact row and under an hour', () => {
        const status = {
            reachability: 'bad',
            failingSince: NOW - 3 * DAY,
        } as const;
        expect(sourceStatusTag(status, context(), true)?.label).toBe(
            'WORKSPACE.SOURCES.ROW.UNREACHABLE'
        );
        expect(
            sourceStatusTag(
                { reachability: 'bad', failingSince: NOW - 1000 },
                context()
            )?.label
        ).toBe('WORKSPACE.SOURCES.ROW.UNREACHABLE');
    });

    it('tags expired accounts and unchecked sources', () => {
        expect(sourceStatusTag({ reachability: 'expired' }, context())).toEqual(
            {
                tone: 'danger',
                label: 'WORKSPACE.SOURCES.ROW.EXPIRED',
            }
        );
        expect(sourceStatusTag({ reachability: 'unknown' }, context())).toEqual(
            {
                tone: 'neutral',
                label: 'SOURCE_HEALTH.REASON.unknown',
            }
        );
        expect(
            sourceStatusTag({ reachability: 'unknown' }, context(), true)
        ).toBeNull();
    });

    it('has no tag for a healthy, checking or local source', () => {
        expect(sourceStatusTag({ reachability: 'ok' }, context())).toBeNull();
        expect(
            sourceStatusTag({ reachability: 'checking' }, context())
        ).toBeNull();
        expect(sourceStatusTag(null, context())).toBeNull();
    });
});
