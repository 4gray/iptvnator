import {
    M3uPlaylistBackupEntry,
    PLAYLIST_BACKUP_KIND,
    PLAYLIST_BACKUP_VERSION,
    PlaylistBackupManifestV1,
} from '@iptvnator/shared/interfaces';
import { throwError } from 'rxjs';
import {
    createPlaylistBackupService,
    createStatefulBackupCollaborators,
    FakeBackupBackendState,
} from './playlist-backup.service.test-helpers';

describe.each(['desktop', 'browser'])(
    'partial backup restore (%s)',
    (runtime) => {
        const electronWindow = window as unknown as { electron?: unknown };

        beforeEach(() => {
            if (runtime === 'desktop') electronWindow.electron = {};
            else delete electronWindow.electron;
        });

        afterEach(() => {
            delete electronWindow.electron;
            jest.restoreAllMocks();
            localStorage.clear();
        });

        function setup() {
            const state: FakeBackupBackendState = {
                playlists: [],
                rawM3uByPlaylistId: new Map(),
                xtreamCategories: [],
                xtreamFavorites: [],
                xtreamRecent: [],
                playbackPositions: [],
                sourcePins: [],
                epgUrls: [],
            };
            const collaborators = createStatefulBackupCollaborators(state);
            const ensureLocksReadable = jest.fn().mockResolvedValue(true);
            const service = createPlaylistBackupService({
                ...collaborators,
                parentalLock: {
                    initialize: jest.fn().mockResolvedValue(undefined),
                    locksReadable: () => true,
                    ensureLocksReadable,
                    requestUnlock: jest.fn().mockResolvedValue(true),
                    locksFor: () => ({ xtream: [], stalker: [], m3u: [] }),
                    replacePlaylistLocks: jest.fn().mockResolvedValue(true),
                },
            });
            const entries: M3uPlaylistBackupEntry[] = ['First', 'Second'].map(
                (title) => ({
                    portalType: 'm3u',
                    exportedId: 'shared-exported-id',
                    title,
                    autoRefresh: false,
                    source: {
                        kind: 'text',
                        rawM3u: `#EXTM3U\n#EXTINF:-1,${title}\nhttps://streams.example.com/${title}.m3u8`,
                    },
                    userState: {
                        favorites: [],
                        recentlyViewed: [],
                        hiddenGroupTitles: [],
                    },
                })
            );
            const manifest: PlaylistBackupManifestV1 = {
                kind: PLAYLIST_BACKUP_KIND,
                version: PLAYLIST_BACKUP_VERSION,
                exportedAt: '2026-10-12T00:00:00.000Z',
                includeSecrets: false,
                playlists: entries,
            };
            return {
                state,
                collaborators,
                ensureLocksReadable,
                service,
                manifest,
            };
        }

        it('preserves a saved playlist when a later restore step fails and another entry shares its exported ID', async () => {
            const { state, ensureLocksReadable, service, manifest } = setup();
            ensureLocksReadable.mockResolvedValueOnce(false);

            const summary = await service.importBackup(
                JSON.stringify(manifest)
            );

            expect(summary).toMatchObject({ imported: 1, failed: 1 });
            expect(summary.errors).toEqual([
                expect.stringContaining('the lock store could not be read'),
            ]);
            expect(state.playlists.map((playlist) => playlist.title)).toEqual([
                'First',
                'Second',
            ]);
            const [first, second] = state.playlists;
            expect(first._id).toBe('shared-exported-id');
            expect(second._id).not.toBe(first._id);
            for (const [index, playlist] of state.playlists.entries()) {
                expect(state.rawM3uByPlaylistId.get(playlist._id)).toBe(
                    (manifest.playlists[index] as M3uPlaylistBackupEntry).source
                        .rawM3u
                );
            }
        });

        it('keeps an exported ID available when saving its first entry fails before any write', async () => {
            const { state, collaborators, service, manifest } = setup();
            jest.spyOn(
                collaborators.playlistsService,
                'addPlaylist'
            ).mockImplementationOnce(() =>
                throwError(() => new Error('Playlist storage unavailable'))
            );

            const summary = await service.importBackup(
                JSON.stringify(manifest)
            );

            expect(summary).toMatchObject({ imported: 1, failed: 1 });
            expect(state.playlists).toHaveLength(1);
            expect(state.playlists[0]).toMatchObject({
                _id: 'shared-exported-id',
                title: 'Second',
            });
            expect(state.rawM3uByPlaylistId.get('shared-exported-id')).toBe(
                (manifest.playlists[1] as M3uPlaylistBackupEntry).source.rawM3u
            );
        });
    }
);
