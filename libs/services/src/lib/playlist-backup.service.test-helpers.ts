import { of } from 'rxjs';
import { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistBackupService } from './playlist-backup.service';

/**
 * Shared factory for PlaylistBackupService specs. Instantiates the service
 * without Angular DI and replaces every collaborator with jest mocks;
 * individual specs override only the collaborators they exercise.
 */
export function createPlaylistBackupService(
    overrides: Record<string, unknown> = {}
) {
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
            clearAllPlaybackPositions: jest.fn().mockResolvedValue(undefined),
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
