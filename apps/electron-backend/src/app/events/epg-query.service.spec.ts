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
    const limit = jest.fn().mockResolvedValue(limitResult);
    const where = jest.fn((condition: unknown) => {
        whereCalls.push(condition);
        return { limit };
    });
    return {
        from: jest.fn(() => ({ where })),
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
});
