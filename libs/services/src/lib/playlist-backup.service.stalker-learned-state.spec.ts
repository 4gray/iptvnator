import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
    StalkerPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

describe('PlaylistBackupService Stalker learned-state restore', () => {
    it.each([false, true])(
        'clears excluded learned connection state when merging a %s-secret backup',
        async (includeSecrets) => {
            const local: Playlist = {
                _id: 'stalker-backup',
                title: 'Local Stalker',
                count: 1,
                importDate: '2026-07-01T00:00:00.000Z',
                lastUsage: '2026-07-01T00:00:00.000Z',
                autoRefresh: false,
                portalUrl: 'https://portal.test/server/load.php',
                stalkerSourceUrl: 'https://portal.test/c/',
                macAddress: '00:1A:79:AA:BB:CC',
                stalkerProfilePreset: {
                    id: 'mag250-public-5_1-minimal-v1',
                    version: 1,
                },
                username: 'local-user',
                password: 'local-password',
                stalkerIdentityOverrides: {
                    serialNumber: 'LOCAL-SERIAL',
                },
                stalkerLandingUrl: 'https://portal.test/c/',
                stalkerLastVerifiedAt: '2026-07-27T10:00:00.000Z',
                stalkerRecipeClassifierVersion: 1,
                stalkerRequestRecipe: 'stateless-mac',
            } as Playlist;
            const backupEntry: StalkerPlaylistBackupEntry = {
                portalType: 'stalker',
                exportedId: local._id,
                title: 'Restored Stalker',
                autoRefresh: false,
                connection: {
                    portalUrl: local.portalUrl as string,
                    sourceUrl: local.stalkerSourceUrl,
                    macAddress: local.macAddress as string,
                    profilePreset: local.stalkerProfilePreset,
                    ...(includeSecrets
                        ? {
                              identityOverrides:
                                  local.stalkerIdentityOverrides,
                              username: local.username,
                              password: 'replacement-password',
                          }
                        : {}),
                },
                userState: {
                    favorites: [],
                    recentlyViewed: [],
                },
            };
            const manifest: PlaylistBackupManifestV1 = {
                kind: PLAYLIST_BACKUP_KIND,
                version: PLAYLIST_BACKUP_VERSION,
                exportedAt: '2026-07-27T00:00:00.000Z',
                includeSecrets,
                playlists: [backupEntry],
            };
            const playlistsService = {
                addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
                getAllData: jest.fn(() => of([local])),
                getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
                handlePlaylistParsing: jest.fn(),
            };
            const service = createPlaylistBackupService({
                playlistsService,
            });

            await expect(
                service.importBackup(JSON.stringify(manifest))
            ).resolves.toMatchObject({ imported: 0, merged: 1, failed: 0 });

            expect(playlistsService.addPlaylist).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: local._id,
                    stalkerLandingUrl: undefined,
                    stalkerLastVerifiedAt: undefined,
                    stalkerRecipeClassifierVersion: undefined,
                    stalkerRequestRecipe: undefined,
                })
            );
        }
    );
});
