import { EpgQueryService } from './epg-query.service';

const getDatabase = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
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
        value?: unknown[];
    };

    if (Array.isArray(sqlLike.queryChunks)) {
        return sqlLike.queryChunks
            .map((chunk) => flattenSql(chunk, seen))
            .join(' ');
    }

    if (Array.isArray(sqlLike.value)) {
        return sqlLike.value.join(' ');
    }

    if (typeof sqlLike.name === 'string') {
        return sqlLike.name;
    }

    return '';
}

function createSelectChain(
    whereResult: unknown,
    whereCalls: unknown[]
): { from: jest.Mock } {
    const where = jest.fn((condition: unknown) => {
        whereCalls.push(condition);
        return whereResult;
    });
    return {
        from: jest.fn(() => ({ where })),
    };
}

function createLimitedSelectChain(
    limitResult: unknown,
    whereCalls: unknown[]
): { from: jest.Mock } {
    const chain: Record<string, jest.Mock> = {
        limit: jest.fn().mockResolvedValue(limitResult),
    };
    // groupBy/orderBy are optional links in the various query shapes; each
    // returns the chain so where().groupBy().orderBy().limit() (and any
    // subset) resolves to the same data.
    chain.groupBy = jest.fn(() => chain);
    chain.orderBy = jest.fn(() => chain);
    const where = jest.fn((condition: unknown) => {
        whereCalls.push(condition);
        return chain;
    });
    return {
        from: jest.fn(() => ({ where })),
    };
}

/** Program-query chain: from().where().groupBy().orderBy().limit(). */
function createProgramChain(rows: unknown): { from: jest.Mock } {
    const chain: Record<string, jest.Mock> = {
        limit: jest.fn().mockResolvedValue(rows),
    };
    chain.groupBy = jest.fn(() => chain);
    chain.orderBy = jest.fn(() => chain);
    return {
        from: jest.fn(() => ({ where: jest.fn(() => chain) })),
    };
}

describe('EpgQueryService', () => {
    let service: EpgQueryService;

    beforeEach(() => {
        getDatabase.mockReset();
        service = new EpgQueryService('[Test EPG]');
    });

    it('scopes display-name current program fallback by program source ownership for shared channels', async () => {
        const whereCalls: unknown[] = [];
        const select = jest
            .fn()
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            .mockReturnValueOnce(createSelectChain([], whereCalls))
            .mockReturnValueOnce(createSelectChain([], whereCalls));

        getDatabase.mockResolvedValue({ select });

        await service.getCurrentProgramsBatch(['Shared Channel'], {
            sourceUrls: ['https://second.example.com/guide.xml'],
        });

        const channelScopeSql = whereCalls.map((condition) =>
            flattenSql(condition)
        );

        expect(
            channelScopeSql.some(
                (condition) =>
                    condition.includes('EXISTS') &&
                    condition.includes('channel_id') &&
                    condition.includes('source_url')
            )
        ).toBe(true);
    });

    it('falls back to legacy unscoped current programs after a scoped batch miss', async () => {
        const whereCalls: unknown[] = [];
        const select = jest
            .fn()
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            .mockReturnValueOnce(
                createLimitedSelectChain(
                    [
                        {
                            id: 1,
                            channelId: 'legacy-channel',
                            start: '2026-06-21T17:00:00.000Z',
                            stop: '2026-06-21T18:00:00.000Z',
                            title: 'Legacy Guide Program',
                            description: null,
                            category: null,
                            iconUrl: null,
                            rating: null,
                            episodeNum: null,
                            sourceUrl: null,
                        },
                    ],
                    whereCalls
                )
            );

        getDatabase.mockResolvedValue({ select });

        const result = await service.getCurrentProgramsBatch(
            ['legacy-channel'],
            {
                sourceUrls: ['https://playlist.example.com/guide.xml'],
            }
        );

        expect(result['legacy-channel']?.title).toBe('Legacy Guide Program');
        expect(
            whereCalls
                .map((condition) => flattenSql(condition).toLowerCase())
                .some(
                    (condition) =>
                        condition.includes('source_url') &&
                        condition.includes('is null')
            )
        ).toBe(true);
    });

    it('resolves display-name current program fallback in batched queries', async () => {
        const whereCalls: unknown[] = [];
        const select = jest
            .fn()
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            .mockReturnValueOnce(
                createSelectChain(
                    [
                        {
                            id: 'guide-news',
                            displayName: 'News Channel',
                            iconUrl: null,
                        },
                        {
                            id: 'guide-sports',
                            displayName: 'Sports Channel',
                            iconUrl: null,
                        },
                    ],
                    whereCalls
                )
            )
            .mockReturnValueOnce(
                createLimitedSelectChain(
                    [
                        {
                            id: 1,
                            channelId: 'guide-news',
                            start: '2026-06-21T17:00:00.000Z',
                            stop: '2026-06-21T18:00:00.000Z',
                            title: 'News Now',
                            description: null,
                            category: null,
                            iconUrl: null,
                            rating: null,
                            episodeNum: null,
                            sourceUrl: 'https://playlist.example.com/guide.xml',
                        },
                        {
                            id: 2,
                            channelId: 'guide-sports',
                            start: '2026-06-21T17:00:00.000Z',
                            stop: '2026-06-21T18:00:00.000Z',
                            title: 'Sports Now',
                            description: null,
                            category: null,
                            iconUrl: null,
                            rating: null,
                            episodeNum: null,
                            sourceUrl: 'https://playlist.example.com/guide.xml',
                        },
                    ],
                    whereCalls
                )
            );

        getDatabase.mockResolvedValue({ select });

        const result = await service.getCurrentProgramsBatch(
            ['News Channel', 'Sports Channel'],
            {
                sourceUrls: ['https://playlist.example.com/guide.xml'],
            }
        );

        expect(result['News Channel']?.title).toBe('News Now');
        expect(result['Sports Channel']?.title).toBe('Sports Now');
        expect(select).toHaveBeenCalledTimes(4);
    });

    it('compares current-programme windows with timezone-aware datetime() rather than raw strings', async () => {
        const whereCalls: unknown[] = [];
        const select = jest.fn().mockReturnValueOnce(
            createLimitedSelectChain(
                [
                    {
                        id: 1,
                        channelId: 'ch',
                        start: '2026-06-29T23:25:00+03:00',
                        stop: '2026-06-30T00:30:00+03:00',
                        title: 'Now',
                        description: null,
                        category: null,
                        iconUrl: null,
                        rating: null,
                        episodeNum: null,
                        sourceUrl: 'https://example.com/guide.xml',
                    },
                ],
                whereCalls
            )
        );
        getDatabase.mockResolvedValue({ select });

        await service.getCurrentProgramsBatch(['ch'], {
            sourceUrls: ['https://example.com/guide.xml'],
        });

        const flattened = whereCalls.map((condition) =>
            flattenSql(condition).toLowerCase()
        );
        // Stored timestamps carry an offset (+03:00) while `now` is UTC (…Z);
        // a raw string compare would be off by the offset, so both sides must be
        // normalized with datetime().
        expect(flattened.some((condition) => condition.includes('datetime'))).toBe(
            true
        );
    });

    it('falls back to an unscoped current-programme lookup when programmes are tagged with an out-of-scope source', async () => {
        const whereCalls: unknown[] = [];
        const currentProgram = {
            id: 10,
            channelId: '2265',
            start: '2026-06-29T23:25:00+03:00',
            stop: '2026-06-30T00:30:00+03:00',
            title: 'Podcast Now',
            description: null,
            category: null,
            iconUrl: null,
            rating: null,
            episodeNum: null,
            // Programmes tagged with epg.one, which is NOT in the active scope.
            sourceUrl: 'http://epg.one/epg.xml.gz',
        };
        const select = jest
            .fn()
            // 1 direct current (scoped) – no channel_id '360'
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            // 2 direct current (legacy)
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            // 3 candidate lookup – channel row '360' is in scope (its own source)
            .mockReturnValueOnce(
                createSelectChain(
                    [{ id: '2265', displayName: '360', iconUrl: null }],
                    whereCalls
                )
            )
            // 4 candidate current (scoped) – empty, programmes are out of scope
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            // 5 candidate current (legacy) – empty
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            // 6 candidate current (UNSCOPED fallback) – finds the programme
            .mockReturnValueOnce(
                createLimitedSelectChain([currentProgram], whereCalls)
            );

        getDatabase.mockResolvedValue({ select });

        const result = await service.getCurrentProgramsBatch(['360'], {
            sourceUrls: ['http://epg.it999.ru/epg2.xml'],
        });

        expect(result['360']?.title).toBe('Podcast Now');
        expect(select).toHaveBeenCalledTimes(6);
    });

    it('resolves a Cyrillic channel by exact display-name (ASCII-only SQL LOWER would miss it)', async () => {
        const whereCalls: unknown[] = [];
        const select = jest
            .fn()
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls)) // 1 direct current
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls)) // 2 legacy current
            .mockReturnValueOnce(
                createSelectChain(
                    [{ id: '2407', displayName: 'Киноман', iconUrl: null }],
                    whereCalls
                )
            ) // 3 candidate lookup
            .mockReturnValueOnce(
                createLimitedSelectChain(
                    [
                        {
                            id: 1,
                            channelId: '2407',
                            start: '2026-06-29T23:10:00+03:00',
                            stop: '2026-06-30T00:50:00+03:00',
                            title: 'Зной',
                            description: null,
                            category: null,
                            iconUrl: null,
                            rating: null,
                            episodeNum: null,
                            sourceUrl: 'http://epg.it999.ru/epg2.xml',
                        },
                    ],
                    whereCalls
                )
            ); // 4 candidate current

        getDatabase.mockResolvedValue({ select });

        const result = await service.getCurrentProgramsBatch(['Киноман'], {
            sourceUrls: ['http://epg.it999.ru/epg2.xml'],
        });

        expect(result['Киноман']?.title).toBe('Зной');
        // The candidate lookup must include the RAW (non-lowercased) key so the
        // exact match works — a LOWER()-only query would never match 'Киноман'.
        const flattened = whereCalls.map((condition) => flattenSql(condition));
        expect(flattened.some((condition) => condition.includes('Киноман'))).toBe(
            true
        );
    });

    it('chunks the candidate lookup to bound SQL parameters for large batches', async () => {
        // Each candidate-lookup query binds every key up to 4× (raw/lower ×
        // id/displayName), so a large batch is split to stay under SQLite's
        // SQLITE_LIMIT_VARIABLE_NUMBER.
        const select = jest.fn(() => createSelectChain([], []));
        getDatabase.mockResolvedValue({ select });

        const ids = Array.from({ length: 600 }, (_, i) => `ch-${i}`);
        await service.getChannelMetadata(ids); // no sourceUrls → candidate lookup only

        // 600 unique keys → ceil(600 / 500) = 2 chunked candidate-lookup queries.
        expect(select).toHaveBeenCalledTimes(2);
    });

    it('scopes channel metadata by program source ownership for shared channels', async () => {
        const whereCalls: unknown[] = [];
        const select = jest.fn(() => createSelectChain([], whereCalls));

        getDatabase.mockResolvedValue({ select });

        await service.getChannelMetadata(['Shared Channel'], {
            sourceUrls: ['https://second.example.com/guide.xml'],
        });

        const metadataScopeSql = whereCalls.map((condition) =>
            flattenSql(condition)
        );

        expect(
            metadataScopeSql.some(
                (condition) =>
                    condition.includes('EXISTS') &&
                    condition.includes('channel_id') &&
                    condition.includes('source_url')
            )
        ).toBe(true);
    });

    it('resolves a manual mapping saved under any stream sharing the epg_channel_id via a single join', async () => {
        const whereCalls: unknown[] = [];
        const joinLimit = jest
            .fn()
            .mockResolvedValue([{ epgChannelId: 'BBC.MAPPED' }]);
        let innerJoinCount = 0;
        const joinChain: Record<string, jest.Mock> = {};
        joinChain.innerJoin = jest.fn(() => {
            innerJoinCount += 1;
            return joinChain;
        });
        joinChain.where = jest.fn((condition: unknown) => {
            whereCalls.push(condition);
            return { orderBy: jest.fn(() => ({ limit: joinLimit })) };
        });

        // Program lookup for the resolved (mapped) channel id.
        const programRow = {
            id: 1,
            channelId: 'BBC.MAPPED',
            start: '2026-06-21T17:00:00.000Z',
            stop: '2026-06-21T18:00:00.000Z',
            title: 'Mapped Programme',
            description: null,
            category: null,
            iconUrl: null,
            rating: null,
            episodeNum: null,
            sourceUrl: null,
        };

        const select = jest
            .fn()
            // getMapping direct lookup — miss.
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            // getMapping Xtream fallback — single join across content /
            // categories / mappings, no arbitrary candidate cap.
            .mockReturnValueOnce({ from: jest.fn(() => joinChain) })
            // selectChannelPrograms for the mapped id.
            .mockReturnValueOnce(createProgramChain([programRow]));

        getDatabase.mockResolvedValue({ select });

        const result = await service.getChannelPrograms('provider.epg.id');

        expect(innerJoinCount).toBe(2);
        expect(joinLimit).toHaveBeenCalledWith(1);
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Mapped Programme');
    });

    it('collapses duplicate programme slots from multiple sources in an unscoped lookup', async () => {
        const whereCalls: unknown[] = [];
        const dupRow = {
            id: 1,
            channelId: 'bbc.one.uk',
            start: '2026-06-21T20:00:00.000Z',
            stop: '2026-06-21T21:00:00.000Z',
            title: 'News',
            description: null,
            category: null,
            iconUrl: null,
            rating: null,
            episodeNum: null,
        };
        const select = jest
            .fn()
            // getMapping direct + Xtream fallback — both miss.
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            .mockReturnValueOnce({
                from: jest.fn(() => ({
                    innerJoin: jest.fn(function inner() {
                        return this;
                    }),
                    where: jest.fn(() => ({
                        orderBy: jest.fn(() => ({
                            limit: jest.fn().mockResolvedValue([]),
                        })),
                    })),
                })),
            })
            // selectChannelPrograms — two sources, same channel/start/title.
            // The SQL GROUP BY would collapse these; the mock returns both to
            // prove the JS safety-net dedup also holds.
            .mockReturnValueOnce(
                createProgramChain([
                    { ...dupRow, sourceUrl: 'https://a.example/g.xml' },
                    { ...dupRow, id: 2, sourceUrl: 'https://b.example/g.xml' },
                ])
            );

        getDatabase.mockResolvedValue({ select });

        const result = await service.getChannelPrograms('bbc.one.uk');

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('News');
    });
});
