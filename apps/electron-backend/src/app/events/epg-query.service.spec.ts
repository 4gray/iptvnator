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
            .mockReturnValueOnce(createSelectChain([], whereCalls))
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls))
            .mockReturnValueOnce(createLimitedSelectChain([], whereCalls));

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
