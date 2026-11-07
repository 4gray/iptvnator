import type Database from 'better-sqlite3';
import { SqliteHistoryLocalStore } from '@iptvnator/shared/database/history-sync';
import {
    emptyHistoryRecord,
    type HistoryScope,
    type HistoryRecord,
    type HistoryLocalRequest,
} from '@iptvnator/shared/interfaces/history-sync';
import { historyLocalOperation } from './history-local.operations';

jest.mock('@iptvnator/shared/database/history-sync', () => ({
    SqliteHistoryLocalStore: jest.fn(),
}));
const scope: HistoryScope = {
    instanceId: 'synthetic-nas',
    sourceId: 'synthetic-source',
    sourceIncarnation: 'first',
    provider: 'xtream',
};
const database = {} as Database.Database;
const current = emptyHistoryRecord();
const read = jest.fn(async () => current);
const mutate = jest.fn(
    async (
        _scope: HistoryScope,
        update: (current: HistoryRecord | null) => HistoryRecord
    ) => update(current)
);
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(SqliteHistoryLocalStore).mockImplementation(
        () => ({ read, mutate }) as unknown as SqliteHistoryLocalStore
    );
});

it('reads only a matching profile and rejects malformed operations before mutating', async () => {
    await expect(
        historyLocalOperation(database, {
            scope,
            instanceId: scope.instanceId,
            operation: 'read',
        })
    ).resolves.toEqual(current);
    expect(read).toHaveBeenCalledWith(scope);
    await expect(
        historyLocalOperation(database, {
            scope,
            instanceId: 'synthetic-other',
            operation: 'read',
        })
    ).rejects.toThrow('profile mismatch');
    await expect(
        historyLocalOperation(database, {
            scope,
            instanceId: scope.instanceId,
            operation: 'synthetic-invalid',
        } as never)
    ).rejects.toThrow('Invalid history storage request');
    expect(mutate).not.toHaveBeenCalled();
});

it('reports stale CAS without discarding the sibling record, including an initial empty baseline', async () => {
    const request: HistoryLocalRequest = {
        scope,
        instanceId: scope.instanceId,
        operation: 'commit',
        expected: JSON.stringify(current),
        value: { ...current, hideArchive: true },
    };
    await expect(historyLocalOperation(database, request)).resolves.toEqual({
        value: request.value,
    });
    await expect(
        historyLocalOperation(database, { ...request, expected: null })
    ).resolves.toEqual({ conflict: true });
    mutate.mockImplementationOnce(async (_scope, update) => update(null));
    await expect(
        historyLocalOperation(database, { ...request, expected: null })
    ).resolves.toEqual({ value: request.value });
});

it('redacts transactional errors rather than exposing storage payloads', async () => {
    mutate.mockRejectedValueOnce(new Error('Synthetic private storage detail'));
    await expect(
        historyLocalOperation(database, {
            scope,
            instanceId: scope.instanceId,
            operation: 'commit',
            expected: null,
            value: current,
        })
    ).rejects.toThrow('History storage failed');
});
