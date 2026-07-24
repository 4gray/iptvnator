import { of } from 'rxjs';
import {
    PlaybackPositionData,
    Playlist,
    XtreamBackupFavoriteItem,
    XtreamBackupRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import { PlaylistBackupService } from './playlist-backup.service';
import { XtreamPendingRestoreService } from './xtream-pending-restore.service';

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

export interface FakeXtreamCategoryRow {
    id: number;
    playlist_id: string;
    name: string;
    type: 'live' | 'movies' | 'series';
    xtream_id: number;
    hidden: boolean;
}

export interface FakeXtreamContentRow {
    xtream_id: number;
    type: string;
    added_at?: string;
    position?: number | null;
    viewed_at?: string;
}

/**
 * Mutable in-memory stand-in for everything the backup service reads from
 * and writes to. Round-trip specs seed it, export from it, wipe the user
 * state, import the export back and compare.
 */
export interface FakeBackupBackendState {
    playlists: Playlist[];
    rawM3uByPlaylistId: Map<string, string>;
    xtreamCategories: FakeXtreamCategoryRow[];
    xtreamFavorites: FakeXtreamContentRow[];
    xtreamRecent: FakeXtreamContentRow[];
    playbackPositions: PlaybackPositionData[];
    epgUrls: string[];
}

/**
 * Stateful collaborator set backing PlaylistBackupService with
 * FakeBackupBackendState: exports read the state, imports mutate it. The
 * Xtream offline cache always reports "completed" so the import applies the
 * restore immediately instead of parking it as pending state.
 */
export function createStatefulBackupCollaborators(
    state: FakeBackupBackendState
) {
    let lastParsedRawM3u: string | null = null;

    return {
        playlistsService: {
            getAllData: () => of(state.playlists.map((item) => ({ ...item }))),
            addPlaylist: (playlist: Playlist) => {
                const index = state.playlists.findIndex(
                    (item) => item._id === playlist._id
                );

                if (index >= 0) {
                    state.playlists[index] = playlist;
                } else {
                    state.playlists.push(playlist);
                }

                if (lastParsedRawM3u !== null) {
                    state.rawM3uByPlaylistId.set(
                        playlist._id,
                        lastParsedRawM3u
                    );
                    lastParsedRawM3u = null;
                }

                return of(playlist);
            },
            getRawPlaylistById: (playlistId: string) =>
                of(state.rawM3uByPlaylistId.get(playlistId) ?? '#EXTM3U'),
            handlePlaylistParsing: (
                _uploadType: string,
                rawM3u: string,
                title: string
            ) => {
                lastParsedRawM3u = rawM3u;

                return {
                    _id: 'parsed-transient-id',
                    title,
                    filename: title,
                    count: 1,
                    playlist: { header: { raw: '#EXTM3U' }, items: [] },
                    importDate: '2026-07-23T00:00:00.000Z',
                    lastUsage: '2026-07-23T00:00:00.000Z',
                    favorites: [],
                    autoRefresh: false,
                };
            },
        },
        settingsStore: {
            getSettings: () => ({ epgUrl: [...state.epgUrls] }),
            updateSettings: async ({ epgUrl }: { epgUrl: string[] }) => {
                state.epgUrls = [...epgUrl];
            },
        },
        databaseService: {
            getAllXtreamCategories: async (
                playlistId: string,
                type: 'live' | 'movies' | 'series'
            ) =>
                state.xtreamCategories
                    .filter(
                        (row) =>
                            row.playlist_id === playlistId && row.type === type
                    )
                    .map((row) => ({ ...row })),
            getFavorites: async () =>
                state.xtreamFavorites.map((row) => ({ ...row })),
            getRecentItems: async () =>
                state.xtreamRecent.map((row) => ({ ...row })),
            getXtreamImportStatus: async () => 'completed',
            hasXtreamCategories: async () => true,
            hasXtreamContent: async () => true,
            updateCategoryVisibility: async (
                categoryIds: number[],
                hidden: boolean
            ) => {
                for (const row of state.xtreamCategories) {
                    if (categoryIds.includes(row.id)) {
                        row.hidden = hidden;
                    }
                }

                return true;
            },
            restoreXtreamUserData: async (
                _playlistId: string,
                favorites: XtreamBackupFavoriteItem[],
                recentlyViewed: XtreamBackupRecentlyViewedItem[]
            ) => {
                state.xtreamFavorites = favorites.map((item) => ({
                    xtream_id: item.xtreamId,
                    type: item.contentType,
                    ...(item.addedAt !== undefined
                        ? { added_at: item.addedAt }
                        : {}),
                    ...(item.position !== undefined
                        ? { position: item.position }
                        : {}),
                }));
                state.xtreamRecent = recentlyViewed.map((item) => ({
                    xtream_id: item.xtreamId,
                    type: item.contentType,
                    viewed_at: item.viewedAt,
                }));
            },
        },
        playbackPositionService: {
            getAllPlaybackPositions: async () =>
                state.playbackPositions.map((item) => ({ ...item })),
            clearAllPlaybackPositions: async () => {
                state.playbackPositions = [];
            },
            savePlaybackPosition: async (
                _playlistId: string,
                position: PlaybackPositionData
            ) => {
                state.playbackPositions.push({ ...position });
            },
        },
        pendingRestoreService: new XtreamPendingRestoreService(),
    };
}
