import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';
import {
    createRestoreCollaborators,
    createXtreamManifest,
} from './playlist-backup.xtream-fixtures';

/**
 * Regression coverage for issue #1017: hidden Xtream categories must be
 * exported with their xtream IDs and restored by exact ID match. The
 * original bug exported `xtreamId: undefined` (dropped by JSON.stringify)
 * and the restore comparison degraded to `undefined === undefined`, hiding
 * every category of the affected type.
 */
describe('PlaylistBackupService Xtream hidden categories (issue #1017)', () => {
    const electronWindow = window as unknown as { electron?: unknown };

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

        const entry = backup.manifest.playlists[0] as XtreamPlaylistBackupEntry;
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
        expect(
            collaborators.pendingRestoreService.applyAndConsume
        ).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                state: expect.objectContaining({
                    hiddenCategories: [{ categoryType: 'live', xtreamId: 101 }],
                }),
            }),
            expect.any(Function)
        );
        expect(collaborators.pendingRestoreService.clear).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                hiddenCategories: [{ categoryType: 'live', xtreamId: 101 }],
            })
        );
    });

    it('keeps the previous locks when the Xtream part of a merge fails', async () => {
        const collaborators = createRestoreCollaborators();
        const replacePlaylistLocks = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            parentalLock: {
                initialize: jest.fn().mockResolvedValue(undefined),
                locksReadable: jest.fn(() => true),
                ensureLocksReadable: jest.fn().mockResolvedValue(true),
                requestUnlock: jest.fn().mockResolvedValue(true),
                locksFor: jest.fn(() => ({ xtream: [], stalker: [], m3u: [] })),
                replacePlaylistLocks,
            },
        });
        collaborators.databaseService.updateCategoryVisibility.mockRejectedValue(
            new Error('SQLITE_BUSY')
        );

        const summary = await service.importBackup(
            JSON.stringify(createXtreamManifest([]))
        );

        expect(summary.failed).toBe(1);
        expect(replacePlaylistLocks).not.toHaveBeenCalled();
    });

    it('never lets a newly created playlist inherit stale locks under a reused id', async () => {
        const collaborators = createRestoreCollaborators();
        // Empty library: the restore CREATES the playlist (no merge match).
        collaborators.playlistsService.getAllData.mockReturnValue(of([]));
        const replacePlaylistLocks = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            parentalLock: {
                initialize: jest.fn().mockResolvedValue(undefined),
                locksReadable: jest.fn(() => true),
                ensureLocksReadable: jest.fn().mockResolvedValue(true),
                requestUnlock: jest.fn().mockResolvedValue(true),
                // A failed cleanup left locks under the id the restore reuses.
                locksFor: jest.fn(() => ({
                    xtream: [{ categoryType: 'live', xtreamId: 1 }],
                    stalker: [],
                    m3u: [],
                })),
                replacePlaylistLocks,
            },
        });
        const manifest = createXtreamManifest([]);
        delete (
            manifest.playlists[0].userState as { lockedCategories?: unknown }
        ).lockedCategories;

        await service.importBackup(JSON.stringify(manifest));

        expect(replacePlaylistLocks).toHaveBeenCalledWith(expect.any(String), {
            xtream: [],
            stalker: [],
            m3u: [],
        });
    });

    it('asks for the PIN before restoring lock lists and aborts when it is refused', async () => {
        const collaborators = createRestoreCollaborators();
        const requestUnlock = jest.fn().mockResolvedValue(false);
        const replacePlaylistLocks = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            parentalLock: {
                initialize: jest.fn().mockResolvedValue(undefined),
                locksReadable: jest.fn(() => true),
                ensureLocksReadable: jest.fn().mockResolvedValue(true),
                requestUnlock,
                locksFor: jest.fn(() => ({ xtream: [], stalker: [], m3u: [] })),
                replacePlaylistLocks,
            },
        });
        const manifest = createXtreamManifest([]);
        (
            manifest.playlists[0].userState as { lockedCategories?: unknown }
        ).lockedCategories = [];

        await expect(
            service.importBackup(JSON.stringify(manifest))
        ).rejects.toThrow(/parental PIN/);
        expect(requestUnlock).toHaveBeenCalled();
        expect(replacePlaylistLocks).not.toHaveBeenCalled();
        expect(
            collaborators.playlistsService.addPlaylist
        ).not.toHaveBeenCalled();
    });

    it('asks again before a merge replaces locks once the app relocked mid-import', async () => {
        const collaborators = createRestoreCollaborators();
        // Accepted at the start, refused after an idle relock or "Lock now"
        // landed while the import was running.
        const requestUnlock = jest
            .fn()
            .mockResolvedValueOnce(true)
            .mockResolvedValue(false);
        const replacePlaylistLocks = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            parentalLock: {
                initialize: jest.fn().mockResolvedValue(undefined),
                locksReadable: jest.fn(() => true),
                ensureLocksReadable: jest.fn().mockResolvedValue(true),
                requestUnlock,
                locksFor: jest.fn(() => ({
                    xtream: [{ categoryType: 'live', xtreamId: 1 }],
                    stalker: [],
                    m3u: [],
                })),
                replacePlaylistLocks,
            },
        });
        const manifest = createXtreamManifest([]);
        (
            manifest.playlists[0].userState as { lockedCategories?: unknown }
        ).lockedCategories = [];

        const summary = await service.importBackup(JSON.stringify(manifest));

        expect(requestUnlock).toHaveBeenCalledTimes(2);
        expect(replacePlaylistLocks).not.toHaveBeenCalled();
        expect(summary).toEqual(
            expect.objectContaining({ merged: 0, failed: 1 })
        );
        expect(summary.errors[0]).toMatch(/locked again/);
    });

    it('rejects a damaged parental lock list instead of erasing the persisted locks', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService(collaborators);
        const manifest = createXtreamManifest([]);
        (
            manifest.playlists[0].userState as { lockedCategories?: unknown }
        ).lockedCategories = [{}];

        await expect(
            service.importBackup(JSON.stringify(manifest))
        ).rejects.toThrow(/invalid parental locks/);
        expect(
            collaborators.databaseService.updateCategoryVisibility
        ).not.toHaveBeenCalled();
    });

    it('rejects entries with missing user-state collections instead of wiping user data', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService(collaborators);

        // A damaged or hand-edited manifest without userState must not be
        // treated as an authoritative "empty" state: the merge path would
        // unhide every category and delete favorites/recent/positions.
        const manifest = createXtreamManifest([]);
        delete (manifest.playlists[0] as unknown as { userState?: unknown })
            .userState;

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
