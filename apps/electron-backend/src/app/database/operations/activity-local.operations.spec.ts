import type Database from 'better-sqlite3';
import { SqliteActivityLocalStore } from '@iptvnator/shared/database/activity-sync';
import {
    emptyActivityState,
    type ActivityAddress,
    type ActivityLocalRecord,
    type ActivityLocalRequest,
} from '@iptvnator/shared/interfaces/activity-sync';
import { activityLocalOperation } from './activity-local.operations';

jest.mock('@iptvnator/shared/database/activity-sync', () => ({
    SqliteActivityLocalStore: jest.fn(),
}));
const address: ActivityAddress = {
    instanceId: 'synthetic-nas',
    scope: 'shared',
    sourceId: 'synthetic-source',
    sourceIncarnation: 'synthetic-generation',
    content: { provider: 'xtream', kind: 'vod', id: '42' },
};
const database = {} as Database.Database;
const record: ActivityLocalRecord = {
    state: emptyActivityState(),
    pending: [],
};

describe('activity worker IPC boundary', () => {
    const read = jest.fn(async (_address: ActivityAddress) => record);
    const entries = jest.fn(async (_sourceId: string) => [{ address, record }]);
    const pending = jest.fn(async () => []);
    const mutate = jest.fn(
        async (
            _address: ActivityAddress,
            update: (current: ActivityLocalRecord | null) => ActivityLocalRecord
        ) => update(record)
    );
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(SqliteActivityLocalStore).mockImplementation(
            () =>
                ({
                    read,
                    entries,
                    pending,
                    mutate,
                }) as unknown as SqliteActivityLocalStore
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
            } as ActivityLocalRequest;
            const result = await activityLocalOperation(database, request);
            expect(SqliteActivityLocalStore).toHaveBeenCalledWith(
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
        const request: ActivityLocalRequest = {
            operation: 'commit',
            instanceId: address.instanceId,
            address,
            expected: JSON.stringify(record),
            value,
        };
        await expect(
            activityLocalOperation(database, request)
        ).resolves.toEqual({ value });
        await expect(
            activityLocalOperation(database, { ...request, expected: null })
        ).resolves.toEqual({ conflict: true });
        mutate.mockImplementationOnce(async (_address, update) => update(null));
        await expect(
            activityLocalOperation(database, { ...request, expected: null })
        ).resolves.toEqual({ value });
    });
    it('redacts storage failures while preserving the distinction from contention', async () => {
        mutate.mockRejectedValueOnce(
            new Error('Synthetic internal storage detail')
        );
        await expect(
            activityLocalOperation(database, {
                operation: 'commit',
                instanceId: address.instanceId,
                address,
                expected: JSON.stringify(record),
                value: record,
            })
        ).rejects.toThrow(/^Activity storage failed$/);
    });
    it('rejects invalid profile identifiers and arbitrary operations', async () => {
        await expect(
            activityLocalOperation(database, {
                operation: 'pending',
                instanceId: ' ',
            })
        ).rejects.toThrow('Invalid activity identifier');
        expect(SqliteActivityLocalStore).not.toHaveBeenCalled();
        await expect(
            activityLocalOperation(database, {
                operation: 'arbitrary-sql',
                instanceId: address.instanceId,
                address,
            } as unknown as ActivityLocalRequest)
        ).rejects.toThrow('Invalid activity storage operation');
    });
});
