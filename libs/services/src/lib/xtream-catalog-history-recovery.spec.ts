import {
    beginCatalogHistoryRecovery,
    clearCatalogHistoryRecovery,
    exportCatalogRecoveryState,
    readCatalogHistoryRecovery,
} from './xtream-catalog-history-recovery';

const journal = {
    version: 1,
    contentTypes: ['movie'],
    recentlyViewed: [{ contentType: 'movie', xtreamId: 42, viewedAt: 'new' }],
};
const setup = () => ({
    readAppState: jest
        .fn()
        .mockResolvedValue({ value: JSON.stringify(journal) }),
    setAppState: jest.fn().mockResolvedValue(true),
    getRecentItemsOrThrow: jest.fn().mockResolvedValue([]),
    getAllXtreamCategories: jest.fn().mockResolvedValue([]),
});

it('reads native ownership strictly instead of treating failed storage as absence', async () => {
    const db = setup();
    await expect(readCatalogHistoryRecovery(db, 'p')).resolves.toEqual(journal);
    expect(db.readAppState).toHaveBeenCalledWith('xtream-history-recovery:p');
    db.readAppState.mockResolvedValueOnce(null);
    await expect(readCatalogHistoryRecovery(db, 'p')).rejects.toThrow(
        'Could not read'
    );
    db.readAppState.mockResolvedValueOnce({ value: '{' });
    await expect(readCatalogHistoryRecovery(db, 'p')).rejects.toThrow();
    db.readAppState.mockResolvedValueOnce({ value: null });
    await expect(readCatalogHistoryRecovery(db, 'p')).resolves.toBeNull();
});

it('registers typed archival history and fails closed for rejected registration or acknowledgement', async () => {
    const db = setup();
    await beginCatalogHistoryRecovery(db, 'p', ['movie'], []);
    expect(JSON.parse(db.setAppState.mock.calls[0][1])).toEqual({
        version: 1,
        contentTypes: ['movie'],
        recentlyViewed: [],
    });
    await clearCatalogHistoryRecovery(db, 'p');
    expect(db.setAppState).toHaveBeenLastCalledWith(
        'xtream-history-recovery:p',
        ''
    );
    db.setAppState.mockResolvedValue(false);
    await expect(
        beginCatalogHistoryRecovery(db, 'p', ['movie'], [])
    ).rejects.toThrow('Could not retain');
    await expect(clearCatalogHistoryRecovery(db, 'p')).rejects.toThrow(
        'Could not finish'
    );
});

it('exports current native history and positions, with complete live fallback after acknowledgement', async () => {
    const db = setup();
    const positions = {
        getAllPlaybackPositionsOrThrow: jest
            .fn()
            .mockResolvedValue([{ contentXtreamId: 42, positionSeconds: 22 }]),
    };
    const exported = await exportCatalogRecoveryState(db, positions, 'p');
    expect(exported.recentlyViewed).toEqual(journal.recentlyViewed);
    expect(exported.historyRecovery).toEqual({
        ...journal,
        currentCategories: [],
    });
    expect(exported.playbackPositions[0].positionSeconds).toBe(22);
    expect(db.getRecentItemsOrThrow).not.toHaveBeenCalled();
    db.readAppState.mockResolvedValue({ value: null });
    db.getRecentItemsOrThrow.mockResolvedValue(
        Array.from({ length: 105 }, (_, xtream_id) => ({
            type: 'movie',
            xtream_id,
            viewed_at: null,
        }))
    );
    const fallback = await exportCatalogRecoveryState(db, positions, 'p');
    expect(fallback.recentlyViewed).toHaveLength(105);
    expect(fallback.recentlyViewed[104]).toEqual({
        contentType: 'movie',
        xtreamId: 104,
        viewedAt: expect.any(String),
    });
    expect(fallback.historyRecovery).toEqual({
        contentTypes: [],
        currentCategories: [],
    });
    positions.getAllPlaybackPositionsOrThrow.mockRejectedValue(
        new Error('positions unavailable')
    );
    await expect(
        exportCatalogRecoveryState(db, positions, 'p')
    ).rejects.toThrow('positions unavailable');
});

it('exports live category edits while retaining hidden choices for categories still absent', async () => {
    const db = setup();
    db.getAllXtreamCategories.mockImplementation(async (_id, type) =>
        type === 'movies'
            ? [
                  { xtream_id: 2, hidden: false },
                  { xtream_id: 3, hidden: true },
              ]
            : []
    );
    const positions = {
        getAllPlaybackPositionsOrThrow: jest.fn().mockResolvedValue([]),
    };
    const exported = await exportCatalogRecoveryState(db, positions, 'p', [
        { categoryType: 'movies', xtreamId: 2 },
        { categoryType: 'movies', xtreamId: 9 },
    ]);
    expect(exported.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 9 },
        { categoryType: 'movies', xtreamId: 3 },
    ]);
});
