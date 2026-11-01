import {
    beginCatalogHistoryRecovery,
    prepareLegacyCatalogHistoryRecovery,
    captureCatalogCacheRecoveryState,
    clearCatalogHistoryRecovery,
    completeCatalogHistoryRecovery,
    exportCatalogRecoveryState,
    readCatalogHistoryRecovery,
} from './xtream-catalog-history-recovery';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';
import { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';

const journal = {
    version: 1,
    contentTypes: ['movie'],
    recentlyViewed: [{ contentType: 'movie', xtreamId: 42, viewedAt: 'new' }],
};
const setup = () => ({
    getXtreamImportStatus: jest.fn().mockResolvedValue('completed'),
    readAppState: jest.fn(
        async (key: string): Promise<{ value: string | null } | null> => ({
            value: key.startsWith('xtream-category-visibility:')
                ? null
                : JSON.stringify(journal),
        })
    ),
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

const legacyState = (): XtreamPendingRestoreState => ({
    favorites: [],
    hiddenCategories: [],
    playbackPositions: [],
    preservePlaybackPositions: true,
    recentlyViewed: [
        { contentType: 'live', xtreamId: 1, viewedAt: 'old' },
        { contentType: 'movie', xtreamId: 2, viewedAt: 'pending' },
    ],
});

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it('seeds only unfinished older catalogs and deduplicates their pending/archive history', async () => {
    const db = setup();
    db.readAppState.mockResolvedValue({ value: null });
    db.getXtreamImportStatus.mockImplementation(async (_id, type) =>
        type === 'movie' ? 'failed' : 'completed'
    );
    localStorage.setItem(
        'xtream-catalog-restore-p',
        JSON.stringify({ version: 1, ...legacyState() })
    );
    const result = await prepareLegacyCatalogHistoryRecovery(
        db,
        new XtreamDeferredCatalogRestoreService(),
        'p',
        legacyState()
    );
    expect(result?.generation).toBe('legacy');
    expect(JSON.parse(db.setAppState.mock.calls[0][1]).recentlyViewed).toEqual(
        legacyState().recentlyViewed.slice(1)
    );
});

it('never claims a newer archive or reseeds a journal that already records removals', async () => {
    const db = setup();
    const deferred = new XtreamDeferredCatalogRestoreService();
    deferred.prepare('p', legacyState(), []);
    expect(
        await prepareLegacyCatalogHistoryRecovery(
            db,
            deferred,
            'p',
            legacyState()
        )
    ).toBeUndefined();
    expect(db.setAppState).not.toHaveBeenCalled();
    expect(db.getXtreamImportStatus).not.toHaveBeenCalled();
    const state = {
        ...legacyState(),
        catalogSnapshot: { key: 'owned', generation: 'owned' },
    };
    await prepareLegacyCatalogHistoryRecovery(db, deferred, 'p', state);
    expect(db.readAppState).toHaveBeenCalledTimes(1);
    await prepareLegacyCatalogHistoryRecovery(db, deferred, 'p', {
        ...legacyState(),
        preservePlaybackPositions: undefined,
    });
    expect(db.readAppState).toHaveBeenCalledTimes(1);
});

it('fails older recovery before import if the native journal cannot be read', async () => {
    const db = setup();
    db.readAppState.mockResolvedValue(null);
    await expect(
        prepareLegacyCatalogHistoryRecovery(
            db,
            new XtreamDeferredCatalogRestoreService(),
            'p',
            legacyState()
        )
    ).rejects.toThrow('Could not read');
    expect(db.setAppState).not.toHaveBeenCalled();
});

it('captures current visibility instead of resurrecting a parked hidden flag for an existing category', async () => {
    const db = setup();
    db.getAllXtreamCategories.mockImplementation(async (_id, type) =>
        type === 'movies'
            ? [{ type: 'movies', xtream_id: 2, hidden: false }]
            : []
    );
    const deferred = new XtreamDeferredCatalogRestoreService();
    deferred.prepare(
        'p',
        {
            ...legacyState(),
            hiddenCategories: [
                { categoryType: 'movies', xtreamId: 2 },
                { categoryType: 'series', xtreamId: 3 },
            ],
        },
        []
    );
    const result = await captureCatalogCacheRecoveryState(db, deferred, 'p', [
        'movie',
    ]);
    expect(result.state.hiddenCategories).toEqual([
        { categoryType: 'series', xtreamId: 3 },
    ]);
    expect(result.state.preservePlaybackPositions).toBe(true);
    expect(result.state.recentlyViewed).toEqual([]);
    expect(result.archivedHistory).toEqual(legacyState().recentlyViewed);
});

it.each(['failed', 'cancelled', 'idle'])(
    'keeps archived hidden flags when an incomplete %s catalog has leftover categories',
    async (status) => {
        const db = setup();
        db.getXtreamImportStatus.mockImplementation(async (_id, type) =>
            type === 'movie' ? status : 'completed'
        );
        db.getAllXtreamCategories.mockImplementation(async (_id, type) =>
            type === 'movies' ? [{ xtream_id: 2, hidden: false }] : []
        );
        const deferred = new XtreamDeferredCatalogRestoreService();
        deferred.prepare(
            'p',
            {
                ...legacyState(),
                hiddenCategories: [{ categoryType: 'movies', xtreamId: 2 }],
            },
            []
        );
        const captured = await captureCatalogCacheRecoveryState(
            db,
            deferred,
            'p',
            ['movie']
        );
        expect(captured.state.hiddenCategories).toEqual([
            { categoryType: 'movies', xtreamId: 2 },
        ]);
        const exported = await exportCatalogRecoveryState(
            db,
            { getAllPlaybackPositionsOrThrow: jest.fn().mockResolvedValue([]) },
            'p',
            captured.state.hiddenCategories
        );
        expect(exported.hiddenCategories).toEqual(
            captured.state.hiddenCategories
        );
    }
);

it('consumes native replay identities and later tombstones before acknowledgment while retaining absent history and hidden flags', async () => {
    const db = setup();
    const deferred = new XtreamDeferredCatalogRestoreService();
    const state = {
        ...legacyState(),
        recentlyViewed: [42, 43, 44].map((xtreamId) => ({
            contentType: 'movie' as const,
            xtreamId,
            viewedAt: 'saved',
        })),
        hiddenCategories: [{ categoryType: 'movies' as const, xtreamId: 2 }],
    };
    deferred.prepare('p', state, []);
    const snapshot = deferred.getSnapshot('p');
    db.getRecentItemsOrThrow.mockImplementation(async () => {
        // A removal after the live-row read must also consume its dormant copy.
        db.readAppState.mockImplementation(async (key) => ({
            value: key.startsWith('xtream-category-visibility:')
                ? null
                : JSON.stringify({
                      ...journal,
                      removed: [{ contentType: 'movie', xtreamId: 43 }],
                  }),
        }));
        return [{ type: 'movie', xtream_id: 42 }];
    });
    db.setAppState.mockImplementation(async (_key, value) => {
        expect(value).toBe('');
        expect(
            deferred
                .getSnapshot('p')
                .state.recentlyViewed.map((row) => row.xtreamId)
        ).toEqual([44]);
        return true;
    });
    await completeCatalogHistoryRecovery(db, deferred, 'p', snapshot, ['live']);
    expect(deferred.getSnapshot('p').state.hiddenCategories).toEqual(
        state.hiddenCategories
    );
    expect(db.getRecentItemsOrThrow).toHaveBeenCalledWith('p');
});

it('consumes all dormant history for a native clear without discarding hidden flags', async () => {
    const db = setup();
    db.readAppState.mockImplementation(async (key) => ({
        value: key.startsWith('xtream-category-visibility:')
            ? null
            : JSON.stringify({ ...journal, cleared: true }),
    }));
    const deferred = new XtreamDeferredCatalogRestoreService();
    deferred.prepare(
        'p',
        {
            ...legacyState(),
            hiddenCategories: [{ categoryType: 'movies', xtreamId: 2 }],
        },
        []
    );
    await completeCatalogHistoryRecovery(
        db,
        deferred,
        'p',
        deferred.getSnapshot('p'),
        []
    );
    expect(deferred.getSnapshot('p').state.recentlyViewed).toEqual([]);
    expect(deferred.getSnapshot('p').state.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 2 },
    ]);
});

it('retains native recovery if live history or deferred completion cannot be saved', async () => {
    const db = setup();
    const deferred = new XtreamDeferredCatalogRestoreService();
    deferred.prepare('p', legacyState(), []);
    const snapshot = deferred.getSnapshot('p');
    db.getRecentItemsOrThrow.mockRejectedValueOnce(
        new Error('history unavailable')
    );
    await expect(
        completeCatalogHistoryRecovery(db, deferred, 'p', snapshot, ['live'])
    ).rejects.toThrow('history unavailable');
    expect(deferred.getSnapshot('p').raw).toBe(snapshot.raw);
    expect(db.setAppState).not.toHaveBeenCalled();
    jest.spyOn(deferred, 'complete').mockImplementationOnce(() => {
        throw new Error('archive unavailable');
    });
    await expect(
        completeCatalogHistoryRecovery(db, deferred, 'p', snapshot, ['live'])
    ).rejects.toThrow('archive unavailable');
    expect(db.setAppState).not.toHaveBeenCalled();
    db.readAppState.mockResolvedValue({ value: null });
    await expect(
        completeCatalogHistoryRecovery(db, deferred, 'p', snapshot, ['live'])
    ).rejects.toThrow('Catalog history recovery is unavailable');
    expect(db.setAppState).not.toHaveBeenCalled();
});

it('retains authoritative post-clear history for missing rows instead of erasing new watches', async () => {
    const db = setup();
    const deferred = new XtreamDeferredCatalogRestoreService();
    const watched = [
        { contentType: 'movie' as const, xtreamId: 2, viewedAt: 'post-clear' },
        { contentType: 'movie' as const, xtreamId: 5, viewedAt: 'new-watch' },
    ];
    deferred.prepare(
        'p',
        {
            ...legacyState(),
            recentlyViewed: [
                ...watched.map((row) => ({ ...row, viewedAt: 'older' })),
                { contentType: 'movie', xtreamId: 3, viewedAt: 'before-clear' },
            ],
            hiddenCategories: [{ categoryType: 'movies', xtreamId: 2 }],
        },
        []
    );
    db.readAppState.mockImplementation(async (key) => ({
        value: key.startsWith('xtream-category-visibility:')
            ? null
            : JSON.stringify({
                  ...journal,
                  recentlyViewed: watched,
                  cleared: true,
              }),
    }));
    await completeCatalogHistoryRecovery(
        db,
        deferred,
        'p',
        deferred.getSnapshot('p'),
        []
    );
    expect(deferred.getSnapshot('p').state.recentlyViewed).toEqual(watched);
    expect(deferred.getSnapshot('p').state.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 2 },
    ]);
});

it('consumes only actual authoritative categories after cache replay, keeping absent same-type choices', async () => {
    const db = setup();
    const deferred = new XtreamDeferredCatalogRestoreService();
    const state = {
        ...legacyState(),
        recentlyViewed: [],
        hiddenCategories: [2, 9].map((xtreamId) => ({
            categoryType: 'movies' as const,
            xtreamId,
        })),
    };
    const prepared = deferred.prepare('p', state, ['movie']);
    db.getAllXtreamCategories.mockImplementation(async (_id, type) =>
        type === 'movies'
            ? [{ type: 'movies', xtream_id: 2, hidden: true }]
            : []
    );
    await completeCatalogHistoryRecovery(db, deferred, 'p', prepared.snapshot, [
        'movie',
    ]);
    expect(deferred.getSnapshot('p').state.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 9 },
    ]);
    expect(db.setAppState).toHaveBeenLastCalledWith(
        'xtream-history-recovery:p',
        ''
    );
});
