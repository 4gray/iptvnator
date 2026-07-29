import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
    XtreamPendingRestoreState,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import { XtreamPendingRestoreSnapshot } from './xtream-pending-restore.service';

/**
 * The Xtream restore scaffolding both backup suites need — the existing
 * playlist, a manifest builder, and the collaborator stubs. Shared so the
 * hidden-category and source-pin suites cannot drift apart.
 */

// Wire-shape rows as returned by the DB worker's category ops.
const categoryRowsByType: Record<string, unknown[]> = {
    live: [
        {
            id: 11,
            playlist_id: 'xtream-1',
            name: 'News',
            type: 'live',
            xtream_id: 101,
            hidden: true,
        },
        {
            id: 12,
            playlist_id: 'xtream-1',
            name: 'Sports',
            type: 'live',
            xtream_id: 102,
            hidden: false,
        },
    ],
    movies: [
        {
            id: 21,
            playlist_id: 'xtream-1',
            name: 'Drama',
            type: 'movies',
            xtream_id: 201,
            hidden: true,
        },
    ],
    series: [],
};

export const existingXtreamPlaylist = {
    _id: 'xtream-1',
    title: 'Xtream Portal',
    count: 3,
    importDate: '2026-04-20T00:00:00.000Z',
    lastUsage: '2026-04-20T00:00:00.000Z',
    autoRefresh: false,
    serverUrl: 'http://portal.example.com',
    username: 'user',
    password: 'pass',
} as Playlist;

export function createXtreamManifest(
    hiddenCategories: unknown[],
    sourcePins?: unknown[]
): PlaylistBackupManifestV1 {
    return {
        kind: PLAYLIST_BACKUP_KIND,
        version: PLAYLIST_BACKUP_VERSION,
        exportedAt: '2026-04-21T00:00:00.000Z',
        includeSecrets: true,
        playlists: [
            {
                portalType: 'xtream',
                exportedId: 'xtream-1',
                title: 'Xtream Portal',
                autoRefresh: false,
                connection: {
                    serverUrl: 'http://portal.example.com',
                    username: 'user',
                    password: 'pass',
                },
                userState: {
                    hiddenCategories,
                    favorites: [],
                    recentlyViewed: [],
                    playbackPositions: [],
                    ...(sourcePins ? { sourcePins } : {}),
                },
            } as unknown as XtreamPlaylistBackupEntry,
        ],
    };
}

export function createRestoreCollaborators() {
    let nextRevision = 0;
    let pendingSnapshot: XtreamPendingRestoreSnapshot | null = null;
    let lastConsumedRevision: number | null = null;
    const pendingRestoreService = {
        set: jest.fn(
            (
                playlistId: string,
                state: XtreamPendingRestoreState
            ): XtreamPendingRestoreSnapshot | null => {
                pendingSnapshot = {
                    playlistId,
                    revision: ++nextRevision,
                    state,
                };
                lastConsumedRevision = null;
                return pendingSnapshot;
            }
        ),
        clear: jest.fn().mockReturnValue(true),
        applyAndConsume: jest.fn(),
    };
    pendingRestoreService.applyAndConsume.mockImplementation(
        async (
            playlistId: string,
            expectedSnapshot: XtreamPendingRestoreSnapshot,
            apply: (state: XtreamPendingRestoreState) => Promise<void>
        ) => {
            if (!pendingSnapshot) {
                return lastConsumedRevision === expectedSnapshot.revision
                    ? 'consumed'
                    : 'superseded';
            }
            if (
                pendingSnapshot.revision !== expectedSnapshot.revision
            ) {
                return 'superseded';
            }

            await apply(pendingSnapshot.state);
            if (
                !pendingRestoreService.clear(
                    playlistId,
                    pendingSnapshot.state
                )
            ) {
                return 'consume-failed';
            }
            lastConsumedRevision = pendingSnapshot.revision;
            pendingSnapshot = null;
            return 'consumed';
        }
    );

    return {
        playlistsService: {
            addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
            getAllData: jest.fn(() => of([existingXtreamPlaylist])),
            getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
            handlePlaylistParsing: jest.fn(),
        },
        databaseService: {
            getAllXtreamCategories: jest.fn(
                (_playlistId: string, type: string) =>
                    Promise.resolve(categoryRowsByType[type] ?? [])
            ),
            getFavorites: jest.fn().mockResolvedValue([]),
            getRecentItems: jest.fn().mockResolvedValue([]),
            getXtreamImportStatus: jest.fn().mockResolvedValue('completed'),
            hasXtreamCategories: jest.fn().mockResolvedValue(true),
            hasXtreamContent: jest.fn().mockResolvedValue(true),
            restoreXtreamUserData: jest.fn().mockResolvedValue(undefined),
            updateCategoryVisibility: jest.fn().mockResolvedValue(true),
        },
        pendingRestoreService,
    };
}
