import {
    Playlist,
    PlaylistBackupManifestV1,
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
        expect(
            state.playlists.map((playlist) => playlist._id)
        ).toEqual(['m3u-1', 'xtream-1', 'stalker-1']);

        // Exporting the restored state must reproduce the original
        // manifest byte for byte (modulo the export timestamp): any field
        // silently dropped by export, import, or the restore mapping shows
        // up as a diff here.
        const secondExport = await importService.exportBackup();

        expect(normalizeManifest(secondExport.manifest)).toEqual(
            normalizeManifest(firstExport.manifest)
        );
    });

    it('accepts the Android TV v1 export shape and ignores its TV-only extension', async () => {
        const state = seedState();
        state.playlists = [];
        state.rawM3uByPlaylistId.clear();
        state.xtreamCategories = [];
        state.xtreamFavorites = [];
        state.xtreamRecent = [];
        state.playbackPositions = [];
        state.sourcePins = [];
        state.epgUrls = [];

        const androidTvManifest = {
            kind: 'iptvnator-playlist-backup',
            version: 1,
            exportedAt: '2026-09-24T00:00:00.000Z',
            includeSecrets: true,
            playlists: [
                {
                    portalType: 'm3u',
                    exportedId: 'tv-m3u',
                    title: 'TV M3U',
                    autoRefresh: false,
                    position: 0,
                    source: {
                        kind: 'file',
                        rawM3u: '#EXTM3U\n#EXTINF:-1,TV News\nhttps://tv.example/live.m3u8',
                    },
                    userState: {
                        favorites: ['https://tv.example/live.m3u8'],
                        recentlyViewed: [],
                        hiddenGroupTitles: [],
                    },
                    androidTvState: {
                        sourcePosition: 0,
                        epgSources: [{ url: 'https://tv.example/epg.xml', enabled: true, detected: true }],
                    },
                },
                {
                    portalType: 'xtream',
                    exportedId: 'tv-xtream',
                    title: 'TV Xtream',
                    autoRefresh: false,
                    position: 1,
                    connection: {
                        serverUrl: 'https://xtream.example',
                        username: 'tv-user',
                        password: 'tv-password',
                    },
                    userState: {
                        hiddenCategories: [],
                        favorites: [],
                        recentlyViewed: [],
                        playbackPositions: [],
                    },
                    androidTvState: {
                        sourcePosition: 1,
                        episodeProgress: [{ seriesId: 7, episodeId: 9, positionMs: 1000 }],
                    },
                },
                {
                    portalType: 'stalker',
                    exportedId: 'tv-stalker',
                    title: 'TV Stalker',
                    autoRefresh: false,
                    position: 2,
                    connection: {
                        portalUrl: 'https://stalker.example/server/load.php',
                        macAddress: '00:1A:79:AA:BB:CC',
                        stalkerDeviceId1: 'device-1',
                    },
                    userState: { favorites: [], recentlyViewed: [] },
                    androidTvState: {
                        sourcePosition: 2,
                        hiddenGroupTitles: ['Local TV group'],
                    },
                },
            ],
        };
        const service = createPlaylistBackupService(
            createStatefulBackupCollaborators(state)
        );

        const summary = await service.importBackup(
            JSON.stringify(androidTvManifest)
        );

        expect(summary).toEqual({
            imported: 3,
            merged: 0,
            skipped: 0,
            failed: 0,
            errors: [],
        });
        expect(state.playlists.map((playlist) => playlist._id)).toEqual([
            'tv-m3u',
            'tv-xtream',
            'tv-stalker',
        ]);
        expect(state.rawM3uByPlaylistId.get('tv-m3u')).toContain('TV News');
    });
});
