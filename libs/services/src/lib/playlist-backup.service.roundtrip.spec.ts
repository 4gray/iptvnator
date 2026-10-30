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

    // The browser build applies an import at once (see the PWA Xtream spec),
    // so only the desktop leaves one pending while its catalog downloads.
    it('preserves a fresh pending import on re-export', async () => {
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

        const summary = await service.importBackup(original.json);
        expect(summary.failed).toBe(0);
        const snapshot =
            collaborators.pendingRestoreService.getSnapshotOrThrow('xtream-1');
        expect(snapshot).not.toBeNull();
        // Durable favorites remain readable independently of the catalog;
        // other pending state does not require a completed import.
        jest.spyOn(
            collaborators.playbackPositionService,
            'getAllPlaybackPositionsOrThrow'
        ).mockRejectedValue(new Error('Position storage unavailable'));
        const exported = await service.exportBackup();
        expect(xtreamEntry(exported.manifest).userState).toEqual(originalState);
        expect(
            collaborators.pendingRestoreService.getSnapshotOrThrow('xtream-1')
        ).toEqual(snapshot);
    });

    it.each([true, false])(
        'honors empty pending collections and optional source pins (present: %s)',
        async (pinsPresent) => {
            const state = seedState();
            state.xtreamFavorites = [];
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
        state.xtreamFavorites = [];
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

    it('preserves older pending favorites before merging another archive', async () => {
        const state = seedState();
        const collaborators = createStatefulBackupCollaborators(state);
        const service = createPlaylistBackupService(collaborators);
        const archive = await service.exportBackup();
        state.xtreamFavorites = [];
        collaborators.pendingRestoreService.set('xtream-1', {
            favorites: [
                {
                    contentType: 'movie',
                    xtreamId: 999,
                    snapshot: { title: 'Older saved ABC' },
                },
            ],
            hiddenCategories: [],
            recentlyViewed: [],
            playbackPositions: [],
        });
        expect((await service.importBackup(archive.json)).failed).toBe(0);
        expect(
            state.xtreamFavorites.map((row) => row.xtream_id).sort()
        ).toEqual([501, 999]);
        expect(
            state.xtreamFavorites.find((row) => row.xtream_id === 999)?.title
        ).toBe('Older saved ABC');
    });

    it('restores and re-exports saved titles while the catalog is offline', async () => {
        const state = seedState();
        state.xtreamFavorites = [
            {
                xtream_id: 501,
                type: 'movie',
                title: 'Saved ABC',
                poster_url: 'https://example.test/abc.jpg',
                position: 3,
            },
        ];
        const collaborators = createStatefulBackupCollaborators(state);
        const service = createPlaylistBackupService(collaborators);
        const backup = await service.exportBackup();
        state.xtreamFavorites = [];
        state.xtreamCategories = [];
        collaborators.databaseService.getXtreamImportStatus = async () =>
            'idle';
        expect((await service.importBackup(backup.json)).failed).toBe(0);
        expect(state.xtreamFavorites).toEqual([
            {
                xtream_id: 501,
                type: 'movie',
                title: 'Saved ABC',
                poster_url: 'https://example.test/abc.jpg',
                position: 3,
            },
        ]);
        const exported = await service.exportBackup();
        expect(xtreamEntry(exported.manifest).userState.favorites).toEqual(
            xtreamEntry(backup.manifest).userState.favorites
        );
        expect(xtreamEntry(exported.manifest).userState).not.toHaveProperty(
            'favoritesRestoreId'
        );
    });

    it('refuses to export an empty favorites list after a storage read failure, including during pending import', async () => {
        const collaborators = createStatefulBackupCollaborators(seedState());
        const service = createPlaylistBackupService(collaborators);
        jest.spyOn(
            collaborators.databaseService,
            'getFavoritesOrThrow'
        ).mockRejectedValue(new Error('Favorites read failed'));
        await expect(service.exportBackup()).rejects.toThrow(
            'Favorites read failed'
        );
        collaborators.pendingRestoreService.set('xtream-1', {
            favorites: [],
            hiddenCategories: [],
            recentlyViewed: [],
            playbackPositions: [],
        });
        await expect(service.exportBackup()).rejects.toThrow(
            'Favorites read failed'
        );
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
            const favorites = jest.spyOn(
                collaborators.databaseService,
                'restoreXtreamFavoriteSnapshots'
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
            expect(favorites).not.toHaveBeenCalled();
            expect(positions).not.toHaveBeenCalled();
            expect(pins).not.toHaveBeenCalled();
            expect(
                collaborators.pendingRestoreService.getOrThrow('xtream-1')
            ).toEqual({ ...userState, favoritesRestoreId: expect.any(String) });
            await expect(service.exportBackup()).rejects.toThrow('unavailable');
            expect(favorites).not.toHaveBeenCalled();

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

    it('retains an older pending restore without writing favorites when atomic restore is unsupported', async () => {
        const collaborators = createStatefulBackupCollaborators(seedState());
        const service = createPlaylistBackupService(collaborators);
        const archive = await service.exportBackup();
        collaborators.pendingRestoreService.set('xtream-1', {
            favorites: [{ contentType: 'movie', xtreamId: 9999 }],
            hiddenCategories: [],
            recentlyViewed: [],
            playbackPositions: [],
        });
        const previous =
            collaborators.pendingRestoreService.getOrThrow('xtream-1');
        collaborators.playbackPositionService.assertSupportsAtomicReplacement.mockImplementation(
            () => {
                throw new Error(
                    'Atomic playback position replacement unavailable'
                );
            }
        );
        const favorites = jest.spyOn(
            collaborators.databaseService,
            'restoreXtreamFavoriteSnapshots'
        );
        const result = await service.importBackup(archive.json);
        expect(result.failed).toBe(1);
        expect(favorites).not.toHaveBeenCalled();
        expect(
            collaborators.pendingRestoreService.getOrThrow('xtream-1')
        ).toEqual(previous);
    });

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
