import type Database from 'better-sqlite3';
import { SqliteFavoriteLocalStore } from '@iptvnator/shared/database/favorites-sync';
import {
    emptyFavoriteState,
    type FavoriteAddress,
    type FavoriteLocalRecord,
    type FavoriteLocalRequest,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { favoriteLocalOperation } from './favorites-local.operations';

jest.mock('@iptvnator/shared/database/favorites-sync', () => ({
    SqliteFavoriteLocalStore: jest.fn(),
}));
const address: FavoriteAddress = {
    instanceId: 'synthetic-nas',
    scope: 'shared',
    sourceId: 'synthetic-source',
    sourceIncarnation: 'synthetic-generation',
    content: { provider: 'xtream', kind: 'movie', id: '42' },
};
const database = {} as Database.Database;
const record: FavoriteLocalRecord = {
    state: emptyFavoriteState(),
    base: emptyFavoriteState(),
    pending: [],
};

describe('favorite worker IPC boundary', () => {
    const read = jest.fn(async (_address: FavoriteAddress) => record);
    const entries = jest.fn(async (_sourceId: string) => [{ address, record }]);
    const pending = jest.fn(async () => []);
    const mutate = jest.fn(
        async (
            _address: FavoriteAddress,
            update: (current: FavoriteLocalRecord | null) => FavoriteLocalRecord
        ) => update(record)
    );
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(SqliteFavoriteLocalStore).mockImplementation(
            () =>
                ({
                    read,
                    entries,
                    pending,
                    mutate,
                }) as unknown as SqliteFavoriteLocalStore
        );
    });
    it.each(['read', 'list', 'pending'] as const)(
        'forwards a profile-bound %s request to the transactional store',
        async (operation) => {
            const request = {
                operation,
                instanceId: address.instanceId,
                address,
                sourceId: address.sourceId,
            } as FavoriteLocalRequest;
            const result = await favoriteLocalOperation(database, request);
            expect(SqliteFavoriteLocalStore).toHaveBeenCalledWith(
                database,
                address.instanceId
            );
            if (operation === 'read') {
                expect(read).toHaveBeenCalledWith(address);
                expect(result).toEqual(record);
            } else if (operation === 'list') {
                expect(entries).toHaveBeenCalledWith(address.sourceId);
                expect(result).toEqual([{ address, record }]);
            } else {
                expect(pending).toHaveBeenCalled();
                expect(result).toEqual([]);
            }
        }
    );
    it('commits only against the captured record and reports sibling-window contention', async () => {
        const value = { ...record, state: { ...record.state, revision: 1 } };
        const request: FavoriteLocalRequest = {
            operation: 'commit',
            instanceId: address.instanceId,
            address,
            expected: JSON.stringify(record),
            value,
        };
        await expect(
            favoriteLocalOperation(database, request)
        ).resolves.toEqual({ value });
        await expect(
            favoriteLocalOperation(database, { ...request, expected: null })
        ).resolves.toEqual({ conflict: true });
        mutate.mockImplementationOnce(async (_address, update) => update(null));
        await expect(
            favoriteLocalOperation(database, { ...request, expected: null })
        ).resolves.toEqual({ value });
    });
    it('redacts storage failures while preserving the distinction from contention', async () => {
        mutate.mockRejectedValueOnce(
            new Error('Synthetic internal storage detail')
        );
        await expect(
            favoriteLocalOperation(database, {
                operation: 'commit',
                instanceId: address.instanceId,
                address,
                expected: JSON.stringify(record),
                value: record,
            })
        ).rejects.toThrow(/^Favorite storage failed$/);
    });
    it('rejects invalid profile identifiers and arbitrary operations', async () => {
        await expect(
            favoriteLocalOperation(database, {
                operation: 'pending',
                instanceId: ' ',
            })
        ).rejects.toThrow('Invalid activity identifier');
        expect(SqliteFavoriteLocalStore).not.toHaveBeenCalled();
        await expect(
            favoriteLocalOperation(database, {
                operation: 'arbitrary-sql',
                instanceId: address.instanceId,
                address,
            } as unknown as FavoriteLocalRequest)
        ).rejects.toThrow('Invalid favorite storage operation');
    });
});
