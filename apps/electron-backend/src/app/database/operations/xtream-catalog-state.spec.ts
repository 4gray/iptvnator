import { createDbMock } from './operations.test-helpers';
import { updatePlaylist } from './playlist.operations';
import { setXtreamStartupRefreshDate } from './xtream-catalog-state';

const condition = {
    playlistId: 'synthetic-source',
    serverUrl: 'https://portal.example.test',
    username: 'synthetic-user',
    password: 'synthetic-password',
    previousUpdateDate: null,
};
const current = {
    id: condition.playlistId,
    type: 'xtream',
    serverUrl: condition.serverUrl,
    username: condition.username,
    password: condition.password,
    autoRefresh: true,
    updateDate: null,
    lastUpdated: null,
    payload: JSON.stringify({ xtreamContentTypes: ['live'] }),
};
const updatedAt = '2026-01-01T00:00:00.000Z';
const timestamp = Date.parse(updatedAt);

it('applies only the date columns in the native conditional update', async () => {
    const { db, transaction, updateRun, updateSet } = createDbMock([
        [current],
        [current],
    ]);
    await expect(
        updatePlaylist(
            db,
            condition.playlistId,
            { updateDate: timestamp, autoRefresh: false },
            condition
        )
    ).resolves.toEqual({ success: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({
        updateDate: timestamp,
        lastUpdated: updatedAt,
    });
    expect(updateRun).toHaveBeenCalledTimes(1);
});

it('compares the old projected date when a legacy source only has lastUpdated', () => {
    const lastUpdated = '2025-12-31T00:00:00.000Z';
    const legacy = {
        ...current,
        autoRefresh: null,
        lastUpdated,
        payload: JSON.stringify({ autoRefresh: true }),
    };
    const { db } = createDbMock([[legacy], [legacy]]);
    expect(
        setXtreamStartupRefreshDate(db, timestamp, {
            ...condition,
            previousUpdateDate: Date.parse(lastUpdated),
        })
    ).toEqual({ success: true });
});

it.each([
    { ...current, password: 'synthetic-changed' },
    { ...current, autoRefresh: false },
    { ...current, updateDate: timestamp + 1 },
    { ...current, payload: JSON.stringify({ xtreamContentTypes: ['movie'] }) },
])('skips the date update when a source setting no longer matches', (row) => {
    const { db, updateRun } = createDbMock([[row], [row]]);
    expect(setXtreamStartupRefreshDate(db, timestamp, condition)).toEqual({
        success: false,
    });
    expect(updateRun).not.toHaveBeenCalled();
});

it('declines a condition addressed to a different source', async () => {
    const { db, transaction } = createDbMock();
    await expect(
        updatePlaylist(
            db,
            'synthetic-other',
            { updateDate: timestamp },
            condition
        )
    ).resolves.toEqual({ success: false });
    expect(transaction).not.toHaveBeenCalled();
});

it('rejects an invalid timestamp before opening a transaction', () => {
    const { db, transaction } = createDbMock();
    expect(() => setXtreamStartupRefreshDate(db, NaN, condition)).toThrow(
        'Invalid Xtream refresh timestamp'
    );
    expect(transaction).not.toHaveBeenCalled();
});
