import { firstValueFrom, of } from 'rxjs';
import { DbStores, Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { PlaylistsService, resolvePlaylistParser } from './playlists.service';

const SQLITE_PLAYLIST_MIGRATION_FLAG = 'm3u-playlists-indexeddb-to-sqlite-v1';
const STALKER_PLAYLIST_METADATA_MIGRATION_FLAG =
    'm3u-playlists-stalker-metadata-v1';

describe('PlaylistsService', () => {
    const testWindow = window as unknown as { electron?: unknown };
    const originalElectron = testWindow.electron;

    afterEach(() => {
        testWindow.electron = originalElectron;
        localStorage.removeItem(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG);
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    function createService(overrides: Record<string, unknown> = {}) {
        const service = Object.create(
            PlaylistsService.prototype
        ) as PlaylistsService;

        Object.assign(service as object, {
            dbService: {
                clear: jest.fn(() => of(undefined)),
                delete: jest.fn(() => of(undefined)),
                // IndexedDB operations always run the Stalker metadata migration first,
                // and that migration reads all playlists before the requested operation.
                getAll: jest.fn(() => of([])),
                getByID: jest.fn(() => of(undefined)),
                update: jest.fn(() => of(undefined)),
                ...overrides,
            },
            snackBar: {
                open: jest.fn(),
            },
            translateService: {
                instant: jest.fn((key: string) => key),
            },
            runtime: {
                get supportsSqlite() {
                    const electron = testWindow.electron as
                        | Record<string, unknown>
                        | undefined;
                    return (
                        !!electron &&
                        typeof electron['dbGetAppPlaylists'] === 'function' &&
                        typeof electron['dbUpsertAppPlaylist'] === 'function' &&
                        typeof electron['dbGetAppState'] === 'function' &&
                        typeof electron['dbSetAppState'] === 'function'
                    );
                },
            },
            electronMigrationPromise: null,
            indexedDbMigrationPromise: null,
            playlistDeleteCleanups: [],
        });

        return service;
    }

    it('resolves the parser from a CommonJS default dynamic import shape', () => {
        const parse = jest.fn();

        expect(
            resolvePlaylistParser({
                default: { parse },
            })
        ).toBe(parse);
    });

    it('runs registered cleanup hooks after deleting a browser playlist', async () => {
        const cleanup = jest.fn().mockResolvedValue(undefined);
        const deleteFromIndexedDb = jest.fn(() => of(undefined));
        const service = createService({ delete: deleteFromIndexedDb });
        Object.assign(service as object, {
            playlistDeleteCleanups: [cleanup],
        });

        await expect(
            firstValueFrom(service.deletePlaylist('playlist-1'))
        ).resolves.toEqual({ success: true });

        expect(deleteFromIndexedDb).toHaveBeenCalledWith(
            DbStores.Playlists,
            'playlist-1'
        );
        expect(cleanup).toHaveBeenCalledWith('playlist-1');
    });

    it('returns browser playlist summaries without embedded playlist payloads', async () => {
        const dbService = {
            getAll: jest.fn(() =>
                of([
                    {
                        _id: 'playlist-summary',
                        title: 'Summary Playlist',
                        count: 2,
                        importDate: '2026-04-01T00:00:00.000Z',
                        lastUsage: '2026-04-02T00:00:00.000Z',
                        autoRefresh: false,
                        favorites: ['channel-1'],
                        playlist: {
                            header: { raw: '#EXTM3U' },
                            items: [{ id: 'channel-1' }],
                        },
                        header: { raw: '#EXTM3U' },
                        items: [{ id: 'legacy-item' }],
                    } as Playlist,
                ])
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        const playlists = await firstValueFrom(service.getAllPlaylists());

        expect(playlists).toEqual([
            expect.objectContaining({
                _id: 'playlist-summary',
                title: 'Summary Playlist',
                favorites: ['channel-1'],
            }),
        ]);
        expect(playlists[0]).not.toHaveProperty('playlist');
        expect(playlists[0]).not.toHaveProperty('header');
        expect(playlists[0]).not.toHaveProperty('items');
    });

    it('loads Electron playlist summaries from the metadata-only bridge when available', async () => {
        const electron = {
            dbGetAppPlaylist: jest.fn(),
            dbGetAppPlaylistMetas: jest.fn(async () => [
                {
                    _id: 'playlist-meta',
                    title: 'Metadata Playlist',
                    count: 2,
                    favorites: ['channel-1'],
                    playlist: {
                        items: [{ id: 'channel-1' }],
                    },
                },
            ]),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                    ? '1'
                    : null
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();
        const playlists = await firstValueFrom(service.getAllPlaylists());

        expect(electron.dbGetAppPlaylistMetas).toHaveBeenCalledTimes(1);
        expect(electron.dbGetAppPlaylists).not.toHaveBeenCalled();
        expect(playlists).toEqual([
            expect.objectContaining({
                _id: 'playlist-meta',
                title: 'Metadata Playlist',
                favorites: ['channel-1'],
            }),
        ]);
        expect(playlists[0]).not.toHaveProperty('playlist');
    });

    it('normalizes partial SQLite playlists when loading by id', async () => {
        const electron = {
            dbGetAppPlaylist: jest.fn(async () => ({
                id: 42,
                count: '3',
                url: 'https://example.com/list.m3u',
                autoRefresh: '',
            })),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                    ? '1'
                    : null
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await expect(
            firstValueFrom(service.getPlaylistById('42'))
        ).resolves.toEqual(
            expect.objectContaining({
                _id: '42',
                title: '',
                count: 3,
                favorites: [],
                recentlyViewed: [],
                autoRefresh: false,
                url: 'https://example.com/list.m3u',
            })
        );
    });

    it('loads resolved M3U favorite channels from Electron without fetching the full playlist payload', async () => {
        const resolvedFavorites = [
            {
                favoriteId: 'channel-1',
                favoriteIndex: 0,
                channel: {
                    id: 'channel-1',
                    name: 'Channel One',
                    url: 'https://example.com/stream-1.m3u8',
                },
            },
        ];
        const electron = {
            dbGetAppPlaylist: jest.fn(),
            dbGetAppPlaylistFavoriteChannels: jest.fn(
                async () => resolvedFavorites
            ),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                    ? '1'
                    : null
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await expect(
            firstValueFrom(service.getM3uFavoriteChannels('playlist-1'))
        ).resolves.toBe(resolvedFavorites);
        expect(electron.dbGetAppState).toHaveBeenCalledWith(
            SQLITE_PLAYLIST_MIGRATION_FLAG
        );
        expect(electron.dbGetAppPlaylistFavoriteChannels).toHaveBeenCalledWith(
            'playlist-1'
        );
        expect(electron.dbGetAppPlaylist).not.toHaveBeenCalled();
        expect(electron.dbGetAppPlaylists).not.toHaveBeenCalled();
    });

    it('falls back from resolved M3U favorites when SQLite playlist migration is incomplete', async () => {
        const electron = {
            dbGetAppPlaylist: jest.fn(),
            dbGetAppPlaylistFavoriteChannels: jest.fn(),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ? null : '1'
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await expect(
            firstValueFrom(service.getM3uFavoriteChannels('playlist-1'))
        ).resolves.toBeNull();
        expect(electron.dbGetAppPlaylistFavoriteChannels).not.toHaveBeenCalled();
        expect(electron.dbGetAppPlaylist).not.toHaveBeenCalled();
        expect(electron.dbGetAppPlaylists).not.toHaveBeenCalled();
    });

    it('adds browser playlists through IndexedDB and returns the original playlist', async () => {
        const playlist = {
            _id: 'playlist-add',
            title: 'Add Me',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
        } as Playlist;
        const dbService = {
            add: jest.fn(() => of('generated-key')),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.addPlaylist(playlist))
        ).resolves.toBe(playlist);
        expect(dbService.add).toHaveBeenCalledWith(
            DbStores.Playlists,
            playlist
        );
    });

    it('migrates legacy Stalker portal flags in SQLite before returning playlists', async () => {
        let storedPlaylists: Playlist[] = [
            {
                _id: 'stalker-1',
                title: 'Legacy Stalker',
                count: 0,
                importDate: new Date('2026-03-28T00:00:00.000Z').toISOString(),
                lastUsage: new Date('2026-03-28T00:00:00.000Z').toISOString(),
                autoRefresh: false,
                macAddress: '00:1A:79:AA:BB:CC',
                portalUrl: 'http://example.com/stalker_portal/c/',
            } as Playlist,
        ];
        const appState = new Map<string, string>([
            [SQLITE_PLAYLIST_MIGRATION_FLAG, '1'],
        ]);
        const electron = {
            dbGetAppPlaylists: jest.fn(async () => storedPlaylists),
            dbGetAppState: jest.fn(
                async (key: string) => appState.get(key) ?? null
            ),
            dbSetAppState: jest.fn(async (key: string, value: string) => {
                appState.set(key, value);
            }),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(async (playlists: Playlist[]) => {
                const updates = new Map(
                    playlists.map((playlist) => [playlist._id, playlist])
                );
                storedPlaylists = storedPlaylists.map(
                    (playlist) => updates.get(playlist._id) ?? playlist
                );
            }),
        };
        testWindow.electron = electron;

        const service = createService();

        await expect(
            firstValueFrom(service.getAllPlaylists())
        ).resolves.toEqual([
            expect.objectContaining({
                _id: 'stalker-1',
                isFullStalkerPortal: true,
            }),
        ]);

        expect(electron.dbUpsertAppPlaylists).toHaveBeenCalledWith([
            expect.objectContaining({
                _id: 'stalker-1',
                isFullStalkerPortal: true,
            }),
        ]);
        expect(appState.get(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG)).toBe(
            '1'
        );
    });

    it('does not rerun the SQLite Stalker metadata migration after the flag is set', async () => {
        const electron = {
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) => {
                if (
                    key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                    key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                ) {
                    return '1';
                }

                return null;
            }),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await firstValueFrom(service.getAllPlaylists());
        await firstValueFrom(service.getAllPlaylists());

        expect(electron.dbUpsertAppPlaylists).not.toHaveBeenCalled();
        expect(electron.dbSetAppState).not.toHaveBeenCalledWith(
            STALKER_PLAYLIST_METADATA_MIGRATION_FLAG,
            '1'
        );
    });

    it('migrates legacy Stalker portal flags in IndexedDB before returning full playlists', async () => {
        let storedPlaylists: Playlist[] = [
            {
                _id: 'stalker-2',
                title: 'IndexedDB Stalker',
                count: 0,
                importDate: new Date('2026-03-28T00:00:00.000Z').toISOString(),
                lastUsage: new Date('2026-03-28T00:00:00.000Z').toISOString(),
                autoRefresh: false,
                macAddress: '00:1A:79:11:22:33',
                portalUrl: 'http://example.com/portal/c/',
            } as Playlist,
        ];
        const dbService = {
            getAll: jest.fn(() => of(storedPlaylists)),
            update: jest.fn((_storeName: string, playlist: Playlist) => {
                storedPlaylists = storedPlaylists.map((current) =>
                    current._id === playlist._id ? playlist : current
                );
                return of(playlist);
            }),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(firstValueFrom(service.getAllData())).resolves.toEqual([
            expect.objectContaining({
                _id: 'stalker-2',
                isFullStalkerPortal: false,
            }),
        ]);

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'stalker-2',
                isFullStalkerPortal: false,
            })
        );
        expect(
            localStorage.getItem(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG)
        ).toBe('1');
    });

    it('persists hiddenGroupTitles in playlist meta updates', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-1',
            title: 'Playlist One',
            count: 2,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            hiddenGroupTitles: ['News'],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.updatePlaylistMeta({
                _id: 'playlist-1',
                hiddenGroupTitles: ['Movies', 'Sports'],
            } as PlaylistMeta)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-1',
                hiddenGroupTitles: ['Movies', 'Sports'],
            })
        );
    });

    it('updates many browser playlists with refresh metadata', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1770000000000);
        const playlists = [
            {
                _id: 'playlist-a',
                title: 'A',
                count: 1,
                importDate: '2026-04-01T00:00:00.000Z',
                lastUsage: '2026-04-01T00:00:00.000Z',
                autoRefresh: false,
            },
            {
                _id: 'playlist-b',
                title: 'B',
                count: 2,
                importDate: '2026-04-01T00:00:00.000Z',
                lastUsage: '2026-04-01T00:00:00.000Z',
                autoRefresh: false,
            },
        ] as Playlist[];
        const dbService = {
            getAll: jest.fn(() => of([])),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.updateManyPlaylists(playlists))
        ).resolves.toHaveLength(2);

        expect(dbService.update).toHaveBeenNthCalledWith(
            1,
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-a',
                updateDate: 1770000000000,
                autoRefresh: true,
            })
        );
        expect(dbService.update).toHaveBeenNthCalledWith(
            2,
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-b',
                updateDate: 1770000000000,
                autoRefresh: true,
            })
        );
    });

    it('short-circuits updateManyPlaylists when no playlists are provided', async () => {
        const dbService = {
            update: jest.fn(),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.updateManyPlaylists([]))
        ).resolves.toEqual([]);
        expect(dbService.update).not.toHaveBeenCalled();
    });

    it('filters favorite channels from a playlist payload', async () => {
        const playlist = {
            _id: 'playlist-favorites',
            title: 'Favorites',
            count: 3,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: ['channel-2', 'channel-3'],
            playlist: {
                items: [
                    { id: 'channel-1', name: 'One' },
                    { id: 'channel-2', name: 'Two' },
                    { id: 'channel-3', name: 'Three' },
                ],
            },
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.getFavoriteChannels('playlist-favorites'))
        ).resolves.toEqual([
            expect.objectContaining({ id: 'channel-2' }),
            expect.objectContaining({ id: 'channel-3' }),
        ]);
    });

    it('sorts portal favorites newest first', async () => {
        const playlist = {
            _id: 'portal-1',
            title: 'Portal',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: [
                { id: 'old', title: 'Old', added_at: '2026-04-01T10:00:00Z' },
                { id: 'new', title: 'New', added_at: '2026-04-01T11:00:00Z' },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.getPortalFavorites('portal-1'))
        ).resolves.toEqual([
            expect.objectContaining({ id: 'new' }),
            expect.objectContaining({ id: 'old' }),
        ]);
    });

    it('filters portal live stream favorites', async () => {
        const playlist = {
            _id: 'portal-live',
            title: 'Portal Live',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: [
                { stream_id: 1, title: 'Live', stream_type: 'live' },
                { movie_id: 2, title: 'Movie', stream_type: 'movie' },
                { id: 3, title: 'No Type' },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.getPortalLiveStreamFavorites('portal-live'))
        ).resolves.toEqual([expect.objectContaining({ stream_id: 1 })]);
    });

    it('removes portal favorites by any supported identity field', async () => {
        const playlist = {
            _id: 'portal-remove-favorite',
            title: 'Portal Remove',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: [
                { stream_id: 10, title: 'Live' },
                { series_id: 20, title: 'Series' },
                { movie_id: 30, title: 'Movie' },
                { id: 40, title: 'Other' },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
            update: jest.fn((_storeName: string, updated: Playlist) =>
                of(updated)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.removeFromPortalFavorites('portal-remove-favorite', 20)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                favorites: [
                    expect.objectContaining({ stream_id: 10 }),
                    expect.objectContaining({ movie_id: 30 }),
                    expect.objectContaining({ id: 40 }),
                ],
            })
        );
    });

    it('updates browser playlist positions through individual reads and writes', async () => {
        const playlistsById = new Map<string, Playlist>([
            [
                'playlist-position-a',
                {
                    _id: 'playlist-position-a',
                    title: 'Position A',
                    count: 0,
                    importDate: '2026-04-01T00:00:00.000Z',
                    lastUsage: '2026-04-01T00:00:00.000Z',
                    autoRefresh: false,
                    position: 1,
                } as Playlist,
            ],
            [
                'playlist-position-b',
                {
                    _id: 'playlist-position-b',
                    title: 'Position B',
                    count: 0,
                    importDate: '2026-04-01T00:00:00.000Z',
                    lastUsage: '2026-04-01T00:00:00.000Z',
                    autoRefresh: false,
                    position: 2,
                } as Playlist,
            ],
        ]);
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn((_storeName: string, id: string) =>
                of(playlistsById.get(id))
            ),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(
                service.updatePlaylistPositions([
                    { id: 'playlist-position-a', changes: { position: 2 } },
                    { id: 'playlist-position-b', changes: { position: 1 } },
                ])
            )
        ).resolves.toEqual([
            expect.objectContaining({
                _id: 'playlist-position-a',
                position: 2,
            }),
            expect.objectContaining({
                _id: 'playlist-position-b',
                position: 1,
            }),
        ]);
    });

    it('returns only auto-refresh playlists as lightweight metadata', async () => {
        const dbService = {
            getAll: jest.fn(() =>
                of([
                    {
                        _id: 'manual',
                        title: 'Manual',
                        count: 1,
                        importDate: '2026-04-01T00:00:00.000Z',
                        lastUsage: '2026-04-01T00:00:00.000Z',
                        autoRefresh: false,
                    } as Playlist,
                    {
                        _id: 'auto',
                        title: 'Auto',
                        count: 1,
                        importDate: '2026-04-01T00:00:00.000Z',
                        lastUsage: '2026-04-01T00:00:00.000Z',
                        autoRefresh: true,
                        favorites: ['channel-1'],
                        playlist: {
                            header: { raw: '#EXTM3U' },
                            items: [{ id: 'channel-1' }],
                        },
                    } as Playlist,
                ])
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        const autoUpdatePlaylists = await firstValueFrom(
            service.getPlaylistsForAutoUpdate()
        );

        expect(autoUpdatePlaylists).toEqual([
            expect.objectContaining({
                _id: 'auto',
                autoRefresh: true,
            }),
        ]);
        expect(autoUpdatePlaylists[0]).not.toHaveProperty('playlist');
        expect(autoUpdatePlaylists[0]).not.toHaveProperty('favorites');
    });

    it('exports raw playlist text from header and item raw lines', async () => {
        const playlist = {
            _id: 'playlist-raw',
            title: 'Raw',
            count: 2,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            playlist: {
                header: { raw: '#EXTM3U' },
                items: [
                    { raw: '#EXTINF:-1,One\nhttps://example.com/one.m3u8' },
                    { raw: '#EXTINF:-1,Two\nhttps://example.com/two.m3u8' },
                ],
            },
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.getRawPlaylistById('playlist-raw'))
        ).resolves.toBe(
            '#EXTM3U\n' +
                '#EXTINF:-1,One\nhttps://example.com/one.m3u8\n' +
                '#EXTINF:-1,Two\nhttps://example.com/two.m3u8'
        );
    });

    it('clears all browser playlists', async () => {
        const dbService = {
            clear: jest.fn(() => of('cleared')),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.removeAll())
        ).resolves.toBeUndefined();
        expect(dbService.clear).toHaveBeenCalledWith(DbStores.Playlists);
    });

    it('adds many browser playlists through bulkAdd', async () => {
        const playlists = [
            {
                _id: 'bulk-a',
                title: 'Bulk A',
                count: 0,
                importDate: '2026-04-01T00:00:00.000Z',
                lastUsage: '2026-04-01T00:00:00.000Z',
                autoRefresh: false,
            },
        ] as Playlist[];
        const dbService = {
            bulkAdd: jest.fn(() => of(['bulk-a'])),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.addManyPlaylists(playlists))
        ).resolves.toEqual(['bulk-a']);
        expect(dbService.bulkAdd).toHaveBeenCalledWith(
            DbStores.Playlists,
            playlists
        );
    });

    it('removes multiple recently-viewed identities in a single PWA write', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-3',
            title: 'Playlist Three',
            count: 3,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'https://example.com/1.m3u8',
                    url: 'https://example.com/1.m3u8',
                    title: 'A',
                    category_id: 'live',
                    added_at: '2026-05-04T10:00:00.000Z',
                },
                {
                    source: 'm3u',
                    id: 'https://example.com/2.m3u8',
                    url: 'https://example.com/2.m3u8',
                    title: 'B',
                    category_id: 'live',
                    added_at: '2026-05-04T10:01:00.000Z',
                },
                {
                    source: 'm3u',
                    id: 'https://example.com/3.m3u8',
                    url: 'https://example.com/3.m3u8',
                    title: 'C',
                    category_id: 'live',
                    added_at: '2026-05-04T10:02:00.000Z',
                },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.removeFromPlaylistRecentlyViewedBatch('playlist-3', [
                'https://example.com/1.m3u8',
                'https://example.com/2.m3u8',
            ])
        );

        expect(dbService.update).toHaveBeenCalledTimes(1);
        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-3',
                recentlyViewed: [
                    expect.objectContaining({
                        url: 'https://example.com/3.m3u8',
                    }),
                ],
            })
        );
    });

    it('removes multiple recently-viewed identities in a single Electron upsert', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-4',
            title: 'Playlist Four',
            count: 0,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'https://example.com/a.m3u8',
                    url: 'https://example.com/a.m3u8',
                    title: 'A',
                    category_id: 'live',
                    added_at: '2026-05-04T10:00:00.000Z',
                },
                {
                    source: 'm3u',
                    id: 'https://example.com/b.m3u8',
                    url: 'https://example.com/b.m3u8',
                    title: 'B',
                    category_id: 'live',
                    added_at: '2026-05-04T10:01:00.000Z',
                },
            ],
        } as Playlist;
        const electron = {
            dbGetAppPlaylist: jest.fn(async () => existingPlaylist),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ? '1' : null
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(async () => undefined),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await firstValueFrom(
            service.removeFromPlaylistRecentlyViewedBatch('playlist-4', [
                'https://example.com/a.m3u8',
                'https://example.com/b.m3u8',
            ])
        );

        expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledTimes(1);
        expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'playlist-4',
                recentlyViewed: [],
            })
        );
    });

    it('short-circuits removeFromPlaylistRecentlyViewedBatch when identities is empty', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-5',
            title: 'Playlist Five',
            count: 0,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            recentlyViewed: [],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.removeFromPlaylistRecentlyViewedBatch('playlist-5', [])
        );

        expect(dbService.update).not.toHaveBeenCalled();
    });

    it('sorts recently viewed entries by normalized date', async () => {
        const playlist = {
            _id: 'playlist-recent-sort',
            title: 'Recent Sort',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'old',
                    url: 'https://example.com/old.m3u8',
                    title: 'Old',
                    category_id: 'live',
                    added_at: '2026-04-01T10:00:00.000Z',
                },
                {
                    id: 'new',
                    title: 'New',
                    added_at: '2026-04-01 11:00:00',
                },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(
                service.getPlaylistRecentlyViewed('playlist-recent-sort')
            )
        ).resolves.toEqual([
            expect.objectContaining({ id: 'new' }),
            expect.objectContaining({ id: 'old' }),
        ]);
    });

    it('updates an existing M3U recently viewed item instead of duplicating it', async () => {
        jest.useFakeTimers().setSystemTime(
            new Date('2026-04-02T12:00:00.000Z')
        );
        const playlist = {
            _id: 'playlist-recent-m3u',
            title: 'Recent M3U',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'channel-old-id',
                    url: 'https://example.com/channel.m3u8',
                    title: 'Old Title',
                    group_title: 'News',
                    category_id: 'live',
                    added_at: '2026-04-01T10:00:00.000Z',
                },
                {
                    source: 'm3u',
                    id: 'other',
                    url: 'https://example.com/other.m3u8',
                    title: 'Other',
                    category_id: 'live',
                    added_at: '2026-04-01T09:00:00.000Z',
                },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
            update: jest.fn((_storeName: string, updated: Playlist) =>
                of(updated)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.addM3uRecentlyViewed('playlist-recent-m3u', {
                source: 'm3u',
                id: 'channel-new-id',
                url: 'https://example.com/channel.m3u8',
                title: 'New Title',
                channel_id: 'channel-new-id',
                category_id: 'live',
                added_at: 'ignored',
            })
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                recentlyViewed: [
                    expect.objectContaining({
                        id: 'channel-new-id',
                        title: 'New Title',
                        group_title: 'News',
                        added_at: '2026-04-02T12:00:00.000Z',
                    }),
                    expect.objectContaining({
                        url: 'https://example.com/other.m3u8',
                    }),
                ],
            })
        );
    });

    it('removes portal recently viewed items using normalized colon identities', async () => {
        const playlist = {
            _id: 'portal-recent-remove',
            title: 'Portal Recent Remove',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            recentlyViewed: [
                { id: '100:episode', title: 'Remove Me' },
                { movie_id: '200', title: 'Keep Me' },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
            update: jest.fn((_storeName: string, updated: Playlist) =>
                of(updated)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.removeFromPortalRecentlyViewed('portal-recent-remove', 100)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                recentlyViewed: [expect.objectContaining({ movie_id: '200' })],
            })
        );
    });

    it('keeps hiddenGroupTitles when refreshing a playlist payload', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-2',
            title: 'Playlist Two',
            count: 1,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            hiddenGroupTitles: ['Radio-de'],
            playlist: {
                items: [{ id: 'channel-1' }],
            },
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.updatePlaylist('playlist-2', {
                _id: 'playlist-2',
                playlist: {
                    items: [],
                },
            } as Playlist)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-2',
                hiddenGroupTitles: ['Radio-de'],
                count: 0,
            })
        );
    });

    it('keeps autoRefresh enabled when refreshing a playlist payload with the parser default disabled', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-3',
            title: 'Playlist Three',
            count: 1,
            importDate: new Date('2026-04-12T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-12T00:00:00.000Z').toISOString(),
            autoRefresh: true,
            playlist: {
                items: [{ id: 'channel-1' }],
            },
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.updatePlaylist('playlist-3', {
                _id: 'playlist-3',
                autoRefresh: false,
                playlist: {
                    items: [],
                },
            } as Playlist)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-3',
                autoRefresh: true,
                count: 0,
            })
        );
    });
});
