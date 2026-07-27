import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
} from '@iptvnator/shared/interfaces';
import {
    PlaylistBackupError,
    type PlaylistBackupExportOptions,
} from './playlist-backup.service';
import { createPlaylistBackupService } from './playlist-backup.service.test-helpers';

function portalPlaylists(): Playlist[] {
    return [
        {
            _id: 'xtream-secret',
            title: 'Xtream',
            count: 0,
            importDate: '2026-07-27T00:00:00.000Z',
            lastUsage: '2026-07-27T00:00:00.000Z',
            autoRefresh: false,
            serverUrl: 'https://xtream.example',
            username: 'xtream-user-secret',
            password: 'xtream-password-secret',
        },
        {
            _id: 'stalker-secret',
            title: 'Stalker',
            count: 0,
            importDate: '2026-07-27T00:00:00.000Z',
            lastUsage: '2026-07-27T00:00:00.000Z',
            autoRefresh: false,
            stalkerSourceUrl: 'https://stalker.example/customer/c/',
            portalUrl: 'https://stalker.example/customer/portal.php',
            stalkerLandingUrl: 'https://stalker.example/customer/c/',
            stalkerRequestRecipe: 'full-session',
            stalkerRecipeClassifierVersion: 1,
            stalkerLastVerifiedAt: '2026-07-27T10:00:00.000Z',
            macAddress: '00:1A:79:AA:BB:CC',
            isFullStalkerPortal: true,
            username: 'stalker-user-secret',
            password: 'stalker-password-secret',
            stalkerProfilePreset: {
                id: 'mag250-public-5_1-minimal-v1',
                version: 1,
            },
            stalkerIdentityOverrides: {
                serialNumber: 'SERIAL-SECRET',
                deviceId1: 'DEVICE-SECRET',
                deviceId2: 'DEVICE-2-SECRET',
                signature1: 'SIGNATURE-SECRET',
                signature2: 'SIGNATURE-2-SECRET',
                prehash: 'PREHASH-SECRET',
                apiSignature: 'API-SIGNATURE-SECRET',
                firmwareVersion: 'FIRMWARE-SECRET',
                imageVersion: 'IMAGE-SECRET',
                hardwareVersion: 'HARDWARE-SECRET',
                hardwareVersion2: 'HARDWARE-2-SECRET',
                numberOfBanks: 'BANKS-SECRET',
                videoOutput: 'VIDEO-SECRET',
            },
            stalkerTransportConfiguration: {
                locale: 'de-DE',
                language: 'de',
                timezone: 'Europe/Berlin',
                userAgent: 'Explicit Public UA',
                xUserAgent: 'Explicit Public X-UA',
                referer: 'https://stalker.example/customer/c/',
                origin: 'https://stalker.example',
            },
            stalkerSerialNumber: 'LEGACY-SERIAL-SECRET',
            stalkerDeviceId1: 'LEGACY-DEVICE-SECRET',
            stalkerDeviceId2: 'LEGACY-DEVICE-2-SECRET',
            stalkerSignature1: 'LEGACY-SIGNATURE-SECRET',
            stalkerSignature2: 'LEGACY-SIGNATURE-2-SECRET',
            stalkerToken: 'RUNTIME-TOKEN-SECRET',
        },
    ] as Playlist[];
}

function serviceWithPortals(playlists = portalPlaylists()) {
    return createPlaylistBackupService({
        playlistsService: {
            addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
            getAllData: jest.fn(() => of(playlists)),
            getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
            handlePlaylistParsing: jest.fn(),
        },
    });
}

describe('PlaylistBackupService secret policy', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('excludes structured portal credentials and device identity by default', async () => {
        const backup = await serviceWithPortals().exportBackup();
        const serialized = JSON.stringify(backup.manifest);

        expect(backup.manifest.includeSecrets).toBe(false);
        for (const secret of [
            'xtream-user-secret',
            'xtream-password-secret',
            'stalker-user-secret',
            'stalker-password-secret',
            'SERIAL-SECRET',
            'DEVICE-SECRET',
            'SIGNATURE-SECRET',
            'PREHASH-SECRET',
            'API-SIGNATURE-SECRET',
            'FIRMWARE-SECRET',
            'LEGACY-SERIAL-SECRET',
            'RUNTIME-TOKEN-SECRET',
        ]) {
            expect(serialized).not.toContain(secret);
        }

        const xtream = backup.manifest.playlists.find(
            (entry) => entry.portalType === 'xtream'
        );
        expect(xtream).toEqual(
            expect.objectContaining({
                connection: {
                    credentialsOmitted: true,
                    serverUrl: 'https://xtream.example',
                },
            })
        );
    });

    it('keeps Stalker source, MAC, preset, non-secret overrides, and portable state', async () => {
        const backup = await serviceWithPortals().exportBackup();
        const stalker = backup.manifest.playlists.find(
            (entry) => entry.portalType === 'stalker'
        );

        expect(stalker).toEqual(
            expect.objectContaining({
                connection: expect.objectContaining({
                    sourceUrl: 'https://stalker.example/customer/c/',
                    portalUrl: 'https://stalker.example/customer/portal.php',
                    macAddress: '00:1A:79:AA:BB:CC',
                    profilePreset: {
                        id: 'mag250-public-5_1-minimal-v1',
                        version: 1,
                    },
                    transportConfiguration: expect.objectContaining({
                        locale: 'de-DE',
                        timezone: 'Europe/Berlin',
                        userAgent: 'Explicit Public UA',
                    }),
                }),
            })
        );
        expect(stalker).not.toHaveProperty('connection.identityOverrides');
        expect(stalker).not.toHaveProperty('connection.username');
        expect(stalker).not.toHaveProperty('connection.password');

        const serialized = JSON.stringify(stalker);
        expect(serialized).not.toContain('stalkerLandingUrl');
        expect(serialized).not.toContain('stalkerRequestRecipe');
        expect(serialized).not.toContain('stalkerRecipeClassifierVersion');
        expect(serialized).not.toContain('stalkerLastVerifiedAt');
    });

    it('includes credentials and explicit device identity only after opt-in', async () => {
        const options: PlaylistBackupExportOptions = {
            includeSecrets: true,
        };
        const backup = await serviceWithPortals().exportBackup(options);
        const serialized = JSON.stringify(backup.manifest);

        expect(backup.manifest.includeSecrets).toBe(true);
        for (const secret of [
            'xtream-user-secret',
            'xtream-password-secret',
            'stalker-user-secret',
            'stalker-password-secret',
            'SERIAL-SECRET',
            'DEVICE-SECRET',
            'SIGNATURE-SECRET',
            'PREHASH-SECRET',
            'API-SIGNATURE-SECRET',
            'FIRMWARE-SECRET',
        ]) {
            expect(serialized).toContain(secret);
        }
        expect(serialized).not.toContain('RUNTIME-TOKEN-SECRET');
    });

    it('preserves present empty Stalker secret fields for patch-style opt-in restore', async () => {
        const [stalker] = portalPlaylists().slice(1);
        stalker.username = '';
        stalker.password = '';
        stalker.stalkerIdentityOverrides = {
            serialNumber: '',
            deviceId1: '',
        };
        const backup = await serviceWithPortals([stalker]).exportBackup({
            includeSecrets: true,
        });
        const entry = backup.manifest.playlists[0];

        expect(entry).toMatchObject({
            portalType: 'stalker',
            connection: {
                username: '',
                password: '',
                identityOverrides: {
                    serialNumber: '',
                    deviceId1: '',
                },
            },
        });
    });

    it('rejects a manifest that declares secret exclusion but contains gated fields', async () => {
        const service = serviceWithPortals([]);
        const manifest: PlaylistBackupManifestV1 = {
            kind: PLAYLIST_BACKUP_KIND,
            version: PLAYLIST_BACKUP_VERSION,
            exportedAt: '2026-07-27T00:00:00.000Z',
            includeSecrets: false,
            playlists: [
                {
                    portalType: 'stalker',
                    exportedId: 'stalker-secret',
                    title: 'Stalker',
                    autoRefresh: false,
                    connection: {
                        portalUrl: 'https://stalker.example/portal.php',
                        macAddress: '00:1A:79:AA:BB:CC',
                        username: 'forbidden-secret',
                    },
                    userState: {
                        favorites: [],
                        recentlyViewed: [],
                    },
                },
            ],
        };

        await expect(
            service.importBackup(JSON.stringify(manifest))
        ).rejects.toBeInstanceOf(PlaylistBackupError);
    });

    it('keeps old version-1 manifests without includeSecrets importable', async () => {
        const playlistsService = {
            addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
            getAllData: jest.fn(() => of([])),
            getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
            handlePlaylistParsing: jest.fn(),
        };
        const service = createPlaylistBackupService({ playlistsService });
        const legacyManifest = {
            kind: PLAYLIST_BACKUP_KIND,
            version: PLAYLIST_BACKUP_VERSION,
            exportedAt: '2026-07-27T00:00:00.000Z',
            playlists: [
                {
                    portalType: 'stalker',
                    exportedId: 'legacy-stalker',
                    title: 'Legacy Stalker',
                    autoRefresh: false,
                    connection: {
                        portalUrl: 'https://stalker.example/portal.php',
                        macAddress: '00:1A:79:AA:BB:CC',
                        username: 'legacy-user',
                        password: 'legacy-password',
                    },
                    userState: {
                        favorites: [],
                        recentlyViewed: [],
                    },
                },
            ],
        };

        const summary = await service.importBackup(
            JSON.stringify(legacyManifest)
        );

        expect(summary.imported).toBe(1);
        expect(playlistsService.addPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                username: 'legacy-user',
                password: 'legacy-password',
            })
        );
    });

    it('rejects duplicate or blank exported IDs before any restore mutation', async () => {
        const addPlaylist = jest.fn((playlist: Playlist) => of(playlist));
        const updateSettings = jest.fn().mockResolvedValue(undefined);
        const service = createPlaylistBackupService({
            playlistsService: {
                addPlaylist,
                getAllData: jest.fn(() => of([])),
                getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
                handlePlaylistParsing: jest.fn(),
            },
            settingsStore: {
                getSettings: jest.fn(() => ({ epgUrl: [] })),
                updateSettings,
            },
        });
        const baseEntry = {
            portalType: 'stalker' as const,
            exportedId: 'duplicate-id',
            title: 'Stalker',
            autoRefresh: false,
            connection: {
                portalUrl: 'https://stalker.example/portal.php',
                macAddress: '00:1A:79:AA:BB:CC',
            },
            userState: {
                favorites: [],
                recentlyViewed: [],
            },
        };
        const duplicateManifest: PlaylistBackupManifestV1 = {
            kind: PLAYLIST_BACKUP_KIND,
            version: PLAYLIST_BACKUP_VERSION,
            exportedAt: '2026-07-27T00:00:00.000Z',
            includeSecrets: true,
            settings: { epgUrls: ['https://epg.example/guide.xml'] },
            playlists: [baseEntry, { ...baseEntry }],
        };

        await expect(
            service.importBackup(JSON.stringify(duplicateManifest))
        ).rejects.toThrow(/duplicate exported playlist IDs/);

        const blankIdManifest = {
            ...duplicateManifest,
            playlists: [{ ...baseEntry, exportedId: '   ' }],
        };
        await expect(
            service.importBackup(JSON.stringify(blankIdManifest))
        ).rejects.toThrow(/required metadata/);
        expect(addPlaylist).not.toHaveBeenCalled();
        expect(updateSettings).not.toHaveBeenCalled();
    });
});
