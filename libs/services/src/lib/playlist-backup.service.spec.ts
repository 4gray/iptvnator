import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
} from '@iptvnator/shared/interfaces';
import {
    PlaylistBackupError,
    PlaylistBackupService,
} from './playlist-backup.service';

describe('PlaylistBackupService', () => {
    function createService(overrides: Record<string, unknown> = {}) {
        const service = Object.create(
            PlaylistBackupService.prototype
        ) as PlaylistBackupService;

        Object.assign(service as object, {
            playlistsService: {
                addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
                getAllData: jest.fn(() => of([])),
                getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
                handlePlaylistParsing: jest.fn(
                    (_uploadType: string, rawM3u: string, title: string) => ({
                        _id: 'generated-id',
                        title,
                        filename: title,
                        count: rawM3u.split('\n').filter(Boolean).length,
                        playlist: {
                            header: { raw: '#EXTM3U' },
                            items: [],
                        },
                        importDate: '2026-04-21T00:00:00.000Z',
                        lastUsage: '2026-04-21T00:00:00.000Z',
                        favorites: [],
                        autoRefresh: false,
                    })
                ),
            },
            settingsStore: {
                getSettings: jest.fn(() => ({ epgUrl: [] })),
                updateSettings: jest.fn().mockResolvedValue(undefined),
            },
            databaseService: {
                getAllXtreamCategories: jest.fn().mockResolvedValue([]),
                getFavorites: jest.fn().mockResolvedValue([]),
                getRecentItems: jest.fn().mockResolvedValue([]),
                getXtreamImportStatus: jest.fn().mockResolvedValue('idle'),
                hasXtreamCategories: jest.fn().mockResolvedValue(false),
                hasXtreamContent: jest.fn().mockResolvedValue(false),
                restoreXtreamUserData: jest.fn().mockResolvedValue(undefined),
                updateCategoryVisibility: jest.fn().mockResolvedValue(true),
            },
            playbackPositionService: {
                getAllPlaybackPositions: jest.fn().mockResolvedValue([]),
                clearAllPlaybackPositions: jest
                    .fn()
                    .mockResolvedValue(undefined),
                savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
            },
            pendingRestoreService: {
                set: jest.fn(),
                clear: jest.fn(),
            },
            ...overrides,
        });

        return service;
    }

    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('exports self-contained M3U data and strips Stalker session fields', async () => {
        const playlistsService = {
            addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
            getAllData: jest.fn(() =>
                of([
                    {
                        _id: 'm3u-file-1',
                        title: 'Local Playlist',
                        count: 2,
                        importDate: '2026-04-21T00:00:00.000Z',
                        lastUsage: '2026-04-21T00:00:00.000Z',
                        autoRefresh: true,
                        filePath: '/tmp/playlist.m3u',
                        favorites: ['https://example.com/stream-1'],
                        recentlyViewed: [],
                    },
                    {
                        _id: 'stalker-1',
                        title: 'Stalker Portal',
                        count: 0,
                        importDate: '2026-04-21T00:00:00.000Z',
                        lastUsage: '2026-04-21T00:00:00.000Z',
                        autoRefresh: false,
                        portalUrl:
                            'http://example.com/stalker_portal/server/load.php',
                        macAddress: '00:1A:79:AA:BB:CC',
                        stalkerToken: 'session-token',
                        stalkerAccountInfo: {
                            login: 'demo',
                        },
                    },
                ] as Playlist[])
            ),
            getRawPlaylistById: jest.fn((playlistId: string) =>
                of(
                    playlistId === 'm3u-file-1'
                        ? '#EXTM3U\n#EXTINF:-1,One\nhttps://example.com/stream-1'
                        : '#EXTM3U'
                )
            ),
            handlePlaylistParsing: jest.fn(),
        };
        const settingsStore = {
            getSettings: jest.fn(() => ({
                epgUrl: ['https://example.com/epg.xml'],
            })),
            updateSettings: jest.fn().mockResolvedValue(undefined),
        };
        const service = createService({
            playlistsService,
            settingsStore,
        });

        const backup = await service.exportBackup();

        expect(backup.defaultFileName).toEqual(
            expect.stringMatching(
                /^iptvnator-playlist-backup-\d{4}-\d{2}-\d{2}\.json$/
            )
        );
        expect(backup.manifest.settings).toEqual({
            epgUrls: ['https://example.com/epg.xml'],
        });
        expect(backup.manifest.playlists).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    portalType: 'm3u',
                    source: expect.objectContaining({
                        kind: 'file',
                        rawM3u: '#EXTM3U\n#EXTINF:-1,One\nhttps://example.com/stream-1',
                        filePathHint: '/tmp/playlist.m3u',
                    }),
                }),
                expect.objectContaining({
                    portalType: 'stalker',
                    connection: expect.objectContaining({
                        portalUrl:
                            'http://example.com/stalker_portal/server/load.php',
                        macAddress: '00:1A:79:AA:BB:CC',
                    }),
                }),
            ])
        );
        expect(JSON.stringify(backup.manifest)).not.toContain('session-token');
        expect(JSON.stringify(backup.manifest)).not.toContain('demo');
    });

    it('rejects legacy raw playlist arrays on import', async () => {
        const service = createService();

        await expect(service.importBackup('[]')).rejects.toBeInstanceOf(
            PlaylistBackupError
        );
    });

    it('merges onto an existing M3U playlist by normalized URL and restores backup-first EPG urls', async () => {
        const existingPlaylist: Playlist = {
            _id: 'existing-playlist-id',
            title: 'Original Title',
            count: 1,
            importDate: '2026-04-20T00:00:00.000Z',
            lastUsage: '2026-04-20T00:00:00.000Z',
            autoRefresh: false,
            url: 'https://example.com/playlist.m3u',
            favorites: ['https://example.com/original'],
            recentlyViewed: [],
            hiddenGroupTitles: ['News'],
        } as Playlist;
        const playlistsService = {
            addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
            getAllData: jest.fn(() => of([existingPlaylist])),
            getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
            handlePlaylistParsing: jest.fn(
                (_uploadType: string, rawM3u: string, title: string) => ({
                    _id: 'generated-id',
                    title,
                    filename: title,
                    count: rawM3u.split('\n').filter(Boolean).length,
                    playlist: {
                        header: { raw: '#EXTM3U' },
                        items: [],
                    },
                    importDate: '2026-04-21T00:00:00.000Z',
                    lastUsage: '2026-04-21T00:00:00.000Z',
                    favorites: [],
                    autoRefresh: false,
                })
            ),
        };
        const settingsStore = {
            getSettings: jest.fn(() => ({
                epgUrl: ['https://existing.example.com/epg.xml'],
            })),
            updateSettings: jest.fn().mockResolvedValue(undefined),
        };
        const service = createService({
            playlistsService,
            settingsStore,
        });

        const manifest: PlaylistBackupManifestV1 = {
            kind: PLAYLIST_BACKUP_KIND,
            version: PLAYLIST_BACKUP_VERSION,
            exportedAt: '2026-04-21T00:00:00.000Z',
            includeSecrets: true,
            settings: {
                epgUrls: [
                    'https://backup.example.com/epg.xml',
                    'https://existing.example.com/epg.xml',
                ],
            },
            playlists: [
                {
                    portalType: 'm3u',
                    exportedId: 'backup-playlist-id',
                    title: 'Imported Title',
                    autoRefresh: true,
                    position: 3,
                    source: {
                        kind: 'url',
                        rawM3u: '#EXTM3U\n#EXTINF:-1,Backup\nhttps://example.com/stream-1',
                        url: 'https://example.com/playlist.m3u/',
                        userAgent: 'BackupAgent/1.0',
                    },
                    userState: {
                        favorites: ['https://example.com/stream-1'],
                        recentlyViewed: [],
                        hiddenGroupTitles: ['Sports'],
                    },
                },
            ],
        };

        const summary = await service.importBackup(JSON.stringify(manifest));

        expect(summary).toEqual({
            imported: 0,
            merged: 1,
            skipped: 0,
            failed: 0,
            errors: [],
        });
        expect(settingsStore.updateSettings).toHaveBeenCalledWith({
            epgUrl: [
                'https://backup.example.com/epg.xml',
                'https://existing.example.com/epg.xml',
            ],
        });
        expect(playlistsService.addPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'existing-playlist-id',
                title: 'Imported Title',
                autoRefresh: true,
                position: 3,
                url: 'https://example.com/playlist.m3u/',
                userAgent: 'BackupAgent/1.0',
                filePath: undefined,
                favorites: ['https://example.com/stream-1'],
                hiddenGroupTitles: ['Sports'],
            })
        );
    });
});
