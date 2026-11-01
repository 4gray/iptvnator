import { of } from 'rxjs';
import type {
    Playlist,
    XtreamBackupRecentlyViewedItem,
    XtreamPendingRestoreState,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';
import { createXtreamManifest } from './playlist-backup.xtream-fixtures';

const source = {
    _id: 'synthetic-source',
    title: 'Synthetic retained catalog',
    serverUrl: 'https://synthetic.invalid',
    username: 'synthetic-user',
    password: 'synthetic-password',
    xtreamContentTypes: ['live'],
} as Playlist;
const history: XtreamBackupRecentlyViewedItem[] = [20, 30].map((xtreamId) => ({
    contentType: 'movie',
    xtreamId,
    viewedAt: '2026-01-01T00:00:00.000Z',
}));

function setup(sourcePins?: []) {
    const service = createPlaylistBackupService({
        runtime: { supportsXtreamSqliteDataSource: true },
        playlistsService: { getAllData: () => of([source]) },
        vodSourcePinService: {
            listForPlaylistOrThrow: jest.fn().mockResolvedValue([]),
            replaceForPlaylist: jest.fn().mockResolvedValue(true),
        },
    });
    const inner = service as unknown as {
        databaseService: Record<
            | 'getXtreamImportStatus'
            | 'hasXtreamCategories'
            | 'hasXtreamContent'
            | 'restoreXtreamUserData'
            | 'getRecentItemsOrThrow'
            | 'setAppState',
            jest.Mock
        >;
        pendingRestoreService: {
            getOrThrow: (id: string) => XtreamPendingRestoreState | null;
        };
        restoreXtreamEntry: (
            id: string,
            entry: XtreamPlaylistBackupEntry
        ) => Promise<void>;
    };
    const db = inner.databaseService;
    db.getXtreamImportStatus.mockImplementation(async (_id, type) =>
        type === 'live' ? 'completed' : 'idle'
    );
    db.hasXtreamCategories.mockResolvedValue(true);
    db.hasXtreamContent.mockImplementation(
        async (_id, type) => type === 'live' || type === 'movie'
    );
    let nativeHistory: XtreamBackupRecentlyViewedItem[] = [];
    db.restoreXtreamUserData.mockImplementation(
        async (_id, _favorites, incoming: XtreamBackupRecentlyViewedItem[]) => {
            nativeHistory = incoming.filter((row) => row.xtreamId === 20);
            return {
                success: true,
                resolvedHistory: nativeHistory.map(
                    ({ contentType, xtreamId }) => ({
                        contentType,
                        xtreamId,
                    })
                ),
            };
        }
    );
    db.getRecentItemsOrThrow.mockImplementation(async () =>
        nativeHistory.map((row) => ({
            type: row.contentType,
            xtream_id: row.xtreamId,
            viewed_at: row.viewedAt,
        }))
    );
    const entry = createXtreamManifest([
        { categoryType: 'movies', xtreamId: 2 },
    ]).playlists[0] as XtreamPlaylistBackupEntry;
    entry.xtreamContentTypes = ['live'];
    entry.userState.recentlyViewed = history;
    if (sourcePins) entry.userState.sourcePins = sourcePins;
    return {
        service,
        inner,
        db,
        entry,
        nativeHistory: () => nativeHistory,
        removeNativeHistory: () => {
            nativeHistory = [];
        },
    };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it.each([{ sourcePins: undefined }, { sourcePins: [] as [] }])(
    'consumes restored retained identities without losing absent history or hidden choices (pins=$sourcePins)',
    async ({ sourcePins }) => {
        const context = setup(sourcePins);
        await context.inner.restoreXtreamEntry(source._id, context.entry);
        expect(context.nativeHistory()).toEqual(history.slice(0, 1));
        expect(
            context.inner.pendingRestoreService.getOrThrow(source._id)
        ).toBeNull();

        // The retained idle row can subsequently be watched and removed. With
        // no journal left, its old deferred copy must already have been consumed.
        context.removeNativeHistory();
        const exported = (await context.service.exportBackup()).manifest
            .playlists[0] as XtreamPlaylistBackupEntry;
        expect(exported.userState.recentlyViewed).toEqual(history.slice(1));
        expect(exported.userState.hiddenCategories).toEqual(
            context.entry.userState.hiddenCategories
        );
        expect(exported.xtreamContentTypes).toEqual(['live']);
    }
);

it.each([
    undefined,
    { success: false, resolvedHistory: [] },
    {
        success: true,
        resolvedHistory: [{ contentType: 'unknown', xtreamId: 20 }],
    },
    {
        success: true,
        resolvedHistory: [{ contentType: 'movie', xtreamId: Infinity }],
    },
])(
    'retains pending restoration when explicit replay proof is invalid: %j',
    async (proof) => {
        const context = setup();
        context.db.restoreXtreamUserData.mockResolvedValue(proof);
        await expect(
            context.inner.restoreXtreamEntry(source._id, context.entry)
        ).rejects.toThrow();
        expect(
            context.inner.pendingRestoreService.getOrThrow(source._id)
        ).not.toBeNull();
        const parked = new XtreamDeferredCatalogRestoreService().getSnapshot(
            source._id
        );
        expect(parked.state.recentlyViewed).toEqual(history);
    }
);

it('retains pending and missing history when the final DOM flush is rejected', async () => {
    const context = setup();
    let acknowledgments = 0;
    context.db.setAppState.mockImplementation(
        async (key: string) =>
            !key.startsWith('xtream-history-recovery:') || ++acknowledgments < 2
    );
    await expect(
        context.inner.restoreXtreamEntry(source._id, context.entry)
    ).rejects.toThrow('Could not finish catalog history recovery');
    expect(
        context.inner.pendingRestoreService.getOrThrow(source._id)
    ).not.toBeNull();
    expect(
        new XtreamDeferredCatalogRestoreService().getSnapshot(source._id).state
            .recentlyViewed
    ).toEqual(history.slice(1));
    expect(acknowledgments).toBe(2);
});

it('does not consume or acknowledge a newer deferred receipt with an older replay proof', async () => {
    const context = setup();
    const originalRestore =
        context.db.restoreXtreamUserData.getMockImplementation()!;
    const newer = {
        favorites: [],
        playbackPositions: [],
        hiddenCategories: [{ categoryType: 'series' as const, xtreamId: 3 }],
        recentlyViewed: [
            { contentType: 'series' as const, xtreamId: 40, viewedAt: 'new' },
        ],
        favoritesRestoreId: 'synthetic-newer-receipt',
    };
    context.db.restoreXtreamUserData.mockImplementationOnce(async (...args) => {
        const proof = await originalRestore(...args);
        new XtreamDeferredCatalogRestoreService().prepare(
            source._id,
            newer,
            []
        );
        return proof;
    });
    await context.inner.restoreXtreamEntry(source._id, context.entry);
    const stored = new XtreamDeferredCatalogRestoreService().getSnapshot(
        source._id
    ).state;
    expect(stored.recentlyViewed).toEqual(newer.recentlyViewed);
    expect(stored.hiddenCategories).toEqual(newer.hiddenCategories);
    expect(stored.favoritesRestoreId).toBe(newer.favoritesRestoreId);
    // Only explicit preflight reset ran. An older completion cannot clear a
    // journal or flush/acknowledge state owned by the newer receipt.
    expect(
        context.db.setAppState.mock.calls.filter(([key]) =>
            key.startsWith('xtream-history-recovery:')
        )
    ).toHaveLength(1);
});
