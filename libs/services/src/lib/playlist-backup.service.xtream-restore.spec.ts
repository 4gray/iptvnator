import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

/**
 * Regression coverage for issue #1017: hidden Xtream categories must be
 * exported with their xtream IDs and restored by exact ID match. The
 * original bug exported `xtreamId: undefined` (dropped by JSON.stringify)
 * and the restore comparison degraded to `undefined === undefined`, hiding
 * every category of the affected type.
 */
describe('PlaylistBackupService Xtream hidden categories (issue #1017)', () => {
    const electronWindow = window as unknown as { electron?: unknown };

    // Wire-shape rows as returned by the DB worker's category ops.
    const categoryRowsByType: Record<string, unknown[]> = {
        live: [
            {
                id: 11,
                playlist_id: 'xtream-1',
                name: 'News',
                type: 'live',
                xtream_id: 101,
                hidden: true,
            },
            {
                id: 12,
                playlist_id: 'xtream-1',
                name: 'Sports',
                type: 'live',
                xtream_id: 102,
                hidden: false,
            },
        ],
        movies: [
            {
                id: 21,
                playlist_id: 'xtream-1',
                name: 'Drama',
                type: 'movies',
                xtream_id: 201,
                hidden: true,
            },
        ],
        series: [],
    };

    const existingXtreamPlaylist = {
        _id: 'xtream-1',
        title: 'Xtream Portal',
        count: 3,
        importDate: '2026-04-20T00:00:00.000Z',
        lastUsage: '2026-04-20T00:00:00.000Z',
        autoRefresh: false,
        serverUrl: 'http://portal.example.com',
        username: 'user',
        password: 'pass',
    } as Playlist;

    function createXtreamManifest(
        hiddenCategories: unknown[]
    ): PlaylistBackupManifestV1 {
        return {
            kind: PLAYLIST_BACKUP_KIND,
            version: PLAYLIST_BACKUP_VERSION,
            exportedAt: '2026-04-21T00:00:00.000Z',
            includeSecrets: true,
            playlists: [
                {
                    portalType: 'xtream',
                    exportedId: 'xtream-1',
                    title: 'Xtream Portal',
                    autoRefresh: false,
                    connection: {
                        serverUrl: 'http://portal.example.com',
                        username: 'user',
                        password: 'pass',
                    },
                    userState: {
                        hiddenCategories,
                        favorites: [],
                        recentlyViewed: [],
                        playbackPositions: [],
                    },
                } as unknown as XtreamPlaylistBackupEntry,
            ],
        };
    }

    function createRestoreCollaborators() {
        return {
            playlistsService: {
                addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
                getAllData: jest.fn(() => of([existingXtreamPlaylist])),
                getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
                handlePlaylistParsing: jest.fn(),
            },
            databaseService: {
                getAllXtreamCategories: jest.fn(
                    (_playlistId: string, type: string) =>
                        Promise.resolve(categoryRowsByType[type] ?? [])
                ),
                getFavorites: jest.fn().mockResolvedValue([]),
                getRecentItems: jest.fn().mockResolvedValue([]),
                getXtreamImportStatus: jest.fn().mockResolvedValue('completed'),
                hasXtreamCategories: jest.fn().mockResolvedValue(true),
                hasXtreamContent: jest.fn().mockResolvedValue(true),
                restoreXtreamUserData: jest.fn().mockResolvedValue(undefined),
                updateCategoryVisibility: jest.fn().mockResolvedValue(true),
            },
            pendingRestoreService: {
                set: jest.fn(),
                clear: jest.fn(),
            },
        };
    }

    beforeEach(() => {
        electronWindow.electron = {};
    });

    afterEach(() => {
        delete electronWindow.electron;
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('exports hidden categories with their xtream IDs', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService({
            playlistsService: collaborators.playlistsService,
            databaseService: collaborators.databaseService,
        });

        const backup = await service.exportBackup();

        const entry = backup.manifest
            .playlists[0] as XtreamPlaylistBackupEntry;
        const expectedHiddenCategories = [
            { categoryType: 'live', xtreamId: 101 },
            { categoryType: 'movies', xtreamId: 201 },
        ];
        expect(entry.userState.hiddenCategories).toEqual(
            expectedHiddenCategories
        );

        // The IDs must survive JSON serialization; the original bug
        // exported `xtreamId: undefined`, which JSON.stringify drops.
        const serialized = JSON.parse(backup.json)
            .playlists[0] as XtreamPlaylistBackupEntry;
        expect(serialized.userState.hiddenCategories).toEqual(
            expectedHiddenCategories
        );
    });

    it('restores exactly the hidden categories referenced by the backup', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService(collaborators);

        const manifest = createXtreamManifest([
            { categoryType: 'live', xtreamId: 101 },
        ]);

        const summary = await service.importBackup(JSON.stringify(manifest));

        expect(summary).toEqual(
            expect.objectContaining({ merged: 1, failed: 0 })
        );
        // Per type: reset visibility, then hide only the matched rows.
        expect(
            collaborators.databaseService.updateCategoryVisibility
        ).toHaveBeenNthCalledWith(1, [11, 12], false);
        expect(
            collaborators.databaseService.updateCategoryVisibility
        ).toHaveBeenNthCalledWith(2, [11], true);
        expect(
            collaborators.databaseService.updateCategoryVisibility
        ).toHaveBeenNthCalledWith(3, [21], false);
        expect(
            collaborators.databaseService.updateCategoryVisibility
        ).toHaveBeenCalledTimes(3);
        expect(collaborators.pendingRestoreService.clear).toHaveBeenCalledWith(
            'xtream-1'
        );
    });

    it('rejects entries with missing user-state collections instead of wiping user data', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService(collaborators);

        // A damaged or hand-edited manifest without userState must not be
        // treated as an authoritative "empty" state: the merge path would
        // unhide every category and delete favorites/recent/positions.
        const manifest = createXtreamManifest([]);
        delete (
            manifest.playlists[0] as unknown as { userState?: unknown }
        ).userState;

        await expect(
            service.importBackup(JSON.stringify(manifest))
        ).rejects.toThrow(/incomplete user state/);
        expect(
            collaborators.databaseService.updateCategoryVisibility
        ).not.toHaveBeenCalled();
        expect(
            collaborators.databaseService.restoreXtreamUserData
        ).not.toHaveBeenCalled();
    });

    it('ignores legacy hidden-category entries without an xtream ID instead of hiding everything', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService(collaborators);

        // Backups exported by builds affected by issue #1017 contain
        // hidden categories without any ID. Matching them must not
        // degrade to a type-only comparison that hides every category.
        const manifest = createXtreamManifest([
            { categoryType: 'live' },
            { categoryType: 'movies' },
        ]);

        const summary = await service.importBackup(JSON.stringify(manifest));

        expect(summary).toEqual(
            expect.objectContaining({ merged: 1, failed: 0 })
        );
        const hideCalls = (
            collaborators.databaseService.updateCategoryVisibility.mock
                .calls as unknown[][]
        ).filter(([, hidden]) => hidden === true);
        expect(hideCalls).toHaveLength(0);
        expect(collaborators.pendingRestoreService.set).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({ hiddenCategories: [] })
        );
    });
});
