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
        jest.restoreAllMocks();
    });

    function createService(overrides: Record<string, unknown> = {}) {
        const service = Object.create(PlaylistsService.prototype) as PlaylistsService;

        Object.assign(service as object, {
            dbService: {
                clear: jest.fn(() => of(undefined)),
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
            electronMigrationPromise: null,
            indexedDbMigrationPromise: null,
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

        await expect(firstValueFrom(service.getAllPlaylists())).resolves.toEqual([
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
        expect(appState.get(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG)).toBe('1');
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
