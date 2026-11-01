import { of } from 'rxjs';
import type {
    Playlist,
    XtreamPlaylistBackupEntry,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';
import { xtreamCategoryVisibilityKey } from '@iptvnator/shared/interfaces/xtream-category-visibility';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';
import { createXtreamManifest } from './playlist-backup.xtream-fixtures';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';

const source: Playlist = {
    _id: 'synthetic-source',
    title: 'Synthetic visibility source',
    serverUrl: 'https://synthetic.invalid',
    username: 'synthetic-user',
    password: 'synthetic-password',
    xtreamContentTypes: [],
    count: 0,
    autoRefresh: false,
    importDate: '2026-01-01T00:00:00Z',
    lastUsage: '2026-01-01T00:00:00Z',
};

function setup() {
    const service = createPlaylistBackupService({
        runtime: { supportsXtreamSqliteDataSource: true },
        playlistsService: { getAllData: () => of([source]) },
    });
    const inner = service as unknown as {
        databaseService: Record<
            | 'readAppState'
            | 'setAppState'
            | 'getAllXtreamCategories'
            | 'getXtreamImportStatus'
            | 'hasXtreamContent'
            | 'updateCategoryVisibility',
            jest.Mock
        >;
        pendingRestoreService: {
            getOrThrow: (id: string) => XtreamPendingRestoreState | null;
            set: (id: string, state: XtreamPendingRestoreState) => unknown;
        };
        restoreXtreamEntry: (
            id: string,
            entry: XtreamPlaylistBackupEntry
        ) => Promise<void>;
    };
    const db = inner.databaseService;
    const state = new Map<string, string>();
    const category = {
        id: 22,
        playlist_id: source._id,
        type: 'movies',
        xtream_id: 2,
        hidden: true,
    };
    db.readAppState.mockImplementation(async (key: string) => ({
        value: state.get(key) ?? null,
    }));
    db.setAppState.mockImplementation(async (key: string, value: string) => {
        state.set(key, value);
        return true;
    });
    db.getAllXtreamCategories.mockImplementation(async (_id, type) =>
        type === 'movies' ? [{ ...category }] : []
    );
    db.getXtreamImportStatus.mockResolvedValue('idle');
    db.hasXtreamContent.mockResolvedValue(true);
    db.updateCategoryVisibility.mockImplementation(
        async (ids: number[], hidden: boolean) => {
            if (ids.includes(category.id)) category.hidden = hidden;
            return true;
        }
    );
    return { service, inner, db, state, category };
}

beforeEach(() => {
    localStorage.clear();
});
afterEach(() => localStorage.clear());

it('exports an explicit unhide instead of an old dormant hidden copy while retaining absent choices', async () => {
    const { service, state } = setup();
    const deferred = new XtreamDeferredCatalogRestoreService();
    deferred.prepare(
        source._id,
        {
            favorites: [],
            playbackPositions: [],
            recentlyViewed: [],
            hiddenCategories: [2, 9].map((xtreamId) => ({
                categoryType: 'movies',
                xtreamId,
            })),
        },
        []
    );
    state.set(
        xtreamCategoryVisibilityKey(source._id),
        JSON.stringify({
            version: 1,
            categories: [
                { categoryType: 'movies', xtreamId: 2, hidden: false },
            ],
        })
    );
    const entry = (await service.exportBackup()).manifest
        .playlists[0] as XtreamPlaylistBackupEntry;
    expect(entry.userState.hiddenCategories).toEqual([
        { categoryType: 'movies', xtreamId: 9 },
    ]);
    expect(
        deferred.getSnapshot(source._id).state.hiddenCategories
    ).toHaveLength(2);
});

it('a new explicit archive replaces old visibility even in a disabled idle retained category', async () => {
    const { service, inner, state, category } = setup();
    state.set(
        xtreamCategoryVisibilityKey(source._id),
        JSON.stringify({
            version: 1,
            categories: [{ categoryType: 'movies', xtreamId: 2, hidden: true }],
        })
    );
    const entry = createXtreamManifest([])
        .playlists[0] as XtreamPlaylistBackupEntry;
    entry.xtreamContentTypes = [];
    await inner.restoreXtreamEntry(source._id, entry);
    expect(category.hidden).toBe(false);
    const exported = (await service.exportBackup()).manifest
        .playlists[0] as XtreamPlaylistBackupEntry;
    expect(exported.userState.hiddenCategories).toEqual([]);
    expect(exported.xtreamContentTypes).toEqual([]);
});

it('keeps a fresh archive pending and authoritative when old visibility cannot be reset', async () => {
    const { service, inner, db, state } = setup();
    state.set(
        xtreamCategoryVisibilityKey(source._id),
        JSON.stringify({
            version: 1,
            categories: [{ categoryType: 'movies', xtreamId: 2, hidden: true }],
        })
    );
    const save = db.setAppState.getMockImplementation()!;
    db.setAppState.mockImplementation(async (key: string, value: string) =>
        key === xtreamCategoryVisibilityKey(source._id)
            ? false
            : save(key, value)
    );
    const entry = createXtreamManifest([])
        .playlists[0] as XtreamPlaylistBackupEntry;
    entry.xtreamContentTypes = [];
    await expect(inner.restoreXtreamEntry(source._id, entry)).rejects.toThrow(
        'Could not reset explicit category visibility'
    );
    expect(inner.pendingRestoreService.getOrThrow(source._id)).not.toBeNull();
    const exported = (await service.exportBackup()).manifest
        .playlists[0] as XtreamPlaylistBackupEntry;
    expect(exported.userState.hiddenCategories).toEqual([]);
    expect(db.updateCategoryVisibility).not.toHaveBeenCalled();
});

it('consumes only categories actually restored from an immediate explicit archive', async () => {
    const { inner, category } = setup();
    const entry = createXtreamManifest([])
        .playlists[0] as XtreamPlaylistBackupEntry;
    entry.xtreamContentTypes = [];
    entry.userState.hiddenCategories = [2, 9].map((xtreamId) => ({
        categoryType: 'movies',
        xtreamId,
    }));
    await inner.restoreXtreamEntry(source._id, entry);
    expect(category.hidden).toBe(true);
    expect(
        new XtreamDeferredCatalogRestoreService().getSnapshot(source._id).state
            .hiddenCategories
    ).toEqual([{ categoryType: 'movies', xtreamId: 9 }]);
});
