import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
    StalkerPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

describe('PlaylistBackupService Stalker restore safety', () => {
    function entry(
        connection: StalkerPlaylistBackupEntry['connection'],
        exportedId = 'stalker-backup'
    ): StalkerPlaylistBackupEntry {
        return {
            portalType: 'stalker',
            exportedId,
            title: 'Restored Stalker',
            autoRefresh: false,
            connection,
            userState: {
                favorites: [],
                recentlyViewed: [],
            },
        };
    }

    function manifest(
        backupEntry: StalkerPlaylistBackupEntry,
        includeSecrets: boolean
    ): PlaylistBackupManifestV1 {
        return {
            kind: PLAYLIST_BACKUP_KIND,
            version: PLAYLIST_BACKUP_VERSION,
            exportedAt: '2026-07-27T00:00:00.000Z',
            includeSecrets,
            playlists: [backupEntry],
        };
    }

    function existing(overrides: Partial<Playlist> = {}): Playlist {
        return {
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
            stalkerDeviceId1: 'LOCAL-DEVICE',
            stalkerToken: 'obsolete-token',
            ...overrides,
        } as Playlist;
    }

    function serviceWith(playlists: Playlist[]) {
        const playlistsService = {
            addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
            getAllData: jest.fn(() => of(playlists)),
            getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
            handlePlaylistParsing: jest.fn(),
        };
        return {
            playlistsService,
            service: createPlaylistBackupService({ playlistsService }),
        };
    }

    it('preserves local secrets only for an exact redacted exportedId/source/MAC/profile match', async () => {
        const local = existing();
        const { playlistsService, service } = serviceWith([local]);
        const backup = entry(
            {
                portalUrl: 'https://portal.test/server/load.php',
                sourceUrl: 'https://portal.test/c/',
                macAddress: '00-1a-79-aa-bb-cc',
                profilePreset: {
                    id: 'mag250-public-5_1-minimal-v1',
                    version: 1,
                },
            },
            local._id
        );

        const summary = await service.importBackup(
            JSON.stringify(manifest(backup, false))
        );

        expect(summary).toEqual({
            imported: 0,
            merged: 1,
            skipped: 0,
            failed: 0,
            errors: [],
        });
        expect(playlistsService.addPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: local._id,
                username: 'local-user',
                password: 'local-password',
                stalkerIdentityOverrides: {
                    serialNumber: 'LOCAL-SERIAL',
                },
                stalkerToken: undefined,
            })
        );
    });

    it('creates a separate credential-less row when a redacted source does not exactly match', async () => {
        const local = existing();
        const { playlistsService, service } = serviceWith([local]);
        const backup = entry(
            {
                portalUrl: 'https://other.test/server/load.php',
                sourceUrl: 'https://other.test/c/',
                macAddress: local.macAddress as string,
                profilePreset: local.stalkerProfilePreset,
            },
            local._id
        );

        const summary = await service.importBackup(
            JSON.stringify(manifest(backup, false))
        );

        expect(summary).toEqual(
            expect.objectContaining({ imported: 1, merged: 0, failed: 0 })
        );
        const restored = playlistsService.addPlaylist.mock
            .calls[0][0] as Playlist;
        expect(restored._id).not.toBe(local._id);
        expect(restored.stalkerSourceUrl).toBe('https://other.test/c/');
        expect(restored).not.toHaveProperty('username');
        expect(restored).not.toHaveProperty('password');
        expect(restored).not.toHaveProperty('stalkerIdentityOverrides');
    });

    it('matches included identities by source, MAC, profile, explicit identity, and username', async () => {
        const local = existing({ _id: 'local-id' });
        const { playlistsService, service } = serviceWith([local]);
        const backup = entry({
            portalUrl: local.portalUrl as string,
            sourceUrl: local.stalkerSourceUrl,
            macAddress: '00-1a-79-aa-bb-cc',
            profilePreset: local.stalkerProfilePreset,
            identityOverrides: {
                serialNumber: 'LOCAL-SERIAL',
            },
            username: 'local-user',
            password: 'replacement-password',
        });

        const summary = await service.importBackup(
            JSON.stringify(manifest(backup, true))
        );

        expect(summary.merged).toBe(1);
        expect(playlistsService.addPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'local-id',
                password: 'replacement-password',
            })
        );
    });

    it('keeps whitespace-distinct Stalker principals as separate rows', async () => {
        const local = existing({
            _id: 'local-id',
            username: ' local-user ',
        });
        const { playlistsService, service } = serviceWith([local]);
        const backup = entry({
            portalUrl: local.portalUrl as string,
            sourceUrl: local.stalkerSourceUrl,
            macAddress: local.macAddress as string,
            profilePreset: local.stalkerProfilePreset,
            identityOverrides: local.stalkerIdentityOverrides,
            username: 'local-user',
            password: 'replacement-password',
        });

        const summary = await service.importBackup(
            JSON.stringify(manifest(backup, true))
        );

        expect(summary).toMatchObject({ imported: 1, merged: 0 });
        expect(playlistsService.addPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'stalker-backup',
                username: 'local-user',
            })
        );
    });

    it('does not merge an ambiguous legacy portalUrl and MAC pair', async () => {
        const first = existing({
            _id: 'first',
            stalkerSourceUrl: undefined,
            username: 'one',
        });
        const second = existing({
            _id: 'second',
            stalkerSourceUrl: undefined,
            username: 'two',
        });
        const { playlistsService, service } = serviceWith([first, second]);
        const backup = entry({
            portalUrl: first.portalUrl as string,
            macAddress: first.macAddress as string,
        });

        const summary = await service.importBackup(
            JSON.stringify(manifest(backup, true))
        );

        expect(summary.imported).toBe(1);
        expect(summary.merged).toBe(0);
        const restored = playlistsService.addPlaylist.mock
            .calls[0][0] as Playlist;
        expect(restored._id).toBe('stalker-backup');
        expect(restored).not.toHaveProperty('username');
    });

    it('uses patch semantics: present empty clears while omitted secrets survive a merge', async () => {
        const local = existing({ _id: 'local-id' });
        const { playlistsService, service } = serviceWith([local]);
        const backup = entry(
            {
                portalUrl: local.portalUrl as string,
                sourceUrl: local.stalkerSourceUrl,
                macAddress: local.macAddress as string,
                profilePreset: local.stalkerProfilePreset,
                identityOverrides: local.stalkerIdentityOverrides,
                username: '',
                password: '',
                stalkerSerialNumber: '',
            },
            local._id
        );

        await service.importBackup(JSON.stringify(manifest(backup, true)));

        expect(playlistsService.addPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'local-id',
                username: '',
                password: '',
                stalkerSerialNumber: '',
                stalkerDeviceId1: 'LOCAL-DEVICE',
            })
        );
        const restored = playlistsService.addPlaylist.mock
            .calls[0][0] as Playlist;
        expect(restored.stalkerIdentityOverrides).toEqual({
            serialNumber: 'LOCAL-SERIAL',
        });
    });
});
