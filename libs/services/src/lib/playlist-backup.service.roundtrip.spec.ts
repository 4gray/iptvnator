import {
    Playlist,
    PlaylistBackupManifestV1,
    XtreamPlaylistBackupEntry,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';
import {
    createPlaylistBackupService,
    createStatefulBackupCollaborators,
    FakeBackupBackendState,
} from './playlist-backup.service.test-helpers';

/**
 * Full export → import → export round-trip over a stateful in-memory
 * backend. Guards the property the separate export/import specs cannot:
 * that a backup produced by the app restores the complete user state when
 * fed back into the app, and that nothing is silently dropped along the
 * way (issue #1017 shipped exactly because export and import were only
 * ever tested in isolation against hand-built fixtures).
 */
describe('PlaylistBackupService export → import round-trip', () => {
    const electronWindow = window as unknown as { electron?: unknown };

    beforeEach(() => {
        electronWindow.electron = {};
    });

    afterEach(() => {
        delete electronWindow.electron;
        jest.restoreAllMocks();
        localStorage.clear();
    });

    function seedState(): FakeBackupBackendState {
        return {
            playlists: [
                {
                    _id: 'm3u-1',
                    title: 'Local M3U',
                    count: 1,
                    importDate: '2026-07-01T00:00:00.000Z',
                    lastUsage: '2026-07-01T00:00:00.000Z',
                    autoRefresh: false,
                    position: 1,
                    favorites: ['https://streams.example.com/one.m3u8'],
                    recentlyViewed: [
                        {
                            source: 'm3u',
                            id: 'https://streams.example.com/one.m3u8',
                            url: 'https://streams.example.com/one.m3u8',
                            title: 'Channel One',
                            category_id: 'live',
                            added_at: '2026-07-02T10:00:00.000Z',
                        },
                    ],
                    hiddenGroupTitles: ['Shopping'],
                } as unknown as Playlist,
                {
                    _id: 'xtream-1',
                    title: 'Xtream Portal',
                    count: 4,
                    importDate: '2026-07-01T00:00:00.000Z',
                    lastUsage: '2026-07-01T00:00:00.000Z',
                    autoRefresh: true,
                    position: 2,
                    serverUrl: 'http://portal.example.com',
                    username: 'user',
                    password: 'pass',
                } as Playlist,
                {
                    _id: 'stalker-1',
                    title: 'Stalker Portal',
                    count: 0,
                    importDate: '2026-07-01T00:00:00.000Z',
                    lastUsage: '2026-07-01T00:00:00.000Z',
                    autoRefresh: false,
                    position: 3,
                    portalUrl:
                        'http://stalker.example.com/stalker_portal/server/load.php',
                    macAddress: '00:1A:79:AA:BB:CC',
                    isFullStalkerPortal: true,
                    favorites: [
                        { id: '42', name: 'Stalker Channel', type: 'itv' },
                    ],
                    recentlyViewed: [
                        { id: '43', name: 'Stalker Movie', type: 'vod' },
                    ],
                    stalkerToken: 'session-token',
                } as unknown as Playlist,
            ],
            rawM3uByPlaylistId: new Map([
                [
                    'm3u-1',
                    '#EXTM3U\n#EXTINF:-1,Channel One\nhttps://streams.example.com/one.m3u8',
                ],
            ]),
            xtreamCategories: [
                {
                    id: 1,
                    playlist_id: 'xtream-1',
                    name: 'News',
                    type: 'live',
                    xtream_id: 101,
                    hidden: true,
                },
                {
                    id: 2,
                    playlist_id: 'xtream-1',
                    name: 'Sports',
                    type: 'live',
                    xtream_id: 102,
                    hidden: false,
                },
                {
                    id: 3,
                    playlist_id: 'xtream-1',
                    name: 'Drama',
                    type: 'movies',
                    xtream_id: 201,
                    hidden: true,
                },
                {
                    id: 4,
                    playlist_id: 'xtream-1',
                    name: 'Docs',
                    type: 'series',
                    xtream_id: 301,
                    hidden: false,
                },
            ],
            xtreamFavorites: [
                {
                    xtream_id: 501,
                    type: 'movie',
                    added_at: '2026-07-03T12:00:00.000Z',
                    position: 0,
                },
            ],
            xtreamRecent: [
                {
                    xtream_id: 601,
                    type: 'live',
                    viewed_at: '2026-07-04T18:30:00.000Z',
                },
            ],
            playbackPositions: [
                {
                    contentXtreamId: 501,
                    contentType: 'vod',
                    positionSeconds: 120,
                    durationSeconds: 3600,
                    updatedAt: '2026-07-05T20:00:00.000Z',
                },
            ],
            sourcePins: [
                {
                    matchKey: 'tmdb:603',
                    playlistId: 'xtream-1',
                    contentId: 501,
                    portalType: 'xtream',
                    updatedAt: '2026-07-06T09:00:00.000Z',
                },
            ],
            epgUrls: ['https://epg.example.com/guide.xml'],
        };
    }

    function normalizeManifest(
        manifest: PlaylistBackupManifestV1
    ): PlaylistBackupManifestV1 {
        return { ...manifest, exportedAt: 'normalized' };
    }

    function xtreamEntry(
        manifest: PlaylistBackupManifestV1
    ): XtreamPlaylistBackupEntry {
        const entry = manifest.playlists.find(
            (item) => item.portalType === 'xtream'
        );
        if (!entry || entry.portalType !== 'xtream')
            throw new Error('Missing Xtream entry');
        return entry;
    }

    it.each([true, false])(
        'preserves a fresh pending import on re-export (Electron: %s)',
        async (electron) => {
            const state = seedState();
            state.xtreamFavorites.push({
                xtream_id: 501,
                type: 'series',
                position: 1,
            });
            const collaborators = createStatefulBackupCollaborators(state);
            const service = createPlaylistBackupService(collaborators);
            const original = await service.exportBackup();
            const originalState = xtreamEntry(original.manifest).userState;
            expect(originalState.sourcePins).toHaveLength(1);
            state.xtreamCategories = [];
            state.xtreamFavorites = [];
            state.xtreamRecent = [];
            state.playbackPositions = [];
            state.sourcePins = [];
            collaborators.databaseService.getXtreamImportStatus = async () =>
                'idle';
            if (!electron) delete electronWindow.electron;

            const summary = await service.importBackup(original.json);
            expect(summary.failed).toBe(0);
            const snapshot =
                collaborators.pendingRestoreService.getSnapshotOrThrow(
                    'xtream-1'
                );
            expect(snapshot).not.toBeNull();
            // Pending state must remain exportable even while catalog/storage
            // reads are unavailable; it is already the complete restore input.
            jest.spyOn(
                collaborators.databaseService,
                'getFavorites'
            ).mockRejectedValue(new Error('Catalog unavailable'));
            jest.spyOn(
                collaborators.playbackPositionService,
                'getAllPlaybackPositionsOrThrow'
            ).mockRejectedValue(new Error('Position storage unavailable'));
            const exported = await service.exportBackup();
            expect(xtreamEntry(exported.manifest).userState).toEqual(
                originalState
            );
            expect(
                collaborators.pendingRestoreService.getSnapshotOrThrow(
                    'xtream-1'
                )
            ).toEqual(snapshot);
        }
    );

    it.each([true, false])(
        'honors empty pending collections and optional source pins (present: %s)',
        async (pinsPresent) => {
            const state = seedState();
            const collaborators = createStatefulBackupCollaborators(state);
            const pending: XtreamPendingRestoreState = {
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
                ...(pinsPresent ? { sourcePins: [] } : {}),
            };
            collaborators.pendingRestoreService.set('xtream-1', pending);
            const service = createPlaylistBackupService(collaborators);
            const exported = await service.exportBackup();
            const userState = xtreamEntry(exported.manifest).userState;
            expect(userState).toEqual({
                ...pending,
                sourcePins: pinsPresent
                    ? []
                    : [
                          {
                              matchKey: 'tmdb:603',
                              contentId: 501,
                              updatedAt: '2026-07-06T09:00:00.000Z',
                          },
                      ],
            });
        }
    );

    it('keeps absent pending pins absent when the pin store is unavailable', async () => {
        const state = seedState();
        const collaborators = createStatefulBackupCollaborators(state);
        collaborators.vodSourcePinService.isAvailable = false;
        const pending: XtreamPendingRestoreState = {
            hiddenCategories: [],
            favorites: [],
            recentlyViewed: [],
            playbackPositions: [],
        };
        collaborators.pendingRestoreService.set('xtream-1', pending);
        const exported =
            await createPlaylistBackupService(collaborators).exportBackup();
        expect(xtreamEntry(exported.manifest).userState).toEqual(pending);
    });

    it('refuses to export if pending storage cannot be read', async () => {
        const collaborators = createStatefulBackupCollaborators(seedState());
        jest.spyOn(
            collaborators.pendingRestoreService,
            'getOrThrow'
        ).mockImplementation(() => {
            throw new Error('Storage unavailable');
        });
        await expect(
            createPlaylistBackupService(collaborators).exportBackup()
        ).rejects.toThrow('Storage unavailable');
    });

    it('refuses to export when playback positions cannot be read', async () => {
        const collaborators = createStatefulBackupCollaborators(seedState());
        jest.spyOn(
            collaborators.playbackPositionService,
            'getAllPlaybackPositionsOrThrow'
        ).mockRejectedValue(new Error('SQLITE_BUSY'));
        await expect(
            createPlaylistBackupService(collaborators).exportBackup()
        ).rejects.toThrow('SQLITE_BUSY');
    });

    it.each(['completed', 'idle'])(
        'keeps SQLite exports and parks unsupported atomic restores before writes (%s catalog)',
        async (catalogStatus) => {
            const state = seedState();
            const collaborators = createStatefulBackupCollaborators(state);
            const preflight =
                collaborators.playbackPositionService
                    .assertSupportsAtomicReplacement;
            preflight.mockImplementation(() => {
                throw new Error(
                    'Atomic playback position replacement unavailable'
                );
            });
            const service = createPlaylistBackupService(collaborators);
            const original = await service.exportBackup();
            const userState = xtreamEntry(original.manifest).userState;
            expect(userState.favorites).toHaveLength(1);
            expect(userState.playbackPositions).toEqual(
                state.playbackPositions
            );
            expect(userState.hiddenCategories).toHaveLength(2);
            expect(userState.sourcePins).toHaveLength(1);
            expect(preflight).not.toHaveBeenCalled();
            collaborators.databaseService.getXtreamImportStatus = async () =>
                catalogStatus;
            const visibility = jest.spyOn(
                collaborators.databaseService,
                'updateCategoryVisibility'
            );
            const collections = jest.spyOn(
                collaborators.databaseService,
                'restoreXtreamUserData'
            );
            const positions = jest.spyOn(
                collaborators.playbackPositionService,
                'replaceAllPlaybackPositions'
            );
            const pins = jest.spyOn(
                collaborators.vodSourcePinService,
                'replaceForPlaylist'
            );

            const failed = await service.importBackup(original.json);
            expect(failed.failed).toBe(1);
            expect(visibility).not.toHaveBeenCalled();
            expect(collections).not.toHaveBeenCalled();
            expect(positions).not.toHaveBeenCalled();
            expect(pins).not.toHaveBeenCalled();
            expect(
                collaborators.pendingRestoreService.getOrThrow('xtream-1')
            ).toEqual(userState);
            const parkedExport = await service.exportBackup();
            expect(xtreamEntry(parkedExport.manifest).userState).toEqual(
                userState
            );

            preflight.mockImplementation(() => undefined);
            collaborators.databaseService.getXtreamImportStatus = async () =>
                'completed';
            const retried = await service.importBackup(original.json);
            expect(retried.failed).toBe(0);
            expect(positions).toHaveBeenCalledTimes(1);
            expect(
                collaborators.pendingRestoreService.getOrThrow('xtream-1')
            ).toBeNull();
        }
    );

    it('retains failed position restores for retry and consumes only after success', async () => {
        const state = seedState();
        const collaborators = createStatefulBackupCollaborators(state);
        const service = createPlaylistBackupService(collaborators);
        const original = await service.exportBackup();
        const replace = jest
            .spyOn(
                collaborators.playbackPositionService,
                'replaceAllPlaybackPositions'
            )
            .mockRejectedValueOnce(new Error('SQLITE_BUSY'));
        const failed = await service.importBackup(original.json);
        expect(failed.failed).toBe(1);
        expect(
            collaborators.pendingRestoreService.getOrThrow('xtream-1')
                ?.playbackPositions
        ).toEqual(state.playbackPositions);
        const retried = await service.importBackup(original.json);
        expect(retried.failed).toBe(0);
        expect(replace).toHaveBeenCalledTimes(2);
        expect(
            collaborators.pendingRestoreService.getOrThrow('xtream-1')
        ).toBeNull();
    });

    it('re-importing its own export restores the full state and exports an identical manifest', async () => {
        const state = seedState();
        const collaborators = createStatefulBackupCollaborators(state);
        const exportService = createPlaylistBackupService(collaborators);

        const firstExport = await exportService.exportBackup();

        // Simulate a fresh install that has already cached the same portal
        // content (offline cache reports completed) but carries no user
        // state: no playlists, no favorites, every category visible.
        state.playlists = [];
        state.rawM3uByPlaylistId.clear();
        state.xtreamFavorites = [];
        state.xtreamRecent = [];
        state.playbackPositions = [];
        state.epgUrls = [];
        for (const row of state.xtreamCategories) {
            row.hidden = false;
        }

        const importService = createPlaylistBackupService(collaborators);
        const summary = await importService.importBackup(firstExport.json);

        expect(summary).toEqual({
            imported: 3,
            merged: 0,
            skipped: 0,
            failed: 0,
            errors: [],
        });

        // Category visibility restored by exact xtream ID (issue #1017).
        expect(
            state.xtreamCategories
                .filter((row) => row.hidden)
                .map((row) => row.xtream_id)
                .sort((left, right) => left - right)
        ).toEqual([101, 201]);
        expect(state.xtreamFavorites).toEqual([
            {
                xtream_id: 501,
                type: 'movie',
                added_at: '2026-07-03T12:00:00.000Z',
                position: 0,
            },
        ]);
        expect(state.xtreamRecent).toEqual([
            {
                xtream_id: 601,
                type: 'live',
                viewed_at: '2026-07-04T18:30:00.000Z',
            },
        ]);
        expect(state.playbackPositions).toEqual([
            expect.objectContaining({
                contentXtreamId: 501,
                positionSeconds: 120,
            }),
        ]);
        expect(state.epgUrls).toEqual(['https://epg.example.com/guide.xml']);
        expect(state.playlists.map((playlist) => playlist._id)).toEqual([
            'm3u-1',
            'xtream-1',
            'stalker-1',
        ]);

        // Exporting the restored state must reproduce the original
        // manifest byte for byte (modulo the export timestamp): any field
        // silently dropped by export, import, or the restore mapping shows
        // up as a diff here.
        const secondExport = await importService.exportBackup();

        expect(normalizeManifest(secondExport.manifest)).toEqual(
            normalizeManifest(firstExport.manifest)
        );
    });
});
