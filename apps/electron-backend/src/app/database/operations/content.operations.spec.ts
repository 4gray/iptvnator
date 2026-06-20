const andMock = jest.fn((...conditions: unknown[]) => ({
    kind: 'and',
    conditions,
}));
const eqMock = jest.fn((left: unknown, right: unknown) => ({
    kind: 'eq',
    left,
    right,
}));
const inArrayMock = jest.fn((left: unknown, values: unknown[]) => ({
    kind: 'inArray',
    left,
    values,
}));
const sqlJoinMock = jest.fn((chunks: unknown[], separator?: unknown) => ({
    kind: 'sql.join',
    chunks,
    separator,
}));
const sqlMock = Object.assign(
    jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
        kind: 'sql',
        strings: Array.from(strings),
        values,
    })),
    {
        join: (...args: Parameters<typeof sqlJoinMock>) => sqlJoinMock(...args),
    }
);

jest.mock('drizzle-orm', () => ({
    and: (...conditions: unknown[]) => andMock(...conditions),
    asc: jest.fn(),
    desc: jest.fn(),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    inArray: (left: unknown, values: unknown[]) => inArrayMock(left, values),
    or: jest.fn(),
    sql: sqlMock,
}));

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    buildM3uGlobalSearchResults,
    globalSearch,
    getContentByXtreamId,
    getGlobalRecentlyAdded,
    saveContent,
    scoreSearchTextMatch,
} from './content.operations';

function createDbMock(result: unknown[] = []) {
    const limit = jest.fn().mockResolvedValue(result);
    const where = jest.fn().mockReturnValue({ limit });
    const innerJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ innerJoin });
    const select = jest.fn().mockReturnValue({ from });

    return {
        db: {
            select,
        } as unknown as AppDatabase,
        innerJoin,
        limit,
        select,
        where,
    };
}

function createRecentlyAddedDbMock(resultsByCall: unknown[][]) {
    const queries: Array<{
        from: jest.Mock;
        innerJoin: jest.Mock;
        limit: jest.Mock;
        orderBy: jest.Mock;
        where: jest.Mock;
    }> = [];
    let resultIndex = 0;
    const select = jest.fn(() => {
        const query = {
            from: jest.fn(),
            innerJoin: jest.fn(),
            limit: jest.fn(),
            orderBy: jest.fn(),
            where: jest.fn(),
        };
        query.from.mockReturnValue(query);
        query.innerJoin.mockReturnValue(query);
        query.where.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockImplementation(async () => {
            const result = resultsByCall[resultIndex] ?? [];
            resultIndex += 1;
            return result;
        });
        queries.push(query);
        return query;
    });

    return {
        db: {
            select,
        } as unknown as AppDatabase,
        queries,
        select,
    };
}

describe('content.operations', () => {
    beforeEach(() => {
        andMock.mockClear();
        eqMock.mockClear();
        inArrayMock.mockClear();
        sqlJoinMock.mockClear();
        sqlMock.mockClear();
    });

    it('adds the content type filter when resolving by xtream ID', async () => {
        const { db, where } = createDbMock([
            {
                title: 'Krypton',
                type: 'series',
                xtream_id: 290,
            },
        ]);

        const result = await getContentByXtreamId(
            db,
            290,
            'playlist-1',
            'series'
        );

        expect(eqMock).toHaveBeenCalledWith(schema.content.xtreamId, 290);
        expect(eqMock).toHaveBeenCalledWith(
            schema.categories.playlistId,
            'playlist-1'
        );
        expect(eqMock).toHaveBeenCalledWith(schema.content.type, 'series');
        expect(where.mock.calls[0][0].conditions).toHaveLength(3);
        expect(result).toEqual(
            expect.objectContaining({
                title: 'Krypton',
                type: 'series',
                xtream_id: 290,
            })
        );
    });

    it('keeps the legacy lookup path when no content type is provided', async () => {
        const { db, where } = createDbMock();

        await getContentByXtreamId(db, 290, 'playlist-1');

        expect(eqMock).toHaveBeenCalledWith(schema.content.xtreamId, 290);
        expect(eqMock).toHaveBeenCalledWith(
            schema.categories.playlistId,
            'playlist-1'
        );
        expect(eqMock).not.toHaveBeenCalledWith(schema.content.type, 'series');
        expect(where.mock.calls[0][0].conditions).toHaveLength(2);
    });

    it('uses a synchronous better-sqlite transaction callback when saving content', async () => {
        const existingContentWhere = jest
            .fn()
            .mockResolvedValue([{ count: 0 }]);
        const existingContentInnerJoin = jest
            .fn()
            .mockReturnValue({ where: existingContentWhere });
        const existingContentFrom = jest
            .fn()
            .mockReturnValue({ innerJoin: existingContentInnerJoin });

        const categoriesWhere = jest.fn().mockResolvedValue([
            {
                id: 42,
                xtreamId: 201,
            },
        ]);
        const categoriesFrom = jest
            .fn()
            .mockReturnValue({ where: categoriesWhere });

        const select = jest
            .fn()
            .mockReturnValueOnce({ from: existingContentFrom })
            .mockReturnValueOnce({ from: categoriesFrom });

        const run = jest.fn();
        const onConflictDoNothing = jest.fn().mockReturnValue({ run });
        const values = jest.fn().mockReturnValue({ onConflictDoNothing });
        const insert = jest.fn().mockReturnValue({ values });
        const transactionResults: unknown[] = [];
        const transaction = jest.fn((callback: (tx: unknown) => unknown) => {
            const result = callback({ insert });
            transactionResults.push(result);

            if (
                typeof result === 'object' &&
                result !== null &&
                'then' in result
            ) {
                throw new Error('Transaction function cannot return a promise');
            }

            return result;
        });
        const db = {
            select,
            transaction,
        } as unknown as AppDatabase;

        await expect(
            saveContent(
                db,
                'playlist-1',
                [
                    {
                        category_id: '201',
                        name: 'News Live',
                        stream_id: '100',
                    },
                ],
                'live'
            )
        ).resolves.toEqual({ success: true, count: 1 });

        expect(transactionResults).toEqual([undefined]);
        expect(values).toHaveBeenCalledWith([
            expect.objectContaining({
                categoryId: 42,
                title: 'News Live',
                xtreamId: 100,
                type: 'live',
            }),
        ]);
        expect(run).toHaveBeenCalled();
    });

    it('does not persist far-future provider timestamps as valid recently-added dates', async () => {
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-05-19T00:00:00.000Z'));
        const existingContentWhere = jest
            .fn()
            .mockResolvedValue([{ count: 0 }]);
        const existingContentInnerJoin = jest
            .fn()
            .mockReturnValue({ where: existingContentWhere });
        const existingContentFrom = jest
            .fn()
            .mockReturnValue({ innerJoin: existingContentInnerJoin });

        const categoriesWhere = jest.fn().mockResolvedValue([
            {
                id: 42,
                xtreamId: 201,
            },
        ]);
        const categoriesFrom = jest
            .fn()
            .mockReturnValue({ where: categoriesWhere });

        const select = jest
            .fn()
            .mockReturnValueOnce({ from: existingContentFrom })
            .mockReturnValueOnce({ from: categoriesFrom });

        const run = jest.fn();
        const onConflictDoNothing = jest.fn().mockReturnValue({ run });
        const values = jest.fn().mockReturnValue({ onConflictDoNothing });
        const insert = jest.fn().mockReturnValue({ values });
        const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
            callback({ insert })
        );
        const db = {
            select,
            transaction,
        } as unknown as AppDatabase;

        try {
            await saveContent(
                db,
                'playlist-1',
                [
                    {
                        added: '1893456000',
                        category_id: '201',
                        name: 'Future Movie',
                        stream_id: '100',
                    },
                    {
                        added: '1779062400',
                        category_id: '201',
                        name: 'Fresh Movie',
                        stream_id: '101',
                    },
                    {
                        category_id: '201',
                        last_modified: '1778976000',
                        name: 'Modified Movie',
                        stream_id: '102',
                    },
                ],
                'movie'
            );

            expect(values).toHaveBeenCalledWith([
                expect.objectContaining({
                    title: 'Future Movie',
                    added: '',
                }),
                expect.objectContaining({
                    title: 'Fresh Movie',
                    added: '1779062400',
                }),
                expect.objectContaining({
                    title: 'Modified Movie',
                    added: '1778976000',
                }),
            ]);
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    it('loads global recently added movie and series rows separately before merging the top results', async () => {
        const { db, select } = createRecentlyAddedDbMock([
            [
                {
                    id: 1,
                    added_at: '200',
                    type: 'movie',
                    title: 'Movie',
                },
            ],
            [
                {
                    id: 2,
                    added_at: '300',
                    type: 'series',
                    title: 'Series',
                },
            ],
        ]);

        const result = await getGlobalRecentlyAdded(db, 'all', 20, 'xtream');

        expect(select).toHaveBeenCalledTimes(2);
        expect(eqMock).toHaveBeenCalledWith(schema.content.type, 'movie');
        expect(eqMock).toHaveBeenCalledWith(schema.content.type, 'series');
        expect(inArrayMock).not.toHaveBeenCalledWith(
            schema.content.type,
            expect.anything()
        );
        expect(result.map((item) => item.id)).toEqual([2, 1]);
    });

    it('builds M3U global search results from playlist payloads and respects hidden groups', () => {
        const visibleChannel = {
            id: 'channel-news',
            url: 'https://stream.test/news.m3u8',
            name: 'Daily News',
            group: { title: 'News' },
            tvg: {
                id: 'daily-news',
                name: 'Daily News HD',
                url: '',
                logo: 'https://image.test/news.png',
                rec: '',
            },
            http: {
                referrer: '',
                'user-agent': '',
                origin: '',
            },
            radio: '',
        };
        const radioChannel = {
            ...visibleChannel,
            id: 'radio-news',
            url: 'https://stream.test/radio.mp3',
            name: 'News Radio',
            radio: 'true',
        };
        const hiddenChannel = {
            ...visibleChannel,
            id: 'hidden-news',
            url: 'https://stream.test/hidden.m3u8',
            name: 'Hidden News',
            group: { title: 'Hidden' },
        };

        const results = buildM3uGlobalSearchResults(
            [
                {
                    id: 'm3u-1',
                    name: 'M3U One',
                    payload: JSON.stringify({
                        hiddenGroupTitles: ['Hidden'],
                        playlist: {
                            items: [
                                visibleChannel,
                                radioChannel,
                                hiddenChannel,
                            ],
                        },
                    }),
                },
                {
                    id: 'm3u-broken',
                    name: 'Broken',
                    payload: '{',
                },
            ],
            'news',
            true
        );

        expect(results).toEqual([
            expect.objectContaining({
                source_type: 'm3u',
                content_type: 'live',
                playlist_id: 'm3u-1',
                playlist_name: 'M3U One',
                channel_id: 'channel-news',
                stream_url: 'https://stream.test/news.m3u8',
                group_title: 'News',
                radio: '',
                poster_url: 'https://image.test/news.png',
                rating: null,
                added: null,
                xtream_id: -1,
                title: 'Daily News',
                type: 'live',
            }),
            expect.objectContaining({
                channel_id: 'radio-news',
                radio: 'true',
                title: 'News Radio',
            }),
        ]);
    });

    it('scores flexible search matches while keeping short first tokens anchored', () => {
        const prefixScore = scoreSearchTextMatch('TV Sport News', 'tv');
        const trailingScore = scoreSearchTextMatch('Test TV', 'tv');
        const wordScore = scoreSearchTextMatch('beIN MAX 1', 'max');
        const substringScore = scoreSearchTextMatch('Cinemax East', 'max');

        expect(prefixScore).not.toBeNull();
        expect(trailingScore).toBeNull();
        expect(wordScore).not.toBeNull();
        expect(substringScore).not.toBeNull();
        expect(wordScore as number).toBeLessThan(substringScore as number);
    });

    it('paginates ranked M3U global search results without losing substring matches', () => {
        const makeChannel = (id: string, name: string) => ({
            id,
            url: `https://stream.test/${id}.m3u8`,
            name,
            group: { title: 'Sports' },
            tvg: {
                id,
                name,
                url: '',
                logo: '',
                rec: '',
            },
            http: {
                referrer: '',
                'user-agent': '',
                origin: '',
            },
            radio: '',
        });

        const results = buildM3uGlobalSearchResults(
            [
                {
                    id: 'm3u-1',
                    name: 'M3U One',
                    payload: JSON.stringify({
                        playlist: {
                            items: [
                                makeChannel('exact', 'MAX'),
                                makeChannel('word', 'beIN MAX 1'),
                                makeChannel('substring', 'Cinemax East'),
                            ],
                        },
                    }),
                },
            ],
            'max',
            false,
            {
                limit: 2,
                offset: 1,
            }
        );

        expect(results.map((item) => item.title)).toEqual([
            'beIN MAX 1',
            'Cinemax East',
        ]);
    });

    it('uses the title index raw query path for short global search prefixes', async () => {
        const all = jest.fn().mockResolvedValue([
            {
                id: 1,
                category_id: 10,
                title: 'TV Sport News',
                rating: '',
                added: '',
                poster_url: '',
                epg_channel_id: '',
                tv_archive: 0,
                tv_archive_duration: 0,
                direct_source: '',
                xtream_id: 99,
                type: 'live',
                playlist_id: 'playlist-1',
                playlist_name: 'Playlist One',
            },
        ]);
        const select = jest.fn();
        const db = {
            all,
            select,
        } as unknown as AppDatabase;

        const results = await globalSearch(
            db,
            'tv',
            ['live'],
            false,
            ['xtream'],
            { limit: 10 }
        );

        expect(all).toHaveBeenCalledTimes(1);
        expect(select).not.toHaveBeenCalled();
        expect(sqlJoinMock).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    strings: expect.arrayContaining([
                        expect.stringContaining('c.title GLOB'),
                    ]),
                }),
            ]),
            expect.objectContaining({
                strings: expect.arrayContaining([
                    expect.stringContaining(' OR '),
                ]),
            })
        );
        expect(results).toEqual([
            expect.objectContaining({
                title: 'TV Sport News',
                source_type: 'xtream',
                content_type: 'live',
            }),
        ]);
    });

    it('uses the content title FTS path for longer global search terms', async () => {
        const all = jest.fn().mockResolvedValue([
            {
                id: 1,
                category_id: 10,
                title: 'beIN MAX 1',
                rating: '',
                added: '',
                poster_url: '',
                epg_channel_id: '',
                tv_archive: 0,
                tv_archive_duration: 0,
                direct_source: '',
                xtream_id: 99,
                type: 'live',
                playlist_id: 'playlist-1',
                playlist_name: 'Playlist One',
            },
        ]);
        const select = jest.fn();
        const db = {
            all,
            select,
        } as unknown as AppDatabase;

        const results = await globalSearch(
            db,
            'max',
            ['live'],
            false,
            ['xtream'],
            { limit: 10 }
        );

        const sqlStrings = sqlMock.mock.calls
            .map(([strings]) =>
                Array.from(strings as TemplateStringsArray).join(' ')
            )
            .join('\n');

        expect(all).toHaveBeenCalledTimes(1);
        expect(select).not.toHaveBeenCalled();
        expect(sqlStrings).toContain('FROM content_title_fts');
        expect(results).toEqual([
            expect.objectContaining({
                title: 'beIN MAX 1',
                source_type: 'xtream',
                content_type: 'live',
            }),
        ]);
    });

    it('quotes FTS tokens so reserved words do not fall back to content scans', async () => {
        const all = jest.fn().mockResolvedValue([
            {
                id: 1,
                category_id: 10,
                title: 'And One TV',
                rating: '',
                added: '',
                poster_url: '',
                epg_channel_id: '',
                tv_archive: 0,
                tv_archive_duration: 0,
                direct_source: '',
                xtream_id: 99,
                type: 'live',
                playlist_id: 'playlist-1',
                playlist_name: 'Playlist One',
            },
        ]);
        const db = {
            all,
            select: jest.fn(),
        } as unknown as AppDatabase;

        await globalSearch(db, 'and', ['live'], false, ['xtream'], {
            limit: 10,
        });

        const matchSqlCall = sqlMock.mock.calls.find(([strings]) =>
            Array.from(strings as TemplateStringsArray)
                .join(' ')
                .includes('content_title_fts MATCH')
        );

        expect(matchSqlCall?.[1]).toBe('"and"');
    });

    it('keeps accented FTS token variants in global search SQL prefilters', async () => {
        const all = jest.fn().mockResolvedValue([
            {
                id: 1,
                category_id: 10,
                title: 'Café TV',
                rating: null,
                added: null,
                poster_url: null,
                epg_channel_id: '',
                tv_archive: 0,
                tv_archive_duration: 0,
                direct_source: '',
                xtream_id: 99,
                type: 'live',
                playlist_id: 'playlist-1',
                playlist_name: 'Playlist One',
            },
        ]);
        const db = {
            all,
            select: jest.fn(),
        } as unknown as AppDatabase;

        await globalSearch(db, 'Café', ['live'], false, ['xtream'], {
            limit: 10,
        });

        const matchSqlCall = sqlMock.mock.calls.find(([strings]) =>
            Array.from(strings as TemplateStringsArray)
                .join(' ')
                .includes('content_title_fts MATCH')
        );

        expect(matchSqlCall?.[1]).toContain('"café"');
        expect(matchSqlCall?.[1]).toContain('"cafe"');
    });

    it('uses a stable max candidate limit for M3U playlist payload searches', async () => {
        const limit = jest.fn().mockResolvedValue([]);
        const orderedQuery = {
            limit,
            then: (resolve: (value: unknown[]) => void) => resolve([]),
        };
        const orderBy = jest.fn().mockReturnValue(orderedQuery);
        const where = jest.fn().mockReturnValue({ orderBy });
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await globalSearch(db, 'news', ['live'], false, ['m3u'], {
            limit: 10,
            offset: 100,
        });

        expect(orderBy).toHaveBeenCalledWith(schema.playlists.name);
        expect(limit).toHaveBeenCalledWith(5000);
    });

    it('prefilters M3U payloads by searchable text fields instead of raw payload contains', async () => {
        const limit = jest.fn().mockResolvedValue([]);
        const orderedQuery = {
            limit,
            then: (resolve: (value: unknown[]) => void) => resolve([]),
        };
        const orderBy = jest.fn().mockReturnValue(orderedQuery);
        const where = jest.fn().mockReturnValue({ orderBy });
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await globalSearch(db, 'news', ['live'], false, ['m3u'], {
            limit: 10,
        });

        const searchPatterns = sqlMock.mock.calls
            .flatMap(([, ...values]) => values)
            .filter(
                (value): value is string =>
                    typeof value === 'string' &&
                    value.toLocaleLowerCase().includes('news')
            );

        expect(searchPatterns.length).toBeGreaterThan(0);
        expect(searchPatterns).not.toContain('%news%');
        expect(
            searchPatterns.every(
                (pattern) =>
                    pattern.includes('"name"') || pattern.includes('"title"')
            )
        ).toBe(true);
    });

    it('keeps accented M3U payload text field variants in SQL prefilters', async () => {
        const limit = jest.fn().mockResolvedValue([]);
        const orderedQuery = {
            limit,
            then: (resolve: (value: unknown[]) => void) => resolve([]),
        };
        const orderBy = jest.fn().mockReturnValue(orderedQuery);
        const where = jest.fn().mockReturnValue({ orderBy });
        const from = jest.fn().mockReturnValue({ where });
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await globalSearch(db, 'Café', ['live'], false, ['m3u'], {
            limit: 10,
        });

        const searchPatterns = sqlMock.mock.calls
            .flatMap(([, ...values]) => values)
            .filter(
                (value): value is string =>
                    typeof value === 'string' &&
                    value.toLocaleLowerCase().includes('caf')
            );

        expect(searchPatterns).toEqual(
            expect.arrayContaining([
                expect.stringContaining('café'),
                expect.stringContaining('cafe'),
            ])
        );
        expect(
            searchPatterns.every(
                (pattern) =>
                    pattern.includes('"name"') || pattern.includes('"title"')
            )
        ).toBe(true);
    });
});
