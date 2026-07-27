const getDatabase = jest.fn();
const getEpgMapping = jest.fn();
const getEpgMappingsBatch = jest.fn();
const setEpgMapping = jest.fn();
const deleteEpgMapping = jest.fn();
const searchEpgChannels = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

jest.mock('../database/operations/epg-mapping.operations', () => ({
    getEpgMapping: (...args: unknown[]) => getEpgMapping(...args),
    getEpgMappingsBatch: (...args: unknown[]) => getEpgMappingsBatch(...args),
    setEpgMapping: (...args: unknown[]) => setEpgMapping(...args),
    deleteEpgMapping: (...args: unknown[]) => deleteEpgMapping(...args),
    searchEpgChannels: (...args: unknown[]) => searchEpgChannels(...args),
}));

import {
    handleDeleteEpgMapping,
    handleGetEpgMapping,
    handleGetEpgMappingsBatch,
    handleSearchEpgChannels,
    handleSetEpgMapping,
    queryByResolvedChannelIds,
    resolveChannelIds,
} from './epg-mapping.service';

const DB_HANDLE = { db: true };
const DB_ERROR = new Error('getDatabase failed');
const OP_ERROR = new Error('sqlite operation failed');

describe('epg-mapping.service', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        getDatabase.mockResolvedValue(DB_HANDLE);
    });

    /**
     * The fail-soft contract: a mapping lookup must never take down an EPG IPC
     * request. Each entry is checked against BOTH failure modes — a rejecting
     * `getDatabase()` and a rejecting database operation.
     */
    const failSoftCases: Array<{
        name: string;
        operation: jest.Mock;
        invoke: () => Promise<unknown>;
        fallback: unknown;
    }> = [
        {
            name: 'resolveChannelIds',
            operation: getEpgMappingsBatch,
            invoke: () => resolveChannelIds(['channel-a']),
            fallback: new Map(),
        },
        {
            name: 'handleGetEpgMapping',
            operation: getEpgMapping,
            invoke: () => handleGetEpgMapping('channel-a'),
            fallback: null,
        },
        {
            name: 'handleGetEpgMappingsBatch',
            operation: getEpgMappingsBatch,
            invoke: () => handleGetEpgMappingsBatch(['channel-a']),
            fallback: {},
        },
        {
            name: 'handleSetEpgMapping',
            operation: setEpgMapping,
            invoke: () => handleSetEpgMapping('channel-a', 'epg-a'),
            fallback: { success: false },
        },
        {
            name: 'handleDeleteEpgMapping',
            operation: deleteEpgMapping,
            invoke: () => handleDeleteEpgMapping('channel-a'),
            fallback: { success: false },
        },
        {
            name: 'handleSearchEpgChannels',
            operation: searchEpgChannels,
            invoke: () => handleSearchEpgChannels('bbc'),
            fallback: [],
        },
    ];

    for (const { name, operation, invoke, fallback } of failSoftCases) {
        describe(`${name} fail-soft`, () => {
            it('returns the fallback when getDatabase() rejects', async () => {
                getDatabase.mockRejectedValue(DB_ERROR);

                await expect(invoke()).resolves.toEqual(fallback);
                expect(operation).not.toHaveBeenCalled();
            });

            it('returns the fallback when the database operation rejects', async () => {
                operation.mockRejectedValue(OP_ERROR);

                await expect(invoke()).resolves.toEqual(fallback);
                expect(operation).toHaveBeenCalled();
            });
        });
    }

    describe('resolveChannelIds', () => {
        it('returns the mapping batch keyed by original channel id', async () => {
            const mappings = new Map([['channel-a', 'epg-a']]);
            getEpgMappingsBatch.mockResolvedValue(mappings);

            await expect(resolveChannelIds(['channel-a'])).resolves.toEqual(
                mappings
            );
            expect(getEpgMappingsBatch).toHaveBeenCalledWith(DB_HANDLE, [
                'channel-a',
            ]);
        });
    });

    describe('queryByResolvedChannelIds', () => {
        it('queries mapped ids and remaps results onto the requested ids', async () => {
            getEpgMappingsBatch.mockResolvedValue(
                new Map([['channel-a', 'epg-a']])
            );
            const query = jest
                .fn()
                .mockResolvedValue({ 'epg-a': 'A', 'channel-b': 'B' });

            const result = await queryByResolvedChannelIds(
                ['channel-a', 'channel-b'],
                query
            );

            expect(query).toHaveBeenCalledWith(['epg-a', 'channel-b']);
            expect(result).toEqual({ 'channel-a': 'A', 'channel-b': 'B' });
        });

        it('fills missing query results with null', async () => {
            getEpgMappingsBatch.mockResolvedValue(new Map());
            const query = jest.fn().mockResolvedValue({});

            await expect(
                queryByResolvedChannelIds(['channel-a'], query)
            ).resolves.toEqual({ 'channel-a': null });
        });

        it('falls back to unmapped ids when the mapping lookup fails', async () => {
            getEpgMappingsBatch.mockRejectedValue(OP_ERROR);
            const query = jest.fn().mockResolvedValue({ 'channel-a': 'A' });

            const result = await queryByResolvedChannelIds(
                ['channel-a'],
                query
            );

            expect(query).toHaveBeenCalledWith(['channel-a']);
            expect(result).toEqual({ 'channel-a': 'A' });
        });
    });

    describe('handleGetEpgMappingsBatch', () => {
        it('converts the mapping batch into a plain record', async () => {
            getEpgMappingsBatch.mockResolvedValue(
                new Map([['channel-a', 'epg-a']])
            );

            await expect(
                handleGetEpgMappingsBatch(['channel-a'])
            ).resolves.toEqual({ 'channel-a': 'epg-a' });
        });

        it.each([
            ['an empty array', [] as string[]],
            ['a non-array value', undefined as unknown as string[]],
        ])(
            'short-circuits for %s without touching the database',
            async (_label, channelKeys) => {
                await expect(
                    handleGetEpgMappingsBatch(channelKeys)
                ).resolves.toEqual({});
                expect(getDatabase).not.toHaveBeenCalled();
            }
        );
    });

    describe('handleSearchEpgChannels', () => {
        it('forwards the search term and limit to the database', async () => {
            const matches = [
                { id: 'epg-a', displayName: 'BBC One', iconUrl: null },
            ];
            searchEpgChannels.mockResolvedValue(matches);

            await expect(handleSearchEpgChannels('bbc', 25)).resolves.toEqual(
                matches
            );
            expect(searchEpgChannels).toHaveBeenCalledWith(
                DB_HANDLE,
                'bbc',
                25
            );
        });

        it.each([
            ['an empty term', ''],
            ['a whitespace-only term', '   '],
            ['an undefined term', undefined as unknown as string],
        ])(
            'short-circuits for %s without touching the database',
            async (_label, searchTerm) => {
                await expect(
                    handleSearchEpgChannels(searchTerm)
                ).resolves.toEqual([]);
                expect(getDatabase).not.toHaveBeenCalled();
            }
        );
    });

    describe('mapping writes', () => {
        it('passes the optional playlist id through to setEpgMapping', async () => {
            setEpgMapping.mockResolvedValue({ success: true });

            await expect(
                handleSetEpgMapping('channel-a', 'epg-a', 'playlist-1')
            ).resolves.toEqual({ success: true });
            expect(setEpgMapping).toHaveBeenCalledWith(
                DB_HANDLE,
                'channel-a',
                'epg-a',
                'playlist-1'
            );
        });

        it('deletes a mapping by channel key', async () => {
            deleteEpgMapping.mockResolvedValue({ success: true });

            await expect(handleDeleteEpgMapping('channel-a')).resolves.toEqual({
                success: true,
            });
            expect(deleteEpgMapping).toHaveBeenCalledWith(
                DB_HANDLE,
                'channel-a'
            );
        });
    });
});
