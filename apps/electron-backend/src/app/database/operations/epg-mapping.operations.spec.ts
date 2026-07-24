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
const orMock = jest.fn((...conditions: unknown[]) => ({
    kind: 'or',
    conditions,
}));
const sqlMock = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
        kind: 'sql',
        strings: Array.from(strings),
        values,
    })
);

jest.mock('drizzle-orm', () => ({
    and: jest.fn(),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    inArray: (left: unknown, values: unknown[]) => inArrayMock(left, values),
    or: (...conditions: unknown[]) => orMock(...conditions),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
        sqlMock(strings, ...values),
}));

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    deleteEpgMapping,
    getEpgMapping,
    getEpgMappingsBatch,
    searchEpgChannels,
    setEpgMapping,
} from './epg-mapping.operations';

function createSelectChain(result: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain['from'] = jest.fn().mockReturnValue(chain);
    chain['where'] = jest.fn().mockReturnValue(chain);
    chain['orderBy'] = jest.fn().mockReturnValue(chain);
    chain['limit'] = jest.fn().mockResolvedValue(result);
    chain['then'] = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject);
    return chain;
}

function createDbMock(selectResult: unknown[] = []) {
    const chain = createSelectChain(selectResult);
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn().mockReturnValue({ values });
    const deleteWhere = jest.fn().mockResolvedValue(undefined);
    const deleteFn = jest.fn().mockReturnValue({ where: deleteWhere });
    const select = jest.fn().mockReturnValue(chain);

    return {
        db: {
            select,
            insert,
            delete: deleteFn,
        } as unknown as AppDatabase,
        chain,
        insert,
        values,
        onConflictDoUpdate,
        deleteFn,
        deleteWhere,
        select,
    };
}

describe('epg-mapping.operations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getEpgMapping', () => {
        it('returns the mapping row when present', async () => {
            const row = {
                id: 1,
                channelKey: 'xtream:pl-1:42',
                epgChannelId: 'bbc.one.uk',
                playlistId: 'pl-1',
            };
            const { db } = createDbMock([row]);

            await expect(getEpgMapping(db, 'xtream:pl-1:42')).resolves.toEqual(
                row
            );
            expect(eqMock).toHaveBeenCalledWith(
                schema.epgChannelMappings.channelKey,
                'xtream:pl-1:42'
            );
        });

        it('returns null when no mapping exists', async () => {
            const { db } = createDbMock([]);

            await expect(getEpgMapping(db, 'missing')).resolves.toBeNull();
        });
    });

    describe('getEpgMappingsBatch', () => {
        it('returns an empty map without querying for an empty input', async () => {
            const { db, select } = createDbMock();

            const result = await getEpgMappingsBatch(db, []);

            expect(result.size).toBe(0);
            expect(select).not.toHaveBeenCalled();
        });

        it('maps channel keys to their EPG channel ids', async () => {
            const { db } = createDbMock([
                { channelKey: 'a', epgChannelId: 'epg-a' },
                { channelKey: 'b', epgChannelId: 'epg-b' },
            ]);

            const result = await getEpgMappingsBatch(db, ['a', 'b', 'c']);

            expect(result.get('a')).toBe('epg-a');
            expect(result.get('b')).toBe('epg-b');
            expect(result.has('c')).toBe(false);
            expect(inArrayMock).toHaveBeenCalledWith(
                schema.epgChannelMappings.channelKey,
                ['a', 'b', 'c']
            );
        });
    });

    describe('setEpgMapping', () => {
        it('upserts on the channel key', async () => {
            const { db, insert, values, onConflictDoUpdate } = createDbMock();

            await expect(
                setEpgMapping(db, 'xtream:pl-1:42', 'bbc.one.uk', 'pl-1')
            ).resolves.toEqual({ success: true });

            expect(insert).toHaveBeenCalledWith(schema.epgChannelMappings);
            expect(values).toHaveBeenCalledWith({
                channelKey: 'xtream:pl-1:42',
                epgChannelId: 'bbc.one.uk',
                playlistId: 'pl-1',
            });
            expect(onConflictDoUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    target: schema.epgChannelMappings.channelKey,
                })
            );
        });

        it('stores null when no playlist id is provided', async () => {
            const { db, values } = createDbMock();

            await setEpgMapping(db, 'bbc.one', 'bbc.one.uk');

            expect(values).toHaveBeenCalledWith(
                expect.objectContaining({ playlistId: null })
            );
        });
    });

    describe('deleteEpgMapping', () => {
        it('deletes by channel key', async () => {
            const { db, deleteFn, deleteWhere } = createDbMock();

            await expect(deleteEpgMapping(db, 'bbc.one')).resolves.toEqual({
                success: true,
            });

            expect(deleteFn).toHaveBeenCalledWith(schema.epgChannelMappings);
            expect(deleteWhere).toHaveBeenCalled();
            expect(eqMock).toHaveBeenCalledWith(
                schema.epgChannelMappings.channelKey,
                'bbc.one'
            );
        });
    });

    describe('searchEpgChannels', () => {
        it('escapes LIKE wildcards and searches name and id with an ESCAPE clause', async () => {
            const { db } = createDbMock([]);

            await searchEpgChannels(db, 'HBO%_');

            // sql`${column} LIKE ${pattern} ESCAPE '\\'` — the pattern is the
            // second interpolated value.
            const patterns = sqlMock.mock.calls.map((call) => call[2]);
            expect(patterns).toContain('%HBO\\%\\_%');
            const templates = sqlMock.mock.calls.map((call) =>
                Array.from(call[0] as TemplateStringsArray).join('?')
            );
            expect(
                templates.every((template) => template.includes("ESCAPE '\\'"))
            ).toBe(true);
        });

        it('escapes backslashes so a trailing "\\" cannot corrupt the pattern', async () => {
            const { db } = createDbMock([]);

            await searchEpgChannels(db, 'C\\');

            const patterns = sqlMock.mock.calls.map((call) => call[2]);
            expect(patterns).toContain('%C\\\\%');
        });

        it('applies the result limit', async () => {
            const { db, chain } = createDbMock([]);

            await searchEpgChannels(db, 'news', 5);

            expect(chain['limit']).toHaveBeenCalledWith(5);
        });
    });
});
