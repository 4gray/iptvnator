import {
    EPG_GUIDE_MAX_CHANNELS_PER_REQUEST,
    EpgGuideQueryService,
    normalizeGuideWindow,
} from './epg-guide-query.service';

const getDatabase = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

jest.mock('../util/epg-logger', () => ({
    epgLogger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
}));

function flattenSql(value: unknown, seen = new Set<unknown>()): string {
    if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return String(value ?? '');
    }
    if (seen.has(value)) {
        return '';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => flattenSql(item, seen)).join(' ');
    }
    const sqlLike = value as {
        name?: unknown;
        queryChunks?: unknown[];
        value?: unknown;
    };
    if (Array.isArray(sqlLike.queryChunks)) {
        return sqlLike.queryChunks
            .map((chunk) => flattenSql(chunk, seen))
            .join(' ');
    }
    if (Array.isArray(sqlLike.value)) {
        return sqlLike.value.join(' ');
    }
    if (typeof sqlLike.value === 'string') {
        return sqlLike.value;
    }
    if (typeof sqlLike.name === 'string') {
        return sqlLike.name;
    }
    return '';
}

function programRow(
    channelId: string,
    start: string,
    stop: string,
    title: string
) {
    return {
        channelId,
        start,
        stop,
        title,
        description: null,
        category: null,
        iconUrl: null,
        rating: null,
        episodeNum: null,
    };
}

/** `db.select(cols).from().where().orderBy()` resolving to `rows`. */
function programSelect(rows: unknown[], whereCalls: unknown[]) {
    return jest.fn(() => ({
        from: jest.fn(() => ({
            where: jest.fn((condition: unknown) => {
                whereCalls.push(condition);
                return { orderBy: jest.fn().mockResolvedValue(rows) };
            }),
        })),
    }));
}

/** `db.selectDistinct(cols).from().where()` resolving to `rows`. */
function coverageSelect(rows: unknown[], whereCalls: unknown[]) {
    return jest.fn(() => ({
        from: jest.fn(() => ({
            where: jest.fn((condition: unknown) => {
                whereCalls.push(condition);
                return Promise.resolve(rows);
            }),
        })),
    }));
}

const FROM = Date.UTC(2026, 8, 6, 0, 0, 0);
const TO = Date.UTC(2026, 8, 7, 0, 0, 0);

describe('normalizeGuideWindow', () => {
    it('rejects an empty or inverted window', () => {
        expect(
            normalizeGuideWindow({ channelIds: ['a'], fromMs: TO, toMs: FROM })
        ).toBeNull();
        expect(
            normalizeGuideWindow({ channelIds: [' '], fromMs: FROM, toMs: TO })
        ).toBeNull();
        expect(
            normalizeGuideWindow({
                channelIds: ['a'],
                fromMs: Number.NaN,
                toMs: TO,
            })
        ).toBeNull();
    });

    it('trims, de-duplicates and caps the channel keys', () => {
        const ids = Array.from({ length: 150 }, (_, index) => `ch-${index}`);
        const window = normalizeGuideWindow({
            channelIds: [' a ', 'a', ...ids],
            fromMs: FROM,
            toMs: TO,
        });
        expect(window?.channelIds[0]).toBe('a');
        expect(window?.channelIds).toHaveLength(
            EPG_GUIDE_MAX_CHANNELS_PER_REQUEST
        );
        expect(window?.fromIso).toBe('2026-09-06T00:00:00.000Z');
        expect(window?.toIso).toBe('2026-09-07T00:00:00.000Z');
    });
});

describe('EpgGuideQueryService', () => {
    const getChannelMetadata = jest.fn();
    let service: EpgGuideQueryService;

    beforeEach(() => {
        getDatabase.mockReset();
        getChannelMetadata.mockReset();
        service = new EpgGuideQueryService({ getChannelMetadata }, '[Test]');
    });

    it('returns an empty list per requested key for an invalid window', async () => {
        const result = await service.getProgramsForChannels({
            channelIds: ['a', 'b'],
            fromMs: TO,
            toMs: FROM,
        });
        expect(result).toEqual({ a: [], b: [] });
        expect(getChannelMetadata).not.toHaveBeenCalled();
    });

    it('resolves keys through channel metadata and maps rows back onto every requested key', async () => {
        getChannelMetadata.mockResolvedValue({
            'ZDF HD': { id: 'zdf.de', displayName: 'ZDF HD', iconUrl: null },
            'zdf.de': { id: 'zdf.de', displayName: 'ZDF HD', iconUrl: null },
            unknown: null,
        });
        const whereCalls: unknown[] = [];
        getDatabase.mockResolvedValue({
            select: programSelect(
                [
                    programRow(
                        'zdf.de',
                        '2026-09-06T16:00:00.000Z',
                        '2026-09-06T16:45:00.000Z',
                        'heute-journal'
                    ),
                    programRow(
                        'zdf.de',
                        '2026-09-06T16:00:00.000Z',
                        '2026-09-06T16:45:00.000Z',
                        'heute-journal'
                    ),
                ],
                whereCalls
            ),
        });

        const result = await service.getProgramsForChannels({
            channelIds: ['ZDF HD', 'zdf.de', 'unknown'],
            fromMs: FROM,
            toMs: TO,
        });

        expect(getChannelMetadata).toHaveBeenCalledWith(
            ['ZDF HD', 'zdf.de', 'unknown'],
            {}
        );
        expect(result['ZDF HD']).toHaveLength(1);
        expect(result['zdf.de']).toHaveLength(1);
        expect(result['ZDF HD'][0]).toMatchObject({
            channel: 'zdf.de',
            title: 'heute-journal',
        });
        expect(result['unknown']).toEqual([]);
        const condition = flattenSql(whereCalls[0]);
        expect(condition).toContain('channel_id');
        expect(condition).toContain('2026-09-07T00:00:00.000Z');
        expect(condition).toContain('2026-09-06T00:00:00.000Z');
    });

    it('scopes the programme rows to the requested source URLs', async () => {
        getChannelMetadata.mockResolvedValue({
            a: { id: 'a', displayName: 'A', iconUrl: null },
        });
        const whereCalls: unknown[] = [];
        getDatabase.mockResolvedValue({
            select: programSelect([], whereCalls),
        });

        await service.getProgramsForChannels({
            channelIds: ['a'],
            fromMs: FROM,
            toMs: TO,
            sourceUrls: ['https://guide.example.com/epg.xml'],
        });

        expect(getChannelMetadata).toHaveBeenCalledWith(['a'], {
            sourceUrls: ['https://guide.example.com/epg.xml'],
        });
        expect(flattenSql(whereCalls[0])).toContain('source_url');
    });

    it('fails soft when the database throws', async () => {
        getChannelMetadata.mockResolvedValue({
            a: { id: 'a', displayName: 'A', iconUrl: null },
        });
        getDatabase.mockRejectedValue(new Error('locked'));

        await expect(
            service.getProgramsForChannels({
                channelIds: ['a'],
                fromMs: FROM,
                toMs: TO,
            })
        ).resolves.toEqual({ a: [] });
    });

    it('reports coverage for the requested keys whose channel has a programme in the window', async () => {
        getChannelMetadata.mockResolvedValue({
            'ZDF HD': { id: 'zdf.de', displayName: 'ZDF HD', iconUrl: null },
            'ARTE': { id: 'arte.de', displayName: 'ARTE', iconUrl: null },
            none: null,
        });
        const whereCalls: unknown[] = [];
        getDatabase.mockResolvedValue({
            selectDistinct: coverageSelect([{ channelId: 'zdf.de' }], whereCalls),
        });

        const covered = await service.getProgramCoverage({
            channelIds: ['ZDF HD', 'ARTE', 'none'],
            fromMs: FROM,
            toMs: TO,
        });

        expect(covered).toEqual(['ZDF HD']);
        expect(flattenSql(whereCalls[0])).toContain('channel_id');
    });
});
