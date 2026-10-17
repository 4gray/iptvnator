import { of } from 'rxjs';
import {
    Playlist,
    XtreamPlaylistBackupEntry,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';

const empty = (): XtreamPendingRestoreState => ({
    favorites: [],
    hiddenCategories: [],
    recentlyViewed: [],
    playbackPositions: [],
});
const source = {
    _id: 'p',
    title: 'Source',
    serverUrl: 'https://example.invalid',
    username: 'user',
    xtreamContentTypes: ['live'],
} as Playlist;
let originalElectron: typeof window.electron;
beforeEach(() => {
    localStorage.clear();
    originalElectron = window.electron;
    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: {},
    });
});
afterEach(() => {
    window.electron = originalElectron;
    localStorage.clear();
});

it('exports every current history row plus dormant catalog data, without consuming it', async () => {
    const service = createPlaylistBackupService({
        playlistsService: { getAllData: () => of([source]) },
    });
    const db = (
        service as unknown as {
            databaseService: { getRecentItemsOrThrow: jest.Mock };
        }
    ).databaseService;
    db.getRecentItemsOrThrow.mockResolvedValue(
        Array.from({ length: 105 }, (_, index) => ({
            xtream_id: index,
            type: 'live',
            viewed_at: '2026-01-01',
        }))
    );
    const dormant = {
        ...empty(),
        hiddenCategories: [{ categoryType: 'movies' as const, xtreamId: 2 }],
        recentlyViewed: [
            {
                contentType: 'movie' as const,
                xtreamId: 20,
                viewedAt: '2026-01-02',
            },
        ],
    };
    new XtreamDeferredCatalogRestoreService().prepare('p', dormant, []);
    const entry = (await service.exportBackup()).manifest
        .playlists[0] as XtreamPlaylistBackupEntry;
    expect(db.getRecentItemsOrThrow).toHaveBeenCalledWith('p');
    expect(entry.userState.recentlyViewed).toHaveLength(106);
    expect(entry.userState.recentlyViewed).toEqual(
        expect.arrayContaining(dormant.recentlyViewed)
    );
    expect(entry.userState.hiddenCategories).toEqual(dormant.hiddenCategories);
    expect(
        new XtreamDeferredCatalogRestoreService().forExport('p', empty())
            .recentlyViewed
    ).toEqual(dormant.recentlyViewed);
});

it('does not merge an older archive into a newly pending explicit replacement', async () => {
    const service = createPlaylistBackupService({
        playlistsService: { getAllData: () => of([source]) },
    });
    new XtreamDeferredCatalogRestoreService().prepare(
        'p',
        {
            ...empty(),
            favoritesRestoreId: 'old',
            recentlyViewed: [
                { contentType: 'movie', xtreamId: 20, viewedAt: '2026-01-01' },
            ],
        },
        []
    );
    const pending = (
        service as unknown as {
            pendingRestoreService: {
                set: (id: string, state: XtreamPendingRestoreState) => unknown;
            };
        }
    ).pendingRestoreService;
    pending.set('p', { ...empty(), favoritesRestoreId: 'new' });
    const entry = (await service.exportBackup()).manifest
        .playlists[0] as XtreamPlaylistBackupEntry;
    expect(entry.userState.recentlyViewed).toEqual([]);
});
