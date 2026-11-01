import type {
    XtreamBackupRecentlyViewedItem,
    XtreamHistoryRecovery,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';
import { completeCatalogHistoryRecovery } from './xtream-catalog-history-recovery';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it('does not resurrect retained history rewatched between live and journal reads', async () => {
    const playlistId = 'synthetic-source';
    const retainedId = 881101;
    const absentId = 881102;
    const archived: XtreamBackupRecentlyViewedItem[] = [
        retainedId,
        absentId,
    ].map((xtreamId) => ({
        contentType: 'movie',
        xtreamId,
        viewedAt: '2026-01-01T00:00:00.000Z',
    }));
    const state: XtreamPendingRestoreState = {
        favorites: [],
        playbackPositions: [],
        hiddenCategories: [{ categoryType: 'movies', xtreamId: 91 }],
        recentlyViewed: archived,
    };
    const deferred = new XtreamDeferredCatalogRestoreService();
    deferred.prepare(playlistId, state, []);
    const snapshot = deferred.getSnapshot(playlistId);

    // A cancelled deletion kept this row in an unfinished, disabled catalog.
    // Recovery replay restored its history, then the user removed the entry.
    // Native removeRecentItem removes the journal watch and adds a tombstone.
    let nativeHistory: XtreamBackupRecentlyViewedItem[] = [];
    let nativeJournal: XtreamHistoryRecovery | null = {
        version: 1,
        contentTypes: ['live', 'movie', 'series'],
        recentlyViewed: [archived[1]],
        removed: [{ contentType: 'movie', xtreamId: retainedId }],
    };
    const trace: string[] = [];
    const watchRetained = () => {
        trace.push('watch-retained');
        const row: XtreamBackupRecentlyViewedItem = {
            contentType: 'movie',
            xtreamId: retainedId,
            viewedAt: '2026-02-01T00:00:00.000Z',
        };
        nativeHistory = [row];
        if (nativeJournal) {
            // Matches recordRecoveredHistory: a new watch removes its tombstone.
            nativeJournal.recentlyViewed.push(row);
            nativeJournal.removed = [];
            nativeJournal.resolved = [
                { contentType: 'movie', xtreamId: retainedId },
            ];
        }
    };
    const db = {
        getRecentItemsOrThrow: jest.fn(async () => {
            trace.push('read-live');
            return nativeHistory.map((row) => ({
                id: row.xtreamId,
                category_id: 91,
                title: `Synthetic item ${row.xtreamId}`,
                rating: '',
                added: '',
                poster_url: '',
                type: row.contentType,
                xtream_id: row.xtreamId,
                viewed_at: row.viewedAt,
            }));
        }),
        readAppState: jest.fn(async () => {
            // These are separate native IPC requests. A watch can commit after
            // DB_GET_RECENT_ITEMS and before DB_GET_APP_STATE is dispatched.
            watchRetained();
            trace.push('read-journal');
            return { value: JSON.stringify(nativeJournal) };
        }),
        setAppState: jest.fn(async (_key: string, value: string) => {
            expect(value).toBe('');
            trace.push('ack-journal');
            nativeJournal = null;
            return true;
        }),
    };

    await completeCatalogHistoryRecovery(db, deferred, playlistId, snapshot, [
        'live',
    ]);
    expect(trace).toEqual([
        'read-live',
        'watch-retained',
        'read-journal',
        'ack-journal',
    ]);
    expect(nativeHistory.map((row) => row.xtreamId)).toEqual([retainedId]);

    // A later removal has no journal left to update. Native history is empty;
    // export and the next re-enable must not revive its old deferred copy.
    nativeHistory = [];
    const exported = deferred.forExport(playlistId, {
        hiddenCategories: [],
        recentlyViewed: nativeHistory,
    });
    expect(exported.recentlyViewed.map((row) => row.xtreamId)).toEqual([
        absentId,
    ]);
    expect(exported.hiddenCategories).toEqual(state.hiddenCategories);
});
