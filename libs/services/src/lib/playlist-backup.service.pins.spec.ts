import { XtreamPlaylistBackupEntry } from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';
import {
    createRestoreCollaborators,
    createXtreamManifest,
} from './playlist-backup.xtream-fixtures';

/**
 * VOD source pins through backup and restore.
 *
 * A pin is carried under the playlist it points AT, its match key names the
 * film rather than the portal, and a present-but-empty collection is an
 * answer — split from the hidden-category suite, which owns its own concern.
 */
describe('PlaylistBackupService Xtream source pins', () => {
    const electronWindow = window as unknown as { electron?: unknown };

    beforeEach(() => {
        electronWindow.electron = {};
    });

    afterEach(() => {
        delete electronWindow.electron;
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('refuses to export a backup whose pin read failed', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService({
            playlistsService: collaborators.playlistsService,
            databaseService: collaborators.databaseService,
            vodSourcePinService: {
                isAvailable: true,
                listForPlaylistOrThrow: jest
                    .fn()
                    .mockRejectedValue(new Error('database is locked')),
                set: jest.fn().mockResolvedValue(true),
            },
        });

        // `sourcePins` is authoritative and restore CLEARS the playlist's pins
        // before applying it, so a read that failed and reported "none" would
        // produce a file that looks complete and wipes every pin the user had
        // — through the one feature meant to protect them. Failing the export
        // is the only honest outcome.
        await expect(service.exportBackup()).rejects.toThrow();
    });

    it('exports the pins that point at this playlist', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService({
            playlistsService: collaborators.playlistsService,
            databaseService: collaborators.databaseService,
            vodSourcePinService: {
                isAvailable: true,
                listForPlaylistOrThrow: jest.fn().mockResolvedValue([
                    {
                        matchKey: 'tmdb:603',
                        playlistId: 'xtream-1',
                        contentId: 501,
                        portalType: 'xtream',
                        updatedAt: '2026-07-06T09:00:00.000Z',
                    },
                ]),
                set: jest.fn().mockResolvedValue(true),
            },
        });

        const backup = await service.exportBackup();

        const entry = backup.manifest
            .playlists[0] as XtreamPlaylistBackupEntry;
        // Without this every "main source" choice vanishes on restore, with
        // nothing in the archive to say it was ever made.
        expect(entry.userState.sourcePins).toEqual([
            {
                matchKey: 'tmdb:603',
                contentId: 501,
                updatedAt: '2026-07-06T09:00:00.000Z',
            },
        ]);
    });

    it('restores pins against the imported playlist, not the exported one', async () => {
        const collaborators = createRestoreCollaborators();
        const replacePins = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            vodSourcePinService: {
                isAvailable: true,
                listForPlaylistOrThrow: jest.fn().mockResolvedValue([]),
                replaceForPlaylist: replacePins,
            },
        });

        const manifest = createXtreamManifest(
            [],
            [{ matchKey: 'tmdb:603', contentId: 501 }]
        );

        await service.importBackup(JSON.stringify(manifest));

        // One call, not a clear plus writes: a write failing partway would
        // leave the old pins gone and the archive half-applied. The match key
        // identifies the film and carries over as-is; the playlist id is this
        // installation's, not the archive's.
        expect(replacePins).toHaveBeenCalledTimes(1);
        expect(replacePins).toHaveBeenCalledWith('xtream-1', [
            {
                matchKey: 'tmdb:603',
                playlistId: 'xtream-1',
                contentId: 501,
                portalType: 'xtream',
            },
        ]);
    });

    it('reports pins that could not be written', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService({
            ...collaborators,
            vodSourcePinService: {
                isAvailable: true,
                listForPlaylistOrThrow: jest.fn().mockResolvedValue([]),
                // Reported rather than thrown, so ignoring the result would
                // drop every preference while the summary claims the import
                // succeeded.
                replaceForPlaylist: jest.fn().mockResolvedValue(false),
            },
        });

        const manifest = createXtreamManifest(
            [],
            [{ matchKey: 'tmdb:603', contentId: 501 }]
        );

        const summary = await service.importBackup(JSON.stringify(manifest));

        expect(summary).toEqual(
            expect.objectContaining({ merged: 0, failed: 1 })
        );
    });

    it('drops pins the backup does not contain', async () => {
        const collaborators = createRestoreCollaborators();
        const clearPins = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            vodSourcePinService: {
                isAvailable: true,
                listForPlaylistOrThrow: jest.fn().mockResolvedValue([
                    {
                        matchKey: 'tmdb:999',
                        playlistId: 'xtream-1',
                        contentId: 7,
                        portalType: 'xtream',
                    },
                ]),
                replaceForPlaylist: clearPins,
            },
        });

        // Present-but-empty is an answer, like the playback positions cleared
        // beside it: leaving the current pins would resurrect preferences the
        // archive deliberately does not contain.
        await service.importBackup(
            JSON.stringify(createXtreamManifest([], []))
        );

        // By playlist and in one statement, so the surplus cannot survive and
        // a partial application cannot be left behind.
        expect(clearPins).toHaveBeenCalledWith('xtream-1', []);
    });

    it('omits the collection entirely when it cannot read pins', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService({
            playlistsService: collaborators.playlistsService,
            databaseService: collaborators.databaseService,
            vodSourcePinService: {
                // The PWA, where pins do not exist at all.
                isAvailable: false,
                listForPlaylistOrThrow: jest.fn().mockResolvedValue([]),
            },
        });

        const backup = await service.exportBackup();

        const entry = backup.manifest.playlists[0] as XtreamPlaylistBackupEntry;
        // NOT `[]`. "Could not look" is a third answer, and writing it as
        // "there are none" turns a web-made archive into an instruction that
        // deletes every pin when imported on the desktop.
        expect(entry.userState.sourcePins).toBeUndefined();
    });

    it('leaves pins alone for an archive that has no opinion', async () => {
        const collaborators = createRestoreCollaborators();
        const clearPins = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            vodSourcePinService: {
                // A pin EXISTS, or an empty list would make this pass whether
                // or not the clear was skipped.
                listForPlaylistOrThrow: jest.fn().mockResolvedValue([
                    {
                        matchKey: 'tmdb:999',
                        playlistId: 'xtream-1',
                        contentId: 7,
                        portalType: 'xtream',
                    },
                ]),
                set: jest.fn().mockResolvedValue(true),
                clear: jest.fn().mockResolvedValue(true),
                clearForPlaylist: clearPins,
            },
        });

        // No `sourcePins` field at all — an older archive, which says nothing
        // about pins rather than saying there are none.
        await service.importBackup(JSON.stringify(createXtreamManifest([])));

        expect(clearPins).not.toHaveBeenCalled();
    });

    it('imports an archive written before pins existed', async () => {
        const collaborators = createRestoreCollaborators();
        const setPin = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            vodSourcePinService: {
                isAvailable: true,
                listForPlaylistOrThrow: jest.fn().mockResolvedValue([]),
                set: setPin,
                clear: jest.fn().mockResolvedValue(true),
                clearForPlaylist: jest.fn().mockResolvedValue(true),
            },
        });

        // No `sourcePins` at all — absence is age, not damage.
        const summary = await service.importBackup(
            JSON.stringify(createXtreamManifest([]))
        );

        expect(summary).toEqual(
            expect.objectContaining({ merged: 1, failed: 0 })
        );
        expect(setPin).not.toHaveBeenCalled();
    });
});
