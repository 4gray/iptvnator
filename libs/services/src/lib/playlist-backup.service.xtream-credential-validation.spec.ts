import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

describe('PlaylistBackupService redacted Xtream credential validation', () => {
    function redactedManifest(): PlaylistBackupManifestV1 {
        return {
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
    }

    it('does not persist the entry when the normal connection check rejects the supplied credentials', async () => {
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

        const summary = await service.importBackup(
            JSON.stringify(redactedManifest()),
            {
                resolveXtreamCredentials: async () => ({
                    username: 'restored-user',
                    password: 'wrong-password',
                }),
            }
        );

        expect(summary).toEqual(
            expect.objectContaining({ failed: 1, imported: 0 })
        );
        expect(summary.errors[0]).toContain(
            'Xtream credentials could not be validated'
        );
        expect(playlistsService.addPlaylist).not.toHaveBeenCalled();
    });

    it.each([
        ['username', '', 'local-password'],
        ['password', 'local-user', ' '],
    ])(
        'does not treat an exact local row with a blank %s as usable credentials',
        async (_field, username, password) => {
            const local = {
                _id: 'xtream-redacted',
                title: 'Incomplete local Xtream',
                count: 1,
                importDate: '2026-07-01T00:00:00.000Z',
                lastUsage: '2026-07-01T00:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'https://portal.test/base',
                username,
                password,
            } as Playlist;
            const playlistsService = {
                addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
                getAllData: jest.fn(() => of([local])),
                getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
                handlePlaylistParsing: jest.fn(),
            };
            const resolveXtreamCredentials = jest
                .fn()
                .mockResolvedValue(null);
            const service = createPlaylistBackupService({
                playlistsService,
            });

            const summary = await service.importBackup(
                JSON.stringify(redactedManifest()),
                { resolveXtreamCredentials }
            );

            expect(resolveXtreamCredentials).toHaveBeenCalledWith({
                exportedId: 'xtream-redacted',
                serverUrl: 'https://portal.test/base/',
                title: 'Redacted Xtream',
            });
            expect(summary).toEqual({
                imported: 0,
                merged: 0,
                skipped: 1,
                failed: 0,
                errors: [],
            });
            expect(playlistsService.addPlaylist).not.toHaveBeenCalled();
        }
    );
});
