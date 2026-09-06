import { execFileSync } from 'node:child_process';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import {
    EPG_GUIDE_MAX_CHANNELS_PER_REQUEST,
    EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST,
    EpgGuideQueryService,
    guideWindowCondition,
    normalizeGuideWindow,
} from './epg-guide-query.service';
import { epgLogger } from '../util/epg-logger';

const getDatabase = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

jest.mock('../util/epg-logger', () => ({
    epgLogger: { error: jest.fn(), log: jest.fn() },
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

    it('trims, de-duplicates and caps the channel keys to the default limit', () => {
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

    it('accepts an explicit larger cap for coverage-sized requests', () => {
        const ids = Array.from({ length: 150 }, (_, index) => `ch-${index}`);
        const window = normalizeGuideWindow(
            { channelIds: ids, fromMs: FROM, toMs: TO },
            EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST
        );
        expect(window?.channelIds).toHaveLength(150);
    });

    it('caps sourceUrls at 50 regardless of the channel cap', () => {
        const urls = Array.from(
            { length: 60 },
            (_, index) => `https://epg.example.com/${index}.xml`
        );
        const window = normalizeGuideWindow({
            channelIds: ['a'],
            fromMs: FROM,
            toMs: TO,
            sourceUrls: urls,
        });
        expect(window?.sourceUrls).toHaveLength(50);
    });
});

/** `true` when the CLI answers `sqlite3 -version`. Present on macOS and CI. */
function hasSqlite(): boolean {
    try {
        execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function quote(literal: string): string {
    return `'${literal.replace(/'/g, "''")}'`;
}

/** Substitutes a Drizzle-rendered query's `?` placeholders with literal SQL values. */
function inlineParams(sqlText: string, params: unknown[]): string {
    let index = 0;
    return sqlText.replace(/\?/g, () => {
        const value = params[index];
        index += 1;
        return typeof value === 'string' ? quote(value) : String(value);
    });
}

const describeWithSqlite = hasSqlite() ? describe : describe.skip;

describeWithSqlite('guideWindowCondition rendered against SQLite', () => {
    const FROM_ISO = '2026-09-06T00:00:00.000Z';
    const TO_ISO = '2026-09-07T00:00:00.000Z';

    /**
     * Renders the real Drizzle predicate to plain SQL (never a hand-written
     * restatement of its logic) so it can be proven against a real SQLite
     * engine.
     */
    function renderPredicate(
        epgIds: string[],
        sourceUrls: string[] = []
    ): string {
        const window = normalizeGuideWindow({
            channelIds: epgIds,
            fromMs: Date.parse(FROM_ISO),
            toMs: Date.parse(TO_ISO),
            sourceUrls,
        });
        if (!window) {
            throw new Error('expected a valid window');
        }
        const { sql, params } = new SQLiteSyncDialect().sqlToQuery(
            guideWindowCondition(epgIds, window)
        );
        return inlineParams(sql, params);
    }

    function matchingChannelIds(
        predicate: string,
        rows: Array<
            [
                channelId: string,
                start: string,
                stop: string,
                sourceUrl: string | null,
            ]
        >
    ): string[] {
        const values = rows
            .map(
                ([channelId, start, stop, sourceUrl]) =>
                    `(${quote(channelId)}, ${quote(start)}, ${quote(stop)}, ${
                        sourceUrl === null ? 'NULL' : quote(sourceUrl)
                    })`
            )
            .join(', ');
        const script = [
            'CREATE TABLE epg_programs (channel_id TEXT, start TEXT, stop TEXT, source_url TEXT);',
            `INSERT INTO epg_programs (channel_id, start, stop, source_url) VALUES ${values};`,
            `SELECT channel_id FROM epg_programs WHERE ${predicate} ORDER BY channel_id;`,
        ].join('\n');
        const out = execFileSync('sqlite3', [':memory:', script], {
            encoding: 'utf8',
        });
        return out
            .trim()
            .split('\n')
            .filter((line) => line.length > 0);
    }

    it('keeps rows overlapping the window and drops boundary-touching or non-overlapping rows', () => {
        const predicate = renderPredicate(['a', 'b', 'c', 'd', 'e']);
        const result = matchingChannelIds(predicate, [
            // Crosses the window start: overlaps.
            ['a', '2026-09-05T23:30:00.000Z', '2026-09-06T00:30:00.000Z', null],
            // Spans the whole window: overlaps.
            ['b', '2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z', null],
            // stop === from: excluded (strict `>`).
            ['c', '2026-09-05T22:00:00.000Z', '2026-09-06T00:00:00.000Z', null],
            // start === to: excluded (strict `<`).
            ['d', '2026-09-07T00:00:00.000Z', '2026-09-07T01:00:00.000Z', null],
            // Stored with a +03:00 offset. In UTC this is
            // [2026-09-06T23:00:00Z, 2026-09-07T00:30:00Z), which overlaps —
            // but a raw string compare of "07T02:00...+03:00" against
            // "07T00:00...Z" would say `start < to` is FALSE (lexically "02"
            // sorts after "00"), wrongly excluding it. Only `datetime()`
            // normalization recovers the correct overlap.
            [
                'e',
                '2026-09-07T02:00:00+03:00',
                '2026-09-07T03:30:00+03:00',
                null,
            ],
        ]);
        expect(result).toEqual(['a', 'b', 'e']);
    });

    it('scopes to the requested source URLs plus unsourced legacy rows', () => {
        const predicate = renderPredicate(
            ['u1-row', 'other-row', 'null-row', 'empty-row'],
            ['u1']
        );
        expect(predicate).toContain('"source_url" is null');
        const result = matchingChannelIds(predicate, [
            [
                'u1-row',
                '2026-09-06T12:00:00.000Z',
                '2026-09-06T13:00:00.000Z',
                'u1',
            ],
            [
                'other-row',
                '2026-09-06T12:00:00.000Z',
                '2026-09-06T13:00:00.000Z',
                'other',
            ],
            [
                'null-row',
                '2026-09-06T12:00:00.000Z',
                '2026-09-06T13:00:00.000Z',
                null,
            ],
            [
                'empty-row',
                '2026-09-06T12:00:00.000Z',
                '2026-09-06T13:00:00.000Z',
                '',
            ],
        ]);
        expect(result).toEqual(['empty-row', 'null-row', 'u1-row']);
    });
});

describe('EpgGuideQueryService', () => {
    const getChannelMetadata = jest.fn();
    let service: EpgGuideQueryService;

    beforeEach(() => {
        getDatabase.mockReset();
        getChannelMetadata.mockReset();
        (epgLogger.log as jest.Mock).mockReset();
        (epgLogger.error as jest.Mock).mockReset();
        service = new EpgGuideQueryService({ getChannelMetadata }, '[Test]');
    });

    it('returns an empty object (no per-key placeholders) for an invalid window', async () => {
        const result = await service.getProgramsForChannels({
            channelIds: ['a', 'b'],
            fromMs: TO,
            toMs: FROM,
        });
        expect(result).toEqual({});
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
        // Both keys resolved to the same channel — each must get its own
        // array so mutating one can never affect the other.
        expect(result['ZDF HD']).not.toBe(result['zdf.de']);
        expect(result['unknown']).toEqual([]);
        const condition = flattenSql(whereCalls[0]);
        expect(condition).toContain('channel_id');
        expect(condition).toContain('2026-09-07T00:00:00.000Z');
        expect(condition).toContain('2026-09-06T00:00:00.000Z');
    });

    it('scopes the programme rows to the requested source URLs plus legacy (unsourced) rows', async () => {
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
        const condition = flattenSql(whereCalls[0]).toLowerCase();
        expect(condition).toContain('source_url');
        expect(condition).toContain('is null');
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

    it('drops channel keys cut by the per-request cap from the result entirely', async () => {
        const ids = Array.from({ length: 101 }, (_, index) => `ch-${index}`);
        getChannelMetadata.mockResolvedValue({});

        const result = await service.getProgramsForChannels({
            channelIds: ids,
            fromMs: FROM,
            toMs: TO,
        });

        expect(Object.keys(result)).toHaveLength(
            EPG_GUIDE_MAX_CHANNELS_PER_REQUEST
        );
        // The 101st key was cut by the cap: absent, never present as `[]`.
        expect('ch-100' in result).toBe(false);
        expect(epgLogger.log).toHaveBeenCalledWith(
            '[Test]',
            'Guide programme request truncated',
            { requested: 101, kept: EPG_GUIDE_MAX_CHANNELS_PER_REQUEST }
        );
    });

    it('reports coverage for the requested keys whose channel has a programme in the window', async () => {
        getChannelMetadata.mockResolvedValue({
            'ZDF HD': { id: 'zdf.de', displayName: 'ZDF HD', iconUrl: null },
            ARTE: { id: 'arte.de', displayName: 'ARTE', iconUrl: null },
            none: null,
        });
        const whereCalls: unknown[] = [];
        getDatabase.mockResolvedValue({
            selectDistinct: coverageSelect(
                [{ channelId: 'zdf.de' }],
                whereCalls
            ),
        });

        const covered = await service.getProgramCoverage({
            channelIds: ['ZDF HD', 'ARTE', 'none'],
            fromMs: FROM,
            toMs: TO,
        });

        expect(covered).toEqual(['ZDF HD']);
        expect(flattenSql(whereCalls[0])).toContain('channel_id');
    });

    it('does not drop any of 150 requested keys under the larger coverage cap', async () => {
        const ids = Array.from({ length: 150 }, (_, index) => `ch-${index}`);
        getChannelMetadata.mockResolvedValue({});

        await service.getProgramCoverage({
            channelIds: ids,
            fromMs: FROM,
            toMs: TO,
        });

        expect(getChannelMetadata).toHaveBeenCalledWith(ids, {});
    });

    it('logs the coverage-specific truncation message when the coverage cap drops keys', async () => {
        const ids = Array.from(
            { length: EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST + 1 },
            (_, index) => `ch-${index}`
        );
        getChannelMetadata.mockResolvedValue({});

        await service.getProgramCoverage({
            channelIds: ids,
            fromMs: FROM,
            toMs: TO,
        });

        expect(epgLogger.log).toHaveBeenCalledWith(
            '[Test]',
            'Guide coverage request truncated',
            {
                requested: EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST + 1,
                kept: EPG_GUIDE_MAX_COVERAGE_KEYS_PER_REQUEST,
            }
        );
    });
});
