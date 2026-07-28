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


    it('exports the pins that point at this playlist', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService({
            playlistsService: collaborators.playlistsService,
            databaseService: collaborators.databaseService,
            vodSourcePinService: {
                listForPlaylist: jest.fn().mockResolvedValue([
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
        const setPin = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            vodSourcePinService: {
                listForPlaylist: jest.fn().mockResolvedValue([]),
                set: setPin,
                clear: jest.fn().mockResolvedValue(true),
            },
        });

        const manifest = createXtreamManifest(
            [],
            [{ matchKey: 'tmdb:603', contentId: 501 }]
        );

        await service.importBackup(JSON.stringify(manifest));

        // The match key identifies the film and carries over as-is; the
        // playlist id is this installation's, not the archive's.
        expect(setPin).toHaveBeenCalledWith({
            matchKey: 'tmdb:603',
            playlistId: 'xtream-1',
            contentId: 501,
            portalType: 'xtream',
        });
    });

    it('reports a pin that could not be written', async () => {
        const collaborators = createRestoreCollaborators();
        const service = createPlaylistBackupService({
            ...collaborators,
            vodSourcePinService: {
                listForPlaylist: jest.fn().mockResolvedValue([]),
                // `set` reports failure rather than throwing, so ignoring the
                // result would drop the preference while the summary claims
                // the import succeeded.
                set: jest.fn().mockResolvedValue(false),
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
                listForPlaylist: jest.fn().mockResolvedValue([
                    {
                        matchKey: 'tmdb:999',
                        playlistId: 'xtream-1',
                        contentId: 7,
                        portalType: 'xtream',
                    },
                ]),
                set: jest.fn().mockResolvedValue(true),
                clear: clearPins,
            },
        });

        // Present-but-empty is an answer, like the playback positions cleared
        // beside it: leaving the current pins would resurrect preferences the
        // archive deliberately does not contain.
        await service.importBackup(JSON.stringify(createXtreamManifest([], [])));

        expect(clearPins).toHaveBeenCalledWith(['tmdb:999']);
    });

    it('leaves pins alone for an archive that has no opinion', async () => {
        const collaborators = createRestoreCollaborators();
        const clearPins = jest.fn().mockResolvedValue(true);
        const service = createPlaylistBackupService({
            ...collaborators,
            vodSourcePinService: {
                listForPlaylist: jest.fn().mockResolvedValue([]),
                set: jest.fn().mockResolvedValue(true),
                clear: clearPins,
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
                listForPlaylist: jest.fn().mockResolvedValue([]),
                set: setPin,
                clear: jest.fn().mockResolvedValue(true),
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
