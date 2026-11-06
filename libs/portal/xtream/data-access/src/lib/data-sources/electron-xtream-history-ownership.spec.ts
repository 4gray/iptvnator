import { TestBed } from '@angular/core/testing';
import {
    XtreamDeferredCatalogRestoreService,
    captureCatalogCacheRecoveryState,
    completeCatalogHistoryRecovery,
} from '@iptvnator/services/xtream-catalog-restore';
import type { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';
import { setupElectronXtreamDataSource } from './electron-xtream-data-source.test-helpers';

const playlistId = 'synthetic-source';
const history = [
    { contentType: 'movie' as const, xtreamId: 771001, viewedAt: '2026-01-01' },
];
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());
function setup() {
    const harness = setupElectronXtreamDataSource();
    const deferred = TestBed.inject(XtreamDeferredCatalogRestoreService);
    const original = deferred.getSnapshot(playlistId);
    const pending: XtreamPendingRestoreState = {
        favorites: [],
        hiddenCategories: [],
        playbackPositions: [],
        recentlyViewed: [],
        preservePlaybackPositions: true,
        catalogSnapshot: { key: original.key, generation: original.generation },
    };
    let journal = JSON.stringify({
        version: 1,
        contentTypes: ['movie'],
        recentlyViewed: history,
        resolved: history,
    });
    harness.dbService.readAppState.mockImplementation(async (key) => ({
        value: key.startsWith('xtream-history-recovery:') ? journal : null,
    }));
    harness.dbService.setAppState.mockImplementation(async (_key, value) => {
        if (!value) journal = '';
        return true;
    });
    harness.dbService.getXtreamImportStatus.mockResolvedValue('completed');
    return {
        ...harness,
        deferred,
        original,
        pending,
        setJournal: (value: object) => {
            journal = JSON.stringify(value);
        },
    };
}

it('retains live native history absent from an edit-time replacement before clearing its journal', async () => {
    const { dbService, deferred } = setup();
    const captured = await captureCatalogCacheRecoveryState(
        dbService,
        deferred,
        playlistId,
        ['movie']
    );
    // Registration captures the watch, but the replacement provider omits its content.
    dbService.readAppState.mockImplementation(async (key) => ({
        value: key.startsWith('xtream-history-recovery:')
            ? JSON.stringify({
                  version: 1,
                  contentTypes: ['movie'],
                  recentlyViewed: history,
                  resolved: [],
              })
            : null,
    }));
    await completeCatalogHistoryRecovery(
        dbService,
        deferred,
        playlistId,
        captured.snapshot,
        ['movie']
    );
    expect(
        deferred.forExport(playlistId, {
            hiddenCategories: [],
            recentlyViewed: [],
        }).recentlyViewed
    ).toEqual(history);
});

it.each(['replay', 'acknowledgment'] as const)(
    'keeps ownership across a failed %s when recovery starts without a dormant record',
    async (failure) => {
        const { dataSource, dbService, deferred, pending } = setup();
        if (failure === 'replay')
            dbService.restoreXtreamUserData.mockRejectedValueOnce(
                new Error('Synthetic replay failure')
            );
        else {
            const save = dbService.setAppState.getMockImplementation();
            if (!save) throw new Error('Synthetic storage mock is absent.');
            let rejected = false;
            dbService.setAppState.mockImplementation(async (key, value) => {
                if (!value && !rejected) {
                    rejected = true;
                    return false;
                }
                return save(key, value);
            });
        }
        await expect(
            dataSource.restoreUserData(playlistId, pending)
        ).rejects.toThrow();
        dbService.getRecentItemsOrThrow.mockResolvedValue(
            history.map((row) => ({
                type: row.contentType,
                xtream_id: row.xtreamId,
            }))
        );
        await dataSource.restoreUserData(playlistId, pending);
        // A subsequent native removal must not expose an older dormant duplicate.
        expect(
            deferred.forExport(playlistId, {
                hiddenCategories: [],
                recentlyViewed: [],
            }).recentlyViewed
        ).toEqual([]);
    }
);

it('cannot consume or acknowledge a genuinely newer explicit archive during an old retry', async () => {
    const { dataSource, dbService, deferred, pending } = setup();
    dbService.restoreXtreamUserData.mockRejectedValueOnce(
        new Error('Synthetic replay failure')
    );
    await expect(
        dataSource.restoreUserData(playlistId, pending)
    ).rejects.toThrow();
    const fresh = {
        ...pending,
        preservePlaybackPositions: undefined,
        catalogSnapshot: undefined,
        favoritesRestoreId: 'synthetic-new-archive',
        recentlyViewed: [{ ...history[0], xtreamId: 771002 }],
    };
    deferred.prepare(playlistId, fresh, []);
    dbService.setAppState.mockClear();
    await dataSource.restoreUserData(playlistId, pending);
    expect(deferred.getSnapshot(playlistId).state.recentlyViewed).toEqual(
        fresh.recentlyViewed
    );
    expect(
        dbService.setAppState.mock.calls.filter(([, value]) => value === '')
    ).toEqual([]);
});

it('keeps ownership when a partial completion is parked but acknowledgment fails before another missing row reappears', async () => {
    const { dataSource, dbService, deferred, pending, setJournal } = setup();
    const missing = { ...history[0], xtreamId: 771002 };
    setJournal({
        version: 1,
        contentTypes: ['movie'],
        recentlyViewed: [...history, missing],
        resolved: history,
    });
    const save = dbService.setAppState.getMockImplementation();
    if (!save) throw new Error('Synthetic storage mock is absent.');
    let rejected = false;
    dbService.setAppState.mockImplementation(async (key, value) => {
        if (!value && !rejected) {
            rejected = true;
            return false;
        }
        return save(key, value);
    });
    await expect(
        dataSource.restoreUserData(playlistId, pending)
    ).rejects.toThrow();
    expect(deferred.getSnapshot(playlistId).state.recentlyViewed).toEqual([
        missing,
    ]);
    setJournal({
        version: 1,
        contentTypes: ['movie'],
        recentlyViewed: [...history, missing],
        resolved: [...history, missing],
    });
    dbService.getRecentItemsOrThrow.mockResolvedValue(
        [...history, missing].map((row) => ({
            type: row.contentType,
            xtream_id: row.xtreamId,
        }))
    );
    await dataSource.restoreUserData(playlistId, pending);
    expect(
        deferred.forExport(playlistId, {
            hiddenCategories: [],
            recentlyViewed: [],
        }).recentlyViewed
    ).toEqual([]);
});

it('cannot park an old journal over a concurrently accepted empty explicit archive', async () => {
    const { dbService, deferred, original } = setup();
    const fresh = {
        favorites: [],
        playbackPositions: [],
        hiddenCategories: [],
        recentlyViewed: [],
        favoritesRestoreId: 'synthetic-fresh-empty',
    };
    let replaced = false;
    dbService.getAllXtreamCategories.mockImplementation(async () => {
        if (!replaced) {
            replaced = true;
            deferred.prepare(playlistId, fresh, []);
        }
        return [];
    });
    await completeCatalogHistoryRecovery(
        dbService,
        deferred,
        playlistId,
        original,
        ['movie']
    );
    expect(deferred.getSnapshot(playlistId).state.recentlyViewed).toEqual([]);
    expect(deferred.getSnapshot(playlistId).state.favoritesRestoreId).toBe(
        fresh.favoritesRestoreId
    );
    expect(deferred.getSnapshot(playlistId).generation).not.toBeNull();
    expect(dbService.setAppState).not.toHaveBeenCalled();
});

it('does not park journal history cleared while category visibility is being read', async () => {
    const { dbService, deferred, original, setJournal } = setup();
    let cleared = false;
    dbService.getAllXtreamCategories.mockImplementation(async () => {
        if (!cleared) {
            cleared = true;
            deferred.clearHistory(playlistId);
            setJournal({
                version: 1,
                contentTypes: ['movie'],
                recentlyViewed: [],
                resolved: [],
                cleared: true,
            });
        }
        return [];
    });
    await completeCatalogHistoryRecovery(
        dbService,
        deferred,
        playlistId,
        original,
        ['movie']
    );
    expect(
        deferred.forExport(playlistId, {
            hiddenCategories: [],
            recentlyViewed: [],
        }).recentlyViewed
    ).toEqual([]);
});

it.each([false, true])(
    'invalidates a held native journal reply when global Clear runs; subsequent empty preparation=%s',
    async (prepareAgain) => {
        const { dbService, deferred } = setup();
        const captured = await captureCatalogCacheRecoveryState(
            dbService,
            deferred,
            playlistId,
            ['movie']
        );
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        let received!: () => void;
        const requested = new Promise<void>((resolve) => {
            received = resolve;
        });
        dbService.readAppState.mockImplementation(async (key) => {
            if (!key.startsWith('xtream-history-recovery:'))
                return { value: null };
            const oldReply = JSON.stringify({
                version: 1,
                contentTypes: ['movie'],
                recentlyViewed: history,
                resolved: [],
            });
            received();
            await barrier;
            return { value: oldReply };
        });
        const completion = completeCatalogHistoryRecovery(
            dbService,
            deferred,
            playlistId,
            captured.snapshot,
            ['movie']
        );
        await requested;
        deferred.clearHistory();
        // Another write must not return to the raw pre-clear receipt (ABA).
        if (prepareAgain)
            deferred.prepare(
                playlistId,
                { ...captured.state, recentlyViewed: [] },
                ['movie']
            );
        release();
        await completion;
        expect(
            deferred.forExport(playlistId, {
                hiddenCategories: [],
                recentlyViewed: [],
            }).recentlyViewed
        ).toEqual([]);
        expect(dbService.setAppState).not.toHaveBeenCalled();
    }
);
