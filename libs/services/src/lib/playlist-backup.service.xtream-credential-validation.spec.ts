import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

describe('PlaylistBackupService redacted Xtream credential validation', () => {
    it('does not persist the entry when the normal connection check rejects the supplied credentials', async () => {
        const manifest: PlaylistBackupManifestV1 = {
            kind: PLAYLIST_BACKUP_KIND,
            version: PLAYLIST_BACKUP_VERSION,
            exportedAt: '2026-07-27T00:00:00.000Z',
            includeSecrets: false,
            playlists: [
                {
                    portalType: 'xtream',
                    exportedId: 'xtream-redacted',
                    title: 'Redacted Xtream',
                    autoRefresh: false,
                    connection: {
                        credentialsOmitted: true,
                        serverUrl: 'https://portal.test/base/',
                    },
                    userState: {
                        hiddenCategories: [],
                        favorites: [],
                        recentlyViewed: [],
                        playbackPositions: [],
                    },
                },
            ],
        };
        const playlistsService = {
            addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
            getAllData: jest.fn(() => of([])),
            getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
            handlePlaylistParsing: jest.fn(),
        };
        const portalStatusService = {
            checkPortalStatus: jest.fn().mockResolvedValue('inactive'),
        };
        const service = createPlaylistBackupService({
            playlistsService,
            portalStatusService,
        });

        const summary = await service.importBackup(JSON.stringify(manifest), {
            resolveXtreamCredentials: async () => ({
                username: 'restored-user',
                password: 'wrong-password',
            }),
        });

        expect(summary).toEqual(
            expect.objectContaining({ failed: 1, imported: 0 })
        );
        expect(summary.errors[0]).toContain(
            'Xtream credentials could not be validated'
        );
        expect(playlistsService.addPlaylist).not.toHaveBeenCalled();
    });
});
